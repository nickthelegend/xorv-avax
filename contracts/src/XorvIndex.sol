// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @notice Read side of the Xorv Compute Index: the cleared price of AI work per model, per 1k tokens,
///         in micro-dollars (6 decimals), from sealed-bid auctions that were delivered and paid.
interface IXorvIndex {
    /// @return rate current index rate (micro-dollars per 1k tokens)
    /// @return updatedAt timestamp of that clearing
    /// @return observations number of clearings recorded for the model
    function latest(bytes32 model) external view returns (uint256 rate, uint256 updatedAt, uint256 observations);

    /// @notice Time-weighted average rate over the last `window` seconds (the rate holds between clearings).
    function twap(bytes32 model, uint256 window) external view returns (uint256 rate);

    /// @notice Token-weighted average rate over clearings in the last `window` seconds, plus the volume.
    function vwap(bytes32 model, uint256 window) external view returns (uint256 rate, uint256 tokens, uint256 usd, uint256 count);

    function modelId(string calldata name) external pure returns (bytes32);
}

/// @title XorvIndex
/// @notice Each clearing can move the index by at most maxStepBps, so one cheap outlier cannot drag it.
///         Only the market can write, and the market writes only when a job was delivered, survived its
///         spot check (or was not sampled), had at least two revealed bids, and the buyer is not the winner.
///         Bids alone, expired auctions and slashed deliveries never reach the index.
contract XorvIndex is IXorvIndex {
    struct Observation {
        uint64 timestamp;
        /// the rate this auction actually cleared at
        uint64 rate;
        /// the rate the index moved to: `rate` clamped to +/- maxStepBps of the previous index rate
        uint64 indexRate;
        uint64 jobId;
        uint32 tokens;
        uint128 charge;
        /// sum of indexRate x seconds up to this observation (the previous index rate held until now)
        uint256 rateCumulative;
        /// tokens and charge summed over every observation up to and including this one
        uint256 tokensCumulative;
        uint256 chargeCumulative;
    }

    address public immutable owner;
    address public market;
    /// @notice the most one clearing can move the index, in basis points of the previous index rate
    uint16 public immutable maxStepBps;

    mapping(bytes32 => Observation[]) private _obs;
    mapping(bytes32 => string) public nameOf;
    bytes32[] public modelIds;

    event MarketSet(address market);
    event ModelListed(bytes32 indexed model, string name);
    event Recorded(bytes32 indexed model, uint256 indexed jobId, uint256 rate, uint256 indexRate, uint256 tokens, uint256 charge);

    error OnlyOwner();
    error OnlyMarket();
    error MarketAlreadySet();
    error NoObservations();
    error ZeroWindow();

    constructor(uint16 maxStepBps_) {
        owner = msg.sender;
        maxStepBps = maxStepBps_;
    }

    /// @notice One-time wiring to the market contract.
    function setMarket(address market_) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (market != address(0)) revert MarketAlreadySet();
        market = market_;
        emit MarketSet(market_);
    }

    function record(string calldata name, uint256 jobId, uint64 rate, uint32 tokens, uint128 charge) external {
        if (msg.sender != market) revert OnlyMarket();
        bytes32 id = keccak256(bytes(name));
        Observation[] storage obs = _obs[id];
        uint256 cum;
        uint256 tokCum = tokens;
        uint256 chCum = charge;
        uint64 indexRate = rate;
        if (obs.length == 0) {
            nameOf[id] = name;
            modelIds.push(id);
            emit ModelListed(id, name);
        } else {
            Observation storage last = obs[obs.length - 1];
            cum = last.rateCumulative + uint256(last.indexRate) * (block.timestamp - last.timestamp);
            tokCum += last.tokensCumulative;
            chCum += last.chargeCumulative;
            uint256 lo = (uint256(last.indexRate) * (10_000 - maxStepBps)) / 10_000;
            uint256 hi = (uint256(last.indexRate) * (10_000 + maxStepBps)) / 10_000;
            if (rate < lo) indexRate = uint64(lo);
            else if (rate > hi) indexRate = uint64(hi);
        }
        obs.push(
            Observation({
                timestamp: uint64(block.timestamp),
                rate: rate,
                indexRate: indexRate,
                jobId: uint64(jobId),
                tokens: tokens,
                charge: charge,
                rateCumulative: cum,
                tokensCumulative: tokCum,
                chargeCumulative: chCum
            })
        );
        emit Recorded(id, jobId, rate, indexRate, tokens, charge);
    }

    // ------------------------------------------------------------------ reads

    function modelId(string calldata name) external pure returns (bytes32) {
        return keccak256(bytes(name));
    }

    function modelCount() external view returns (uint256) {
        return modelIds.length;
    }

    function observationCount(bytes32 model) external view returns (uint256) {
        return _obs[model].length;
    }

    function observations(bytes32 model, uint256 from, uint256 limit) external view returns (Observation[] memory out) {
        Observation[] storage obs = _obs[model];
        if (from >= obs.length) return new Observation[](0);
        uint256 end = from + limit > obs.length ? obs.length : from + limit;
        out = new Observation[](end - from);
        for (uint256 i = from; i < end; i++) {
            out[i - from] = obs[i];
        }
    }

    function latest(bytes32 model) external view returns (uint256 rate, uint256 updatedAt, uint256 count) {
        Observation[] storage obs = _obs[model];
        count = obs.length;
        if (count == 0) return (0, 0, 0);
        Observation storage last = obs[count - 1];
        return (last.indexRate, last.timestamp, count);
    }

    function twap(bytes32 model, uint256 window) public view returns (uint256) {
        if (window == 0) revert ZeroWindow();
        Observation[] storage obs = _obs[model];
        uint256 n = obs.length;
        if (n == 0) revert NoObservations();
        Observation storage last = obs[n - 1];
        uint256 nowTs = block.timestamp;
        uint256 cumNow = last.rateCumulative + uint256(last.indexRate) * (nowTs - last.timestamp);
        uint256 start = nowTs > window ? nowTs - window : 0;
        uint256 cumStart;
        if (start <= obs[0].timestamp) {
            start = obs[0].timestamp;
            cumStart = obs[0].rateCumulative;
        } else {
            uint256 k = _lastAtOrBefore(obs, start);
            cumStart = obs[k].rateCumulative + uint256(obs[k].indexRate) * (start - obs[k].timestamp);
        }
        if (nowTs == start) return last.indexRate;
        return (cumNow - cumStart) / (nowTs - start);
    }

    function vwap(bytes32 model, uint256 window)
        external
        view
        returns (uint256 rate, uint256 tokens, uint256 usd, uint256 count)
    {
        if (window == 0) revert ZeroWindow();
        Observation[] storage obs = _obs[model];
        uint256 n = obs.length;
        if (n == 0) return (0, 0, 0, 0);
        uint256 start = block.timestamp > window ? block.timestamp - window : 0;
        uint256 k = _firstAtOrAfter(obs, start);
        if (k == n) return (0, 0, 0, 0);
        Observation storage last = obs[n - 1];
        tokens = last.tokensCumulative - (k == 0 ? 0 : obs[k - 1].tokensCumulative);
        usd = last.chargeCumulative - (k == 0 ? 0 : obs[k - 1].chargeCumulative);
        count = n - k;
        rate = tokens == 0 ? 0 : (usd * 1000) / tokens;
    }

    /// @dev index of the last observation with timestamp <= t (caller ensures obs[0].timestamp < t)
    function _lastAtOrBefore(Observation[] storage obs, uint256 t) private view returns (uint256) {
        uint256 lo = 0;
        uint256 hi = obs.length - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (obs[mid].timestamp <= t) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    /// @dev index of the first observation with timestamp >= t, or obs.length
    function _firstAtOrAfter(Observation[] storage obs, uint256 t) private view returns (uint256) {
        uint256 lo = 0;
        uint256 hi = obs.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (obs[mid].timestamp < t) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }
}
