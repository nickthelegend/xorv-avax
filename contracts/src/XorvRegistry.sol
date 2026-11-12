// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title XorvRegistry
/// @notice Staked provider nodes. An owner stakes and registers one node key. The node key can bid,
///         deliver and check through the market; only the owner can unstake or withdraw earnings.
///         The market (set once) locks providers on open jobs, credits earnings and slashes stake.
contract XorvRegistry is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Provider {
        address owner;
        address node;
        string label;
        string kind;
        string[] models;
        uint128 stake;
        uint128 unbonding;
        uint64 unbondAt;
        uint64 joinedAt;
        uint128 earned;
        uint128 totalEarned;
        uint128 slashed;
        uint32 active;
        uint32 wins;
        uint32 bids;
        uint32 checks;
        uint32 slashes;
    }

    IERC20 public immutable token;
    address public immutable admin;
    address public market;

    uint128 public immutable minStake;
    uint16 public immutable slashBps;
    uint32 public immutable unbondSecs;

    mapping(address => Provider) private _providers;
    mapping(address => address) public ownerOfNode;
    mapping(address => mapping(bytes32 => bool)) public serves;
    address[] public providerList;

    uint256 public totalStaked;
    uint256 public totalEarnedUnclaimed;
    uint256 public paidTotal;
    uint256 public slashedTotal;
    uint256 public slashCount;

    event ProviderRegistered(address indexed owner, address indexed node, string label, string kind, string[] models, uint256 stake);
    event ProviderUpdated(address indexed owner, string label, string kind, string[] models);
    event StakeChanged(address indexed owner, uint256 stake, uint256 unbonding, uint256 unbondAt);
    event Credited(address indexed owner, uint256 amount, uint256 indexed jobId);
    event EarningsWithdrawn(address indexed owner, address indexed to, uint256 amount);
    event Slashed(uint256 indexed jobId, address indexed owner, address indexed to, uint256 amount, string reason);

    error OnlyAdmin();
    error OnlyMarket();
    error MarketAlreadySet();
    error NotProvider();
    error AlreadyRegistered();
    error NodeTaken();
    error BadProfile();
    error StakeTooLow();
    error AmountExceedsStake();
    error NothingUnbonding();
    error StillUnbonding();
    error OpenJobs();
    error NoEarnings();

    constructor(IERC20 token_, uint128 minStake_, uint16 slashBps_, uint32 unbondSecs_) {
        token = token_;
        admin = msg.sender;
        minStake = minStake_;
        slashBps = slashBps_;
        unbondSecs = unbondSecs_;
    }

    function setMarket(address market_) external {
        if (msg.sender != admin) revert OnlyAdmin();
        if (market != address(0)) revert MarketAlreadySet();
        market = market_;
    }

    modifier onlyMarket() {
        if (msg.sender != market) revert OnlyMarket();
        _;
    }

    // ------------------------------------------------------------------ owners

    function register(address node, string calldata label, string calldata kind, string[] calldata models, uint128 stake)
        external
        nonReentrant
    {
        if (_providers[msg.sender].owner != address(0) || ownerOfNode[msg.sender] != address(0)) revert AlreadyRegistered();
        if (node == address(0) || node == msg.sender || ownerOfNode[node] != address(0) || _providers[node].owner != address(0)) {
            revert NodeTaken();
        }
        _validateProfile(label, kind, models);
        if (stake < minStake) revert StakeTooLow();
        token.safeTransferFrom(msg.sender, address(this), stake);
        Provider storage p = _providers[msg.sender];
        p.owner = msg.sender;
        p.node = node;
        p.label = label;
        p.kind = kind;
        p.stake = stake;
        p.joinedAt = uint64(block.timestamp);
        _setModels(p, models);
        ownerOfNode[node] = msg.sender;
        providerList.push(msg.sender);
        totalStaked += stake;
        emit ProviderRegistered(msg.sender, node, label, kind, models, stake);
    }

    function updateProfile(string calldata label, string calldata kind, string[] calldata models) external {
        Provider storage p = _provider(msg.sender);
        _validateProfile(label, kind, models);
        for (uint256 i; i < p.models.length; i++) {
            serves[msg.sender][keccak256(bytes(p.models[i]))] = false;
        }
        p.label = label;
        p.kind = kind;
        _setModels(p, models);
        emit ProviderUpdated(msg.sender, label, kind, models);
    }

    function addStake(uint128 amount) external nonReentrant {
        Provider storage p = _provider(msg.sender);
        token.safeTransferFrom(msg.sender, address(this), amount);
        p.stake += amount;
        totalStaked += amount;
        emit StakeChanged(msg.sender, p.stake, p.unbonding, p.unbondAt);
    }

    /// @notice Start unbonding. Unbonding stake can still be slashed, and a provider with stake
    ///         unbonding cannot bid or be drawn as a checker.
    function requestUnstake(uint128 amount) external {
        Provider storage p = _provider(msg.sender);
        if (amount == 0 || amount > p.stake) revert AmountExceedsStake();
        p.stake -= amount;
        p.unbonding += amount;
        p.unbondAt = uint64(block.timestamp + unbondSecs);
        emit StakeChanged(msg.sender, p.stake, p.unbonding, p.unbondAt);
    }

    function withdrawStake() external nonReentrant returns (uint256 amount) {
        Provider storage p = _provider(msg.sender);
        if (p.unbonding == 0) revert NothingUnbonding();
        if (block.timestamp < p.unbondAt) revert StillUnbonding();
        if (p.active != 0) revert OpenJobs();
        amount = p.unbonding;
        p.unbonding = 0;
        totalStaked -= amount;
        token.safeTransfer(msg.sender, amount);
        emit StakeChanged(msg.sender, p.stake, 0, p.unbondAt);
    }

    function withdrawEarnings(address to) external nonReentrant returns (uint256 amount) {
        Provider storage p = _provider(msg.sender);
        amount = p.earned;
        if (amount == 0) revert NoEarnings();
        p.earned = 0;
        totalEarnedUnclaimed -= amount;
        token.safeTransfer(to, amount);
        emit EarningsWithdrawn(msg.sender, to, amount);
    }

    // ------------------------------------------------------------------ market hooks

    /// @notice The node's owner, if it is eligible to bid on or check `model`.
    function eligibleNode(address node, bytes32 model) external view returns (address o, bool ok) {
        o = ownerOfNode[node];
        ok = o != address(0) && _eligible(o, model);
    }

    function lock(address o, bool isBid) external onlyMarket {
        Provider storage p = _providers[o];
        p.active++;
        if (isBid) p.bids++;
    }

    function unlock(address o) external onlyMarket {
        _providers[o].active--;
    }

    function noteWin(address o) external onlyMarket {
        _providers[o].wins++;
    }

    function noteCheck(address o) external onlyMarket {
        _providers[o].checks++;
    }

    /// @notice The market has already transferred `amount` here; book it as the provider's earnings.
    function credit(address o, uint256 amount, uint256 jobId) external onlyMarket {
        Provider storage p = _providers[o];
        p.earned += uint128(amount);
        p.totalEarned += uint128(amount);
        totalEarnedUnclaimed += amount;
        paidTotal += amount;
        emit Credited(o, amount, jobId);
    }

    /// @notice Takes slashBps of the provider's stake (unbonding included) and gives it to `to`:
    ///         booked as earnings if `to` is a provider, otherwise sent.
    function slash(address o, address to, uint256 jobId, string calldata reason) external onlyMarket returns (uint256 amount) {
        Provider storage p = _providers[o];
        uint256 total = uint256(p.stake) + p.unbonding;
        amount = (total * slashBps) / 10_000;
        uint256 fromStake = amount < p.stake ? amount : p.stake;
        p.stake -= uint128(fromStake);
        p.unbonding -= uint128(amount - fromStake);
        p.slashes++;
        p.slashed += uint128(amount);
        totalStaked -= amount;
        slashedTotal += amount;
        slashCount++;
        emit Slashed(jobId, o, to, amount, reason);
        Provider storage r = _providers[to];
        if (r.owner != address(0)) {
            r.earned += uint128(amount);
            r.totalEarned += uint128(amount);
            totalEarnedUnclaimed += amount;
            emit Credited(to, amount, jobId);
        } else if (amount > 0) {
            token.safeTransfer(to, amount);
        }
    }

    /// @notice Draws one eligible provider for `model`, skipping `exclude`, from `seed`.
    function pick(bytes32 model, address[] calldata exclude, bytes32 seed)
        external
        view
        returns (address picked, address node, uint256 poolSize)
    {
        address[] memory pool = new address[](providerList.length);
        for (uint256 i; i < providerList.length; i++) {
            address o = providerList[i];
            bool skip;
            for (uint256 k; k < exclude.length; k++) {
                if (exclude[k] == o) skip = true;
            }
            if (!skip && _eligible(o, model)) pool[poolSize++] = o;
        }
        if (poolSize == 0) return (address(0), address(0), 0);
        picked = pool[uint256(keccak256(abi.encode(seed, "pick"))) % poolSize];
        node = _providers[picked].node;
    }

    // ------------------------------------------------------------------ views

    function isProvider(address o) external view returns (bool) {
        return _providers[o].owner != address(0);
    }

    function stakeOf(address o) external view returns (uint256) {
        return _providers[o].stake;
    }

    function getProvider(address o) external view returns (Provider memory) {
        return _providers[o];
    }

    function providerCount() external view returns (uint256) {
        return providerList.length;
    }

    function isEligible(address o, string calldata model) external view returns (bool) {
        return _eligible(o, keccak256(bytes(model)));
    }

    // ------------------------------------------------------------------ internals

    function _eligible(address o, bytes32 model) private view returns (bool) {
        Provider storage p = _providers[o];
        return p.owner != address(0) && p.stake >= minStake && p.unbonding == 0 && serves[o][model];
    }

    function _validateProfile(string calldata label, string calldata kind, string[] calldata models) private pure {
        uint256 ll = bytes(label).length;
        if (ll == 0 || ll > 40) revert BadProfile();
        bytes32 k = keccak256(bytes(kind));
        if (k != keccak256("api") && k != keccak256("local") && k != keccak256("subscription")) revert BadProfile();
        if (models.length == 0 || models.length > 12) revert BadProfile();
        for (uint256 i; i < models.length; i++) {
            uint256 ml = bytes(models[i]).length;
            if (ml == 0 || ml > 80) revert BadProfile();
        }
    }

    function _setModels(Provider storage p, string[] calldata models) private {
        delete p.models;
        for (uint256 i; i < models.length; i++) {
            p.models.push(models[i]);
            serves[p.owner][keccak256(bytes(models[i]))] = true;
        }
    }

    function _provider(address o) private view returns (Provider storage p) {
        p = _providers[o];
        if (p.owner == address(0)) revert NotProvider();
    }
}
