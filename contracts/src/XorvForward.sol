// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IXorvIndex} from "./XorvIndex.sol";

/// @title XorvForward
/// @notice Fixed-price compute forwards, cash-settled against the Xorv Compute Index.
///         A maker offers to buy (long) or sell (short) `notionalTokens` of a model's compute at a
///         strike rate (micro-dollars per 1k tokens) for a period, typically one week. A taker takes the
///         other side. Both post the same margin. At expiry the contract reads the index TWAP over the
///         forward's life: if compute got dearer than the strike, the long (a buyer who locked a price)
///         is paid the difference; if cheaper, the short (a provider who locked a price) is. Payoff is
///         capped at the margin.
contract XorvForward is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Offered,
        Live,
        Settled,
        Cancelled
    }

    struct Forward {
        address maker;
        address taker;
        bool makerLong;
        State state;
        string model;
        uint64 strike;
        uint64 notionalTokens;
        uint128 margin;
        uint64 duration;
        uint64 start;
        uint64 expiry;
        uint64 settledAt;
        uint64 settleRate;
        int128 payoffToLong;
    }

    uint64 public constant MIN_DURATION = 10 minutes;
    uint64 public constant MAX_DURATION = 30 days;
    /// @notice after expiry, settlement must happen within this window; later, anyone can refund both
    uint64 public constant SETTLE_WINDOW = 1 days;

    IERC20 public immutable token;
    IXorvIndex public immutable index;
    Forward[] private _forwards;

    event Offered(uint256 indexed id, address indexed maker, bool makerLong, string model, uint256 strike, uint256 notionalTokens, uint256 margin, uint256 duration);
    event Taken(uint256 indexed id, address indexed taker, uint256 start, uint256 expiry);
    event Cancelled(uint256 indexed id);
    event Settled(uint256 indexed id, uint256 indexRate, int256 payoffToLong, address long, address short, uint256 toLong, uint256 toShort);

    error BadTerms();
    error WrongState(State s);
    error NotMaker();
    error NotExpired();
    error SettleWindowOver();
    error SettleWindowOpen();
    error SelfTrade();

    constructor(IERC20 token_, IXorvIndex index_) {
        token = token_;
        index = index_;
    }

    function offer(string calldata model, bool makerLong, uint64 strike, uint64 notionalTokens, uint128 margin, uint64 duration)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (bytes(model).length == 0 || strike == 0 || notionalTokens == 0 || margin == 0) revert BadTerms();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert BadTerms();
        token.safeTransferFrom(msg.sender, address(this), margin);
        id = _forwards.length;
        Forward storage f = _forwards.push();
        f.maker = msg.sender;
        f.makerLong = makerLong;
        f.state = State.Offered;
        f.model = model;
        f.strike = strike;
        f.notionalTokens = notionalTokens;
        f.margin = margin;
        f.duration = duration;
        emit Offered(id, msg.sender, makerLong, model, strike, notionalTokens, margin, duration);
    }

    function cancel(uint256 id) external nonReentrant {
        Forward storage f = _forwards[id];
        if (f.state != State.Offered) revert WrongState(f.state);
        if (msg.sender != f.maker) revert NotMaker();
        f.state = State.Cancelled;
        token.safeTransfer(f.maker, f.margin);
        emit Cancelled(id);
    }

    function take(uint256 id) external nonReentrant {
        Forward storage f = _forwards[id];
        if (f.state != State.Offered) revert WrongState(f.state);
        if (msg.sender == f.maker) revert SelfTrade();
        token.safeTransferFrom(msg.sender, address(this), f.margin);
        f.taker = msg.sender;
        f.state = State.Live;
        f.start = uint64(block.timestamp);
        f.expiry = uint64(block.timestamp) + f.duration;
        emit Taken(id, msg.sender, f.start, f.expiry);
    }

    /// @notice What the long would receive (positive) or pay (negative) at `rate`, capped at the margin.
    function payoffAt(uint256 id, uint256 rate) public view returns (int256) {
        Forward storage f = _forwards[id];
        int256 diff = (int256(rate) - int256(uint256(f.strike))) * int256(uint256(f.notionalTokens)) / 1000;
        int256 cap = int256(uint256(f.margin));
        return diff > cap ? cap : (diff < -cap ? -cap : diff);
    }

    /// @notice Anyone settles after expiry, within the settle window, at the index TWAP over
    ///         [start, now]: the forward's whole life plus any delay before this call.
    function settle(uint256 id) external nonReentrant {
        Forward storage f = _forwards[id];
        if (f.state != State.Live) revert WrongState(f.state);
        if (block.timestamp < f.expiry) revert NotExpired();
        if (block.timestamp > f.expiry + SETTLE_WINDOW) revert SettleWindowOver();
        uint256 rate = index.twap(keccak256(bytes(f.model)), block.timestamp - f.start);
        int256 p = payoffAt(id, rate);
        f.state = State.Settled;
        f.settledAt = uint64(block.timestamp);
        f.settleRate = uint64(rate);
        f.payoffToLong = int128(p);
        (address long_, address short_) = f.makerLong ? (f.maker, f.taker) : (f.taker, f.maker);
        uint256 m = f.margin;
        uint256 toLong = uint256(int256(m) + p);
        uint256 toShort = 2 * m - toLong;
        if (toLong > 0) token.safeTransfer(long_, toLong);
        if (toShort > 0) token.safeTransfer(short_, toShort);
        emit Settled(id, rate, p, long_, short_, toLong, toShort);
    }

    /// @notice If nobody settled in time (or the index has no data), both sides get their margin back.
    function refundExpired(uint256 id) external nonReentrant {
        Forward storage f = _forwards[id];
        if (f.state != State.Live) revert WrongState(f.state);
        if (block.timestamp <= f.expiry + SETTLE_WINDOW) revert SettleWindowOpen();
        f.state = State.Cancelled;
        token.safeTransfer(f.maker, f.margin);
        token.safeTransfer(f.taker, f.margin);
        emit Cancelled(id);
    }

    function forwardCount() external view returns (uint256) {
        return _forwards.length;
    }

    function getForward(uint256 id) external view returns (Forward memory) {
        return _forwards[id];
    }
}
