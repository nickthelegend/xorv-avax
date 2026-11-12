// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Similarity} from "./Similarity.sol";

interface IXorvRegistry {
    function minStake() external view returns (uint128);
    function unbondSecs() external view returns (uint32);
    function eligibleNode(address node, bytes32 model) external view returns (address owner, bool ok);
    function lock(address o, bool isBid) external;
    function unlock(address o) external;
    function noteWin(address o) external;
    function noteCheck(address o) external;
    function credit(address o, uint256 amount, uint256 jobId) external;
    function slash(address o, address to, uint256 jobId, string calldata reason) external returns (uint256);
    function pick(bytes32 model, address[] calldata exclude, bytes32 seed)
        external
        view
        returns (address picked, address node, uint256 poolSize);
    function isProvider(address o) external view returns (bool);
    function stakeOf(address o) external view returns (uint256);
}

interface IXorvIndexWriter {
    function record(string calldata name, uint256 jobId, uint64 rate, uint32 tokens, uint128 charge) external;
}

/// @title XorvMarket (stake and earnings live in XorvRegistry)
/// @notice Every request for AI work is a sealed-bid auction among staked provider nodes. The lowest
///         revealed rate (micro-dollars per 1k tokens) wins and runs the job. A random sample of
///         deliveries is re-run by a second node; on a mismatch a third node breaks the tie and whoever
///         it contradicts loses stake. Paid, checked, competitive clearings feed the Xorv Compute Index.
///         Buyers pay either with an ERC-20 approval or with an x402 EIP-3009 authorization (X402Router).
contract XorvMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    enum Status {
        None,
        Bidding,
        Running,
        Delivered,
        Checking,
        Mismatch,
        Tiebreak,
        Done,
        Faulted,
        Expired
    }

    enum Outcome {
        None,
        PaidNotSampled,
        PaidCheckMatched,
        PaidNoChecker,
        PaidCheckerTimeout,
        PaidTiebreakSidedWithProvider,
        PaidTiebreakInconclusive,
        FaultedTiebreakSidedWithChecker,
        FaultedNoDelivery,
        ExpiredNoBids,
        RefundedNoTiebreaker
    }

    struct Config {
        uint16 spotCheckBps;
        uint16 toleranceBps;
        uint64 checkFee;
        uint32 minWindowSecs;
        uint32 maxWindowSecs;
    }

    struct Job {
        address buyer;
        Status status;
        Outcome outcome;
        bool alwaysCheck;
        bool viaX402;
        uint8 bidCount;
        uint8 revealed;
        string model;
        bytes32 promptHash;
        uint64 maxRate;
        uint32 maxTokens;
        uint32 workSecs;
        uint128 escrow;
        uint64 createdAt;
        uint64 commitEnd;
        uint64 revealEnd;
        uint64 deliverEnd;
        uint64 checkEnd;
        uint64 closedAt;
        address winner;
        address winnerNode;
        uint64 clearedRate;
        uint32 tokens;
        uint128 charge;
        bytes32 resultHash;
        uint64 drawBlock;
    }

    struct Bid {
        address owner;
        address node;
        bytes32 commitment;
        uint64 committedAt;
        uint64 rate;
        bool revealed;
    }

    struct Check {
        address owner;
        address node;
        uint64 drawnAt;
        uint64 deliveredAt;
        bytes32 outputHash;
        uint32 tokens;
        uint16 similarityBps;
        bool delivered;
    }

    struct PostParams {
        string model;
        string prompt;
        uint64 maxRate;
        uint32 maxTokens;
        uint32 commitSecs;
        uint32 revealSecs;
        uint32 workSecs;
        bool alwaysCheck;
    }

    // ------------------------------------------------------------------ storage

    uint256 public constant MAX_BIDS = 8;
    uint256 public constant MAX_PROMPT = 4_000;
    uint256 public constant MAX_OUTPUT = 6_000;
    uint256 public constant MAX_TOKENS = 8_192;
    uint256 private constant BPS = 10_000;

    IERC20 public immutable token;
    IXorvRegistry public immutable registry;
    IXorvIndexWriter public immutable index;
    address public owner;
    address public x402Router;
    Config public config;

    Job[] private _jobs;
    /// @notice bids(jobId, i), i < job.bidCount
    mapping(uint256 => Bid[]) public bids;
    /// @notice checks(jobId, i): first checker at 0, tiebreaker at 1
    mapping(uint256 => Check[]) public checks;

    uint256 public totalEscrow;
    uint256 public clearings;

    // ------------------------------------------------------------------ events

    event JobPosted(
        uint256 indexed id,
        address indexed buyer,
        string model,
        string prompt,
        uint256 maxRate,
        uint256 maxTokens,
        uint256 escrow,
        uint256 commitEnd,
        uint256 revealEnd,
        bool viaX402,
        bytes32 paymentNonce
    );
    event BidCommitted(uint256 indexed id, address indexed node, address indexed owner);
    event BidRevealed(uint256 indexed id, address indexed node, uint256 rate);
    event AuctionCleared(uint256 indexed id, address indexed winner, address node, uint256 rate, uint256 bids, uint256 revealed);
    event Delivered(uint256 indexed id, address indexed node, string output, uint256 tokens, bytes32 outputHash, uint256 drawBlock);
    event DrawResolved(uint256 indexed id, uint8 purpose, bytes32 seed, uint256 rollBps, uint256 thresholdBps, bool selected, uint256 pool, address picked);
    event CheckDelivered(uint256 indexed id, address indexed node, uint8 round, string output, uint256 tokens, uint256 similarityBps, uint256 againstFirstBps);
    /// @notice kind: 1 clearing price, 2 check fee, 3 tiebreak fee, 4 refund to buyer
    event Payout(uint256 indexed id, address indexed to, uint256 amount, uint8 kind);
    event JobClosed(uint256 indexed id, Status status, Outcome outcome, uint256 charge, uint256 refund);
    /// @notice reason: 1 no tokens, 2 fewer than two revealed bids, 3 buyer won its own job
    event IndexSkipped(uint256 indexed id, uint8 reason);

    // ------------------------------------------------------------------ errors

    error OnlyOwner();
    error BadModel();
    error BadPrompt();
    error BadMaxRate();
    error BadMaxTokens();
    error BadWindow();
    error BadOutput();
    error EscrowExhausted();
    error NoSuchJob();
    error WrongStatus(Status status);
    error WindowClosed();
    error WindowOpen();
    error NotEligible();
    error OneBidPerProvider();
    error BidLimit();
    error NoSealedBid();
    error AlreadyRevealed();
    error RevealMismatch();
    error AboveMaxRate();
    error NotWinnerNode();
    error NotDrawnChecker();
    error ResultHashMismatch();
    error FirstCheckHashMismatch();
    error DrawNotReady();
    error PaymentTooSmall(uint256 required);
    error OnlyRouter();

    // ------------------------------------------------------------------ setup

    error NotNode();

    constructor(IERC20 token_, IXorvRegistry registry_, IXorvIndexWriter index_, Config memory config_) {
        token = token_;
        registry = registry_;
        index = index_;
        owner = msg.sender;
        config = config_;
    }

    // ------------------------------------------------------------------ posting

    /// @notice Escrow a job needs: the most it can cost at the buyer's ceiling, plus two check fees.
    function escrowFor(uint64 maxRate, uint32 maxTokens) public view returns (uint256) {
        return _ceilDiv(uint256(maxRate) * maxTokens, 1000) + 2 * uint256(config.checkFee);
    }

    /// @notice Post a job paid from an ERC-20 allowance.
    function postJob(PostParams calldata p) external nonReentrant returns (uint256 id) {
        uint256 escrow = escrowFor(p.maxRate, p.maxTokens);
        token.safeTransferFrom(msg.sender, address(this), escrow);
        id = _post(p, msg.sender, escrow, false, bytes32(0));
    }

    /// @notice Post a job paid through x402. Only the X402Router calls this, after it has pulled the
    ///         buyer's EIP-3009 authorization; the buyer still owns the job and receives any refund.
    function postJobX402(PostParams calldata p, address buyer, uint256 value, bytes32 nonce)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (msg.sender != x402Router) revert OnlyRouter();
        if (value < escrowFor(p.maxRate, p.maxTokens)) revert PaymentTooSmall(escrowFor(p.maxRate, p.maxTokens));
        token.safeTransferFrom(msg.sender, address(this), value);
        id = _post(p, buyer, value, true, nonce);
    }

    /// @notice One-time wiring of the x402 router.
    function setRouter(address router) external {
        if (msg.sender != owner || x402Router != address(0)) revert OnlyOwner();
        x402Router = router;
    }

    function _post(PostParams calldata p, address buyer, uint256 escrow, bool viaX402, bytes32 nonce)
        private
        returns (uint256 id)
    {
        uint256 modelLen = bytes(p.model).length;
        uint256 promptLen = bytes(p.prompt).length;
        if (modelLen == 0 || modelLen > 80) revert BadModel();
        if (promptLen == 0 || promptLen > MAX_PROMPT) revert BadPrompt();
        if (p.maxRate == 0) revert BadMaxRate();
        if (p.maxTokens == 0 || p.maxTokens > MAX_TOKENS) revert BadMaxTokens();
        Config memory c = config;
        if (
            p.commitSecs < c.minWindowSecs || p.revealSecs < c.minWindowSecs || p.workSecs < c.minWindowSecs
                || p.commitSecs > c.maxWindowSecs || p.revealSecs > c.maxWindowSecs || p.workSecs > c.maxWindowSecs
        ) revert BadWindow();
        if (uint256(p.workSecs) * 2 >= registry.unbondSecs()) revert BadWindow();

        id = _jobs.length;
        Job storage j = _jobs.push();
        j.buyer = buyer;
        j.status = Status.Bidding;
        j.alwaysCheck = p.alwaysCheck;
        j.viaX402 = viaX402;
        j.model = p.model;
        j.promptHash = keccak256(bytes(p.prompt));
        j.maxRate = p.maxRate;
        j.maxTokens = p.maxTokens;
        j.workSecs = p.workSecs;
        j.escrow = uint128(escrow);
        j.createdAt = uint64(block.timestamp);
        j.commitEnd = uint64(block.timestamp + p.commitSecs);
        j.revealEnd = j.commitEnd + p.revealSecs;
        totalEscrow += escrow;
        emit JobPosted(id, buyer, p.model, p.prompt, p.maxRate, p.maxTokens, escrow, j.commitEnd, j.revealEnd, viaX402, nonce);
    }

    // ------------------------------------------------------------------ auction

    /// @notice commitment = keccak256(abi.encode(chainid, market, jobId, node, rate, salt))
    function bidCommitment(uint256 id, address node, uint64 rate, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), id, node, rate, salt));
    }

    function commitBid(uint256 id, bytes32 commitment) external {
        Job storage j = _job(id);
        (address o, bool ok) = registry.eligibleNode(msg.sender, keccak256(bytes(j.model)));
        if (o == address(0)) revert NotNode();
        if (!ok) revert NotEligible();
        if (j.status != Status.Bidding) revert WrongStatus(j.status);
        if (block.timestamp >= j.commitEnd) revert WindowClosed();
        Bid[] storage bs = bids[id];
        if (bs.length >= MAX_BIDS) revert BidLimit();
        for (uint256 i; i < bs.length; i++) {
            if (bs[i].owner == o) revert OneBidPerProvider();
        }
        bs.push(Bid({owner: o, node: msg.sender, commitment: commitment, committedAt: uint64(block.timestamp), rate: 0, revealed: false}));
        j.bidCount++;
        registry.lock(o, true);
        emit BidCommitted(id, msg.sender, o);
    }

    function revealBid(uint256 id, uint64 rate, bytes32 salt) external {
        Job storage j = _job(id);
        if (j.status != Status.Bidding) revert WrongStatus(j.status);
        if (block.timestamp < j.commitEnd) revert WindowOpen();
        if (block.timestamp >= j.revealEnd) revert WindowClosed();
        if (rate > j.maxRate) revert AboveMaxRate();
        Bid[] storage bs = bids[id];
        uint256 i;
        for (; i < bs.length; i++) {
            if (bs[i].node == msg.sender) break;
        }
        if (i == bs.length) revert NoSealedBid();
        Bid storage b = bs[i];
        if (b.revealed) revert AlreadyRevealed();
        if (b.commitment != bidCommitment(id, msg.sender, rate, salt)) revert RevealMismatch();
        b.revealed = true;
        b.rate = rate;
        j.revealed++;
        emit BidRevealed(id, msg.sender, rate);
        // Every sealed bid is open: no reason to wait for the window to end.
        if (j.revealed == j.bidCount) _closeAuction(id);
    }

    /// @notice Winner delivers. The spot-check draw uses the hash of the block this delivery lands in,
    ///         which is only known once that block is produced, so the winner cannot pick an output that
    ///         dodges the check. (Avalanche makes blocks only when there are transactions, so waiting for
    ///         a later block could stall the job on a quiet chain.)
    function deliver(uint256 id, string calldata output, uint32 tokens) external {
        Job storage j = _job(id);
        if (j.status != Status.Running) revert WrongStatus(j.status);
        if (msg.sender != j.winnerNode) revert NotWinnerNode();
        if (block.timestamp >= j.deliverEnd) revert WindowClosed();
        uint256 len = bytes(output).length;
        if (len == 0 || len > MAX_OUTPUT) revert BadOutput();
        j.tokens = tokens > j.maxTokens ? j.maxTokens : tokens;
        j.resultHash = keccak256(bytes(output));
        j.drawBlock = uint64(block.number);
        j.status = Status.Delivered;
        emit Delivered(id, msg.sender, output, j.tokens, j.resultHash, j.drawBlock);
    }

    /// @notice Resolves a pending draw (spot check after delivery, tiebreaker after a mismatch) once
    ///         its block is mined. Anyone can call it.
    function resolveDraw(uint256 id) external {
        Job storage j = _job(id);
        if (j.status != Status.Delivered && j.status != Status.Mismatch) revert WrongStatus(j.status);
        if (block.number <= j.drawBlock) revert DrawNotReady();
        bytes32 bh = blockhash(j.drawBlock);
        bytes32 seed = keccak256(abi.encode(bh, id, j.status));
        if (j.status == Status.Delivered) {
            uint256 roll = uint256(seed) % BPS;
            // If the block hash aged out, sample: withholding the draw must never avoid a check.
            bool sampled = j.alwaysCheck || bh == bytes32(0) || roll < config.spotCheckBps;
            uint256 threshold = j.alwaysCheck ? BPS : config.spotCheckBps;
            if (!sampled) {
                emit DrawResolved(id, 0, seed, roll, threshold, false, 0, address(0));
                _settlePaid(id, Outcome.PaidNotSampled);
                return;
            }
            address[] memory ex = new address[](1);
            ex[0] = j.winner;
            (bool ok, uint256 pool, address picked) = _drawChecker(id, seed, ex, Status.Checking);
            emit DrawResolved(id, 0, seed, roll, threshold, true, pool, picked);
            if (!ok) _settlePaid(id, Outcome.PaidNoChecker);
        } else {
            address[] memory ex = new address[](2);
            ex[0] = j.winner;
            ex[1] = checks[id][0].owner;
            (bool ok, uint256 pool, address picked) = _drawChecker(id, seed, ex, Status.Tiebreak);
            emit DrawResolved(id, 1, seed, 0, 0, true, pool, picked);
            if (!ok) {
                _payCheckers(id, true, false);
                _close(id, Status.Done, Outcome.RefundedNoTiebreaker, 0);
            }
        }
    }

    /// @notice A drawn checker re-runs the job. The contract compares the texts itself (word-set
    ///         Jaccard). `result` is the winner's output and `firstCheck` the first checker's (only for a
    ///         tiebreak); both are verified against their stored hashes.
    function deliverCheck(uint256 id, string calldata output, uint32 tokens, string calldata result, string calldata firstCheck)
        external
    {
        Job storage j = _job(id);
        if (j.status != Status.Checking && j.status != Status.Tiebreak) revert WrongStatus(j.status);
        if (block.timestamp >= j.checkEnd) revert WindowClosed();
        if (bytes(output).length == 0 || bytes(output).length > MAX_OUTPUT) revert BadOutput();
        uint256 idx = checks[id].length - 1;
        (uint256 sim, uint256 withFirstBps) = _score(id, idx, output, result, firstCheck);
        Check storage c = checks[id][idx];
        c.outputHash = keccak256(bytes(output));
        c.tokens = tokens;
        c.similarityBps = uint16(sim);
        c.delivered = true;
        c.deliveredAt = uint64(block.timestamp);
        registry.noteCheck(c.owner);
        emit CheckDelivered(id, msg.sender, uint8(idx), output, tokens, sim, withFirstBps);
        _judge(id, idx, sim, withFirstBps);
    }

    function _score(uint256 id, uint256 idx, string calldata output, string calldata result, string calldata firstCheck)
        private
        view
        returns (uint256 sim, uint256 withFirstBps)
    {
        Check[] storage cs = checks[id];
        if (cs[idx].node != msg.sender) revert NotDrawnChecker();
        if (keccak256(bytes(result)) != _jobs[id].resultHash) revert ResultHashMismatch();
        sim = Similarity.jaccardBps(bytes(result), bytes(output));
        if (idx == 1) {
            if (keccak256(bytes(firstCheck)) != cs[0].outputHash) revert FirstCheckHashMismatch();
            withFirstBps = Similarity.jaccardBps(bytes(firstCheck), bytes(output));
        }
    }

    function _judge(uint256 id, uint256 idx, uint256 sim, uint256 withFirstBps) private {
        Job storage j = _jobs[id];
        uint256 tol = config.toleranceBps;
        if (idx == 0) {
            if (sim >= tol) {
                _payCheckers(id, true, false);
                _settlePaid(id, Outcome.PaidCheckMatched);
            } else {
                j.status = Status.Mismatch;
                j.drawBlock = uint64(block.number);
            }
            return;
        }
        bool withFirst = withFirstBps >= tol;
        bool withResult = sim >= tol;
        if (withFirst && !withResult) {
            _payCheckers(id, true, true);
            registry.slash(j.winner, j.buyer, id, "result failed the spot check");
            _close(id, Status.Faulted, Outcome.FaultedTiebreakSidedWithChecker, 0);
        } else if (withResult && !withFirst) {
            _payCheckers(id, false, true);
            registry.slash(checks[id][0].owner, j.winner, id, "check contradicted by the tiebreaker");
            _settlePaid(id, Outcome.PaidTiebreakSidedWithProvider);
        } else {
            _payCheckers(id, true, true);
            _settlePaid(id, Outcome.PaidTiebreakInconclusive);
        }
    }

    /// @notice Moves a job past an expired deadline. Anyone may call it.
    function advance(uint256 id) external {
        Job storage j = _job(id);
        Status s = j.status;
        if (s == Status.Bidding) {
            if (block.timestamp < j.revealEnd) revert WindowOpen();
            _closeAuction(id);
        } else if (s == Status.Running) {
            if (block.timestamp < j.deliverEnd) revert WindowOpen();
            registry.slash(j.winner, j.buyer, id, "did not deliver");
            _close(id, Status.Faulted, Outcome.FaultedNoDelivery, 0);
        } else if (s == Status.Checking || s == Status.Tiebreak) {
            if (block.timestamp < j.checkEnd) revert WindowOpen();
            if (s == Status.Tiebreak) _payCheckers(id, true, false);
            _settlePaid(id, Outcome.PaidCheckerTimeout);
        } else {
            revert WrongStatus(s);
        }
    }

    // ------------------------------------------------------------------ owner

    // ------------------------------------------------------------------ views

    function jobCount() external view returns (uint256) {
        return _jobs.length;
    }

    function getJob(uint256 id) external view returns (Job memory) {
        return _job(id);
    }

    function checkCount(uint256 id) external view returns (uint256) {
        return checks[id].length;
    }

    // ------------------------------------------------------------------ internals

    function _closeAuction(uint256 id) private {
        Job storage j = _jobs[id];
        Bid[] storage bs = bids[id];
        int256 best = -1;
        for (uint256 i; i < bs.length; i++) {
            Bid storage b = bs[i];
            if (!b.revealed) continue;
            if (best < 0) {
                best = int256(i);
                continue;
            }
            Bid storage w = bs[uint256(best)];
            uint256 sb = registry.stakeOf(b.owner);
            uint256 sw = registry.stakeOf(w.owner);
            if (b.rate < w.rate || (b.rate == w.rate && (sb > sw || (sb == sw && b.committedAt < w.committedAt)))) {
                best = int256(i);
            }
        }
        for (uint256 i; i < bs.length; i++) {
            if (int256(i) != best) registry.unlock(bs[i].owner);
        }
        if (best < 0) {
            _close(id, Status.Expired, Outcome.ExpiredNoBids, 0);
            return;
        }
        Bid storage win = bs[uint256(best)];
        j.winner = win.owner;
        j.winnerNode = win.node;
        j.clearedRate = win.rate;
        j.status = Status.Running;
        j.deliverEnd = uint64(block.timestamp + j.workSecs);
        clearings++;
        emit AuctionCleared(id, win.owner, win.node, win.rate, bs.length, j.revealed);
    }

    function _drawChecker(uint256 id, bytes32 seed, address[] memory exclude, Status next)
        private
        returns (bool ok, uint256 poolSize, address picked)
    {
        Job storage j = _jobs[id];
        address node;
        (picked, node, poolSize) = registry.pick(keccak256(bytes(j.model)), exclude, seed);
        if (picked == address(0)) return (false, 0, address(0));
        registry.lock(picked, false);
        checks[id].push(
            Check({
                owner: picked,
                node: node,
                drawnAt: uint64(block.timestamp),
                deliveredAt: 0,
                outputHash: bytes32(0),
                tokens: 0,
                similarityBps: 0,
                delivered: false
            })
        );
        j.status = next;
        j.checkEnd = uint64(block.timestamp + j.workSecs);
        return (true, poolSize, picked);
    }

    function _payCheckers(uint256 id, bool first, bool second) private {
        Check[] storage cs = checks[id];
        uint256 fee = config.checkFee;
        if (first && cs.length > 0 && cs[0].delivered) _credit(id, cs[0].owner, fee, 2);
        if (second && cs.length > 1 && cs[1].delivered) _credit(id, cs[1].owner, fee, 3);
    }

    /// @dev Pays from the job's escrow. Providers are credited in the registry; anyone else is sent tokens.
    function _credit(uint256 id, address to, uint256 amount, uint8 reason) private {
        if (amount == 0) return;
        Job storage j = _jobs[id];
        if (j.escrow < amount) revert EscrowExhausted();
        j.escrow -= uint128(amount);
        totalEscrow -= amount;
        if (registry.isProvider(to)) {
            token.safeTransfer(address(registry), amount);
            registry.credit(to, amount, id);
        } else {
            token.safeTransfer(to, amount);
        }
        emit Payout(id, to, amount, reason);
    }

    function _settlePaid(uint256 id, Outcome outcome) private {
        Job storage j = _jobs[id];
        uint256 charge = _ceilDiv(uint256(j.clearedRate) * j.tokens, 1000);
        if (charge > j.escrow) charge = j.escrow;
        j.charge = uint128(charge);
        _credit(id, j.winner, charge, 1);
        registry.noteWin(j.winner);
        _recordIndex(id);
        _close(id, Status.Done, outcome, charge);
    }

    function _recordIndex(uint256 id) private {
        Job storage j = _jobs[id];
        if (j.tokens == 0) {
            emit IndexSkipped(id, 1);
        } else if (j.revealed < 2) {
            emit IndexSkipped(id, 2);
        } else if (j.buyer == j.winner || j.buyer == j.winnerNode) {
            emit IndexSkipped(id, 3);
        } else {
            index.record(j.model, id, j.clearedRate, j.tokens, j.charge);
        }
    }

    function _close(uint256 id, Status status, Outcome outcome, uint256 charge) private {
        Job storage j = _jobs[id];
        uint256 rest = j.escrow;
        j.status = status;
        j.outcome = outcome;
        j.closedAt = uint64(block.timestamp);
        if (rest > 0) {
            j.escrow = 0;
            totalEscrow -= rest;
            token.safeTransfer(j.buyer, rest);
            emit Payout(id, j.buyer, rest, 4);
        }
        if (j.winner != address(0)) registry.unlock(j.winner);
        Check[] storage cs = checks[id];
        for (uint256 i; i < cs.length; i++) {
            registry.unlock(cs[i].owner);
        }
        emit JobClosed(id, status, outcome, charge, rest);
    }

    function _job(uint256 id) private view returns (Job storage) {
        if (id >= _jobs.length) revert NoSuchJob();
        return _jobs[id];
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
