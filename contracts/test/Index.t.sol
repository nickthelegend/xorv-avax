// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Base} from "./Base.t.sol";
import {XorvIndex, IXorvIndex} from "../src/XorvIndex.sol";
import {XorvMarket} from "../src/XorvMarket.sol";
import {Similarity} from "../src/Similarity.sol";

/// Any contract can price compute off the index.
contract ComputeQuoter {
    IXorvIndex public immutable index;

    constructor(IXorvIndex index_) {
        index = index_;
    }

    function quote(string calldata model, uint256 tokens) external view returns (uint256) {
        uint256 rate = index.twap(index.modelId(model), 1 hours);
        return (rate * tokens) / 1000;
    }
}

contract SimilarityHarness {
    function sim(bytes calldata a, bytes calldata b) external pure returns (uint256) {
        return Similarity.jaccardBps(a, b);
    }
}

contract IndexTest is Base {
    bytes32 M;

    function setUp() public override {
        super.setUp();
        M = keccak256(bytes(MODEL));
    }

    /// a full paid job: two bidders, the lower rate wins, delivered, not sampled
    function _clear(uint64 low, uint64 high, uint32 tokens) internal returns (uint256 id) {
        id = _post(false);
        _auction(id, _two(0, 1), _rates2(high, low));
        _deliver(id, HONEST, tokens);
        _resolveWithRoll(id, false);
    }

    function test_paidCompetitiveClearingUpdatesTheIndex() public {
        uint256 id = _clear(250, 300, 600);
        (uint256 rate, uint256 at, uint256 n) = index.latest(M);
        assertEq(rate, 250);
        assertEq(at, vm.getBlockTimestamp());
        assertEq(n, 1);
        assertEq(index.nameOf(M), MODEL);
        assertEq(index.modelCount(), 1);
        XorvIndex.Observation[] memory obs = index.observations(M, 0, 10);
        assertEq(obs[0].jobId, id);
        assertEq(obs[0].tokens, 600);
        assertEq(obs[0].charge, 150);
        (uint256 v, uint256 tokens, uint256 usd, uint256 count) = index.vwap(M, 1 hours);
        assertEq(v, 250);
        assertEq(tokens, 600);
        assertEq(usd, 150);
        assertEq(count, 1);
    }

    function test_twapWeighsTimeAndVwapWeighsTokens() public {
        _clear(200, 300, 1000);
        vm.warp(vm.getBlockTimestamp() + 30 minutes);
        _clear(240, 300, 100);
        vm.warp(vm.getBlockTimestamp() + 30 minutes);
        // 200 held for 30 min, then 240 for 30 min (within the 25% step)
        assertEq(index.twap(M, 1 hours), 220);
        (uint256 v,,, uint256 count) = index.vwap(M, 2 hours);
        assertEq(count, 2);
        assertEq(v, uint256(203), "token-weighted: (200 + 24) / 1.1k tokens");
    }

    function test_anyContractCanReadTheIndex() public {
        _clear(250, 300, 600);
        vm.warp(vm.getBlockTimestamp() + 10 minutes);
        ComputeQuoter q = new ComputeQuoter(index);
        assertEq(q.quote(MODEL, 4000), 1000);
    }

    // ------------------------------------------------------------------ manipulation

    function test_washBidWithoutDeliveryNeverMovesTheIndex() public {
        _clear(250, 300, 600);
        // a whale wins at 1 per 1k and walks away without delivering
        uint256 id = _post(false);
        _auction(id, _two(0, 2), _rates2(300, 1));
        vm.warp(vm.getBlockTimestamp() + 61);
        market.advance(id);
        assertEq(uint8(market.getJob(id).outcome), uint8(XorvMarket.Outcome.FaultedNoDelivery));
        (uint256 rate,, uint256 n) = index.latest(M);
        assertEq(rate, 250);
        assertEq(n, 1);
    }

    function test_bidsAloneAndExpiredAuctionsNeverMoveTheIndex() public {
        uint256 id = _post(false);
        _commit(id, 0, 1);
        vm.warp(vm.getBlockTimestamp() + 21);
        market.advance(id);
        assertEq(index.observationCount(M), 0);
    }

    function test_singleBidderJobIsNotIndexed() public {
        uint256 id = _post(false);
        _commit(id, 0, 5);
        vm.warp(vm.getBlockTimestamp() + 11);
        _reveal(id, 0, 5);
        _deliver(id, HONEST, 600);
        vm.recordLogs();
        _resolveWithRoll(id, false);
        assertEq(uint8(market.getJob(id).status), uint8(XorvMarket.Status.Done), "still paid");
        assertEq(index.observationCount(M), 0, "but no competitive price");
    }

    function test_buyerWinningItsOwnJobIsNotIndexed() public {
        // provider 0's owner buys compute and its own node wins
        address self = owners[0];
        vm.startPrank(self);
        token.approve(address(market), type(uint256).max);
        uint256 id = market.postJob(_params(false));
        vm.stopPrank();
        _auction(id, _two(0, 1), _rates2(1, 300));
        _deliver(id, HONEST, 600);
        _resolveWithRoll(id, false);
        assertEq(market.getJob(id).winner, self);
        assertEq(index.observationCount(M), 0);
    }

    function test_slashedDeliveryIsNotIndexed() public {
        uint256 id = _post(true);
        _auction(id, _two(0, 1), _rates2(300, 1));
        _deliver(id, JUNK, 600);
        _resolve(id);
        vm.prank(_checker(id, 0));
        market.deliverCheck(id, HONEST, 600, JUNK, "");
        _resolve(id);
        vm.prank(_checker(id, 1));
        market.deliverCheck(id, HONEST2, 600, JUNK, HONEST);
        assertEq(uint8(market.getJob(id).status), uint8(XorvMarket.Status.Faulted));
        assertEq(index.observationCount(M), 0);
    }

    function test_oneOutlierClearingMovesTheIndexAtMost25Percent() public {
        _clear(400, 500, 600);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        // a real, delivered clearing at 1 per 1k
        _clear(1, 500, 600);
        XorvIndex.Observation[] memory obs = index.observations(M, 0, 10);
        assertEq(obs[1].rate, 1, "the job record keeps the true clearing");
        assertEq(obs[1].indexRate, 300, "the index steps 25% at most");
        (uint256 rate,,) = index.latest(M);
        assertEq(rate, 300);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        assertEq(index.twap(M, 2 hours), 350, "1h at 400, 1h at 300");
    }

    function test_onlyTheMarketWrites() public {
        vm.expectRevert(XorvIndex.OnlyMarket.selector);
        index.record(MODEL, 0, 1, 1000, 1);
        vm.expectRevert(XorvIndex.MarketAlreadySet.selector);
        index.setMarket(address(this));
    }

    function test_emptyIndexReads() public {
        (uint256 rate,, uint256 n) = index.latest(M);
        assertEq(rate, 0);
        assertEq(n, 0);
        vm.expectRevert(XorvIndex.NoObservations.selector);
        index.twap(M, 1 hours);
        (uint256 v,,,) = index.vwap(M, 1 hours);
        assertEq(v, 0);
    }

    // ------------------------------------------------------------------ similarity

    function test_similarity() public {
        SimilarityHarness h = new SimilarityHarness();
        assertEq(h.sim(bytes(HONEST), bytes(HONEST)), 10_000);
        assertEq(h.sim(bytes("Hello, World!"), bytes("world hello")), 10_000, "case and punctuation ignored");
        assertEq(h.sim(bytes(HONEST), bytes(JUNK)), 0);
        assertEq(h.sim(bytes(""), bytes("")), 10_000);
        assertEq(h.sim(bytes("a b c d"), bytes("a b x y")), 3333);
        assertGe(h.sim(bytes(HONEST), bytes(HONEST2)), 6000);
    }

    function test_similarityOnMaxLengthOutputsFitsInABlock() public {
        SimilarityHarness h = new SimilarityHarness();
        bytes memory a = new bytes(6000);
        bytes memory b = new bytes(6000);
        for (uint256 i; i < 6000; i++) {
            a[i] = i % 7 == 6 ? bytes1(" ") : bytes1(uint8(97 + ((i * 31) % 26)));
            b[i] = i % 6 == 5 ? bytes1(" ") : bytes1(uint8(97 + ((i * 17) % 26)));
        }
        uint256 g = gasleft();
        h.sim(a, b);
        assertLt(g - gasleft(), 4_000_000, "two 6,000-byte texts stay far below the Fuji block gas limit");
    }
}
