// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Base} from "./Base.t.sol";
import {XorvMarket} from "../src/XorvMarket.sol";
import {XorvRegistry} from "../src/XorvRegistry.sol";

contract MarketTest is Base {
    // ------------------------------------------------------------------ auction

    function test_lowestRevealedRateWinsAndBuyerPaysOnlyUsedTokens() public {
        uint256 id = _post(false);
        uint256 escrow = market.escrowFor(1000, 1000);
        assertEq(escrow, 1000 + 400);
        assertEq(token.balanceOf(address(market)), escrow);
        uint256 buyerBefore = token.balanceOf(buyer);

        _auction(id, _three(0, 1, 2), _rates3(300, 250, 400));
        XorvMarket.Job memory j = market.getJob(id);
        assertEq(uint8(j.status), uint8(XorvMarket.Status.Running), "auction closed early once all revealed");
        assertEq(j.winner, owners[1]);
        assertEq(j.clearedRate, 250);
        assertEq(j.revealed, 3);

        _deliver(id, HONEST, 600);
        _resolveWithRoll(id, false);
        j = market.getJob(id);
        assertEq(uint8(j.status), uint8(XorvMarket.Status.Done));
        assertEq(uint8(j.outcome), uint8(XorvMarket.Outcome.PaidNotSampled));
        assertEq(j.charge, 150, "250 per 1k x 600 tokens");
        assertEq(registry.getProvider(owners[1]).earned, 150);
        assertEq(token.balanceOf(buyer), buyerBefore + escrow - 150, "unused escrow refunded");
        assertEq(market.totalEscrow(), 0);
        assertEq(token.balanceOf(address(market)), 0);
        assertEq(registry.getProvider(owners[0]).active, 0, "losers unlocked");
        assertEq(registry.getProvider(owners[1]).active, 0, "winner unlocked");
    }

    function test_tieGoesToHigherStakeThenEarlierCommit() public {
        vm.startPrank(owners[2]);
        token.approve(address(registry), type(uint256).max);
        registry.addStake(5e6);
        vm.stopPrank();
        uint256 id = _post(false);
        _auction(id, _three(0, 1, 2), _rates3(300, 300, 300));
        assertEq(market.getJob(id).winner, owners[2]);
    }

    function test_revealMustMatchSealedBid() public {
        uint256 id = _post(false);
        _commit(id, 0, 300);
        vm.warp(vm.getBlockTimestamp() + 11);
        vm.prank(nodes[0]);
        vm.expectRevert(XorvMarket.RevealMismatch.selector);
        market.revealBid(id, 299, _salt(0));
    }

    function test_revealWindowRules() public {
        uint256 id = _post(false);
        _commit(id, 0, 300);
        vm.prank(nodes[0]);
        vm.expectRevert(XorvMarket.WindowOpen.selector);
        market.revealBid(id, 300, _salt(0));
        vm.warp(vm.getBlockTimestamp() + 11);
        bytes32 c = market.bidCommitment(id, nodes[1], 1, _salt(1));
        vm.prank(nodes[1]);
        vm.expectRevert(XorvMarket.WindowClosed.selector);
        market.commitBid(id, c);
        vm.warp(vm.getBlockTimestamp() + 10);
        vm.prank(nodes[0]);
        vm.expectRevert(XorvMarket.WindowClosed.selector);
        market.revealBid(id, 300, _salt(0));
    }

    function test_bidAboveBuyerCeilingRejected() public {
        uint256 id = _post(false);
        _commit(id, 0, 1001);
        vm.warp(vm.getBlockTimestamp() + 11);
        vm.prank(nodes[0]);
        vm.expectRevert(XorvMarket.AboveMaxRate.selector);
        market.revealBid(id, 1001, _salt(0));
    }

    function test_oneBidPerProviderAndOnlyNodesBid() public {
        uint256 id = _post(false);
        _commit(id, 0, 300);
        vm.prank(nodes[0]);
        vm.expectRevert(XorvMarket.OneBidPerProvider.selector);
        market.commitBid(id, bytes32(uint256(1)));
        vm.prank(owners[0]);
        vm.expectRevert(XorvMarket.NotNode.selector);
        market.commitBid(id, bytes32(uint256(1)));
    }

    function test_unbondingOrWrongModelCannotBid() public {
        vm.prank(owners[0]);
        registry.requestUnstake(1e6);
        string[] memory other = new string[](1);
        other[0] = "groq:llama-3.1-8b-instant";
        vm.prank(owners[1]);
        registry.updateProfile("birch", "api", other);
        uint256 id = _post(false);
        vm.prank(nodes[0]);
        vm.expectRevert(XorvMarket.NotEligible.selector);
        market.commitBid(id, bytes32(uint256(1)));
        vm.prank(nodes[1]);
        vm.expectRevert(XorvMarket.NotEligible.selector);
        market.commitBid(id, bytes32(uint256(1)));
    }

    function test_noRevealsExpiresAndRefundsInFull() public {
        uint256 id = _post(false);
        uint256 before = token.balanceOf(buyer);
        _commit(id, 0, 300);
        vm.warp(vm.getBlockTimestamp() + 21);
        market.advance(id);
        XorvMarket.Job memory j = market.getJob(id);
        assertEq(uint8(j.status), uint8(XorvMarket.Status.Expired));
        assertEq(token.balanceOf(buyer), before + market.escrowFor(1000, 1000));
        assertEq(registry.getProvider(owners[0]).active, 0);
    }

    function test_onlyWinnerNodeDelivers() public {
        uint256 id = _post(false);
        _auction(id, _two(0, 1), _rates2(300, 250));
        vm.prank(nodes[0]);
        vm.expectRevert(XorvMarket.NotWinnerNode.selector);
        market.deliver(id, HONEST, 600);
    }

    function test_tokensAreCappedAtBuyerMax() public {
        uint256 id = _post(false);
        _auction(id, _two(0, 1), _rates2(300, 250));
        _deliver(id, HONEST, 50_000);
        assertEq(market.getJob(id).tokens, 1000);
    }

    // ------------------------------------------------------------------ spot checks and slashing

    function test_sampledCheckMatchesAndPaysCheckerFee() public {
        uint256 id = _post(false);
        _auction(id, _two(0, 1), _rates2(300, 250));
        _deliver(id, HONEST, 600);
        _resolveWithRoll(id, true);
        XorvMarket.Job memory j = market.getJob(id);
        assertEq(uint8(j.status), uint8(XorvMarket.Status.Checking));
        address c = _checker(id, 0);
        assertTrue(c != nodes[1], "winner never checks itself");
        vm.prank(c);
        market.deliverCheck(id, HONEST2, 590, HONEST, "");
        j = market.getJob(id);
        assertEq(uint8(j.outcome), uint8(XorvMarket.Outcome.PaidCheckMatched));
        (,,,,,, uint16 sim, bool delivered) = market.checks(id, 0);
        assertTrue(delivered);
        assertGe(sim, 6000);
        assertEq(registry.getProvider(registry.ownerOfNode(c)).earned, 200, "check fee");
        assertEq(registry.getProvider(owners[1]).earned, 150);
    }

    function test_alwaysCheckJobsAreAlwaysSampled() public {
        uint256 id = _post(true);
        _auction(id, _two(0, 1), _rates2(300, 250));
        _deliver(id, HONEST, 600);
        _resolveWithRoll(id, false); // a roll that would skip a normal job
        assertEq(uint8(market.getJob(id).status), uint8(XorvMarket.Status.Checking));
    }

    function test_checkerMustQuoteTheRealResult() public {
        uint256 id = _post(true);
        _auction(id, _two(0, 1), _rates2(300, 250));
        _deliver(id, HONEST, 600);
        _resolve(id);
        address c = _checker(id, 0);
        vm.prank(c);
        vm.expectRevert(XorvMarket.ResultHashMismatch.selector);
        market.deliverCheck(id, HONEST2, 590, JUNK, "");
        vm.prank(nodes[1]);
        vm.expectRevert(XorvMarket.NotDrawnChecker.selector);
        market.deliverCheck(id, HONEST2, 590, HONEST, "");
    }

    function test_lyingProviderIsSlashedAndBuyerCompensated() public {
        uint256 id = _post(true);
        _auction(id, _two(0, 1), _rates2(300, 250));
        _deliver(id, JUNK, 600);
        _resolve(id);
        address c0 = _checker(id, 0);
        vm.prank(c0);
        market.deliverCheck(id, HONEST, 600, JUNK, "");
        XorvMarket.Job memory j = market.getJob(id);
        assertEq(uint8(j.status), uint8(XorvMarket.Status.Mismatch));
        _resolve(id);
        address c1 = _checker(id, 1);
        assertTrue(c1 != c0 && c1 != nodes[1], "tiebreaker is a third node");
        uint256 buyerBefore = token.balanceOf(buyer);
        vm.prank(c1);
        market.deliverCheck(id, HONEST2, 600, JUNK, HONEST);
        j = market.getJob(id);
        assertEq(uint8(j.status), uint8(XorvMarket.Status.Faulted));
        assertEq(uint8(j.outcome), uint8(XorvMarket.Outcome.FaultedTiebreakSidedWithChecker));
        XorvRegistry.Provider memory liar = registry.getProvider(owners[1]);
        assertEq(liar.stake, STAKE - 1e6, "10% slashed");
        assertEq(liar.slashes, 1);
        assertEq(liar.earned, 0, "liar not paid");
        uint256 escrow = market.escrowFor(1000, 1000);
        assertEq(token.balanceOf(buyer), buyerBefore + 1e6 + escrow - 400, "slash + refund minus two check fees");
        assertEq(index.observationCount(keccak256(bytes(MODEL))), 0, "a slashed delivery never reaches the index");
    }

    function test_lyingCheckerIsSlashedAndProviderPaid() public {
        uint256 id = _post(true);
        _auction(id, _two(0, 1), _rates2(300, 250));
        _deliver(id, HONEST, 600);
        _resolve(id);
        address c0 = _checker(id, 0);
        vm.prank(c0);
        market.deliverCheck(id, JUNK, 10, HONEST, "");
        _resolve(id);
        address c1 = _checker(id, 1);
        vm.prank(c1);
        market.deliverCheck(id, HONEST2, 600, HONEST, JUNK);
        XorvMarket.Job memory j = market.getJob(id);
        assertEq(uint8(j.outcome), uint8(XorvMarket.Outcome.PaidTiebreakSidedWithProvider));
        address liarOwner = registry.ownerOfNode(c0);
        assertEq(registry.getProvider(liarOwner).stake, STAKE - 1e6);
        assertEq(registry.getProvider(liarOwner).earned, 0, "lying checker gets no fee");
        assertEq(registry.getProvider(owners[1]).earned, 150 + 1e6, "provider paid plus the checker's slash");
    }

    function test_winnerThatNeverDeliversIsSlashed() public {
        uint256 id = _post(false);
        _auction(id, _two(0, 1), _rates2(300, 250));
        uint256 before = token.balanceOf(buyer);
        vm.expectRevert(XorvMarket.WindowOpen.selector);
        market.advance(id);
        vm.warp(vm.getBlockTimestamp() + 61);
        market.advance(id);
        XorvMarket.Job memory j = market.getJob(id);
        assertEq(uint8(j.outcome), uint8(XorvMarket.Outcome.FaultedNoDelivery));
        assertEq(registry.getProvider(owners[1]).stake, STAKE - 1e6);
        assertEq(token.balanceOf(buyer), before + 1e6 + market.escrowFor(1000, 1000));
    }

    function test_checkerTimeoutStillPaysProvider() public {
        uint256 id = _post(true);
        _auction(id, _two(0, 1), _rates2(300, 250));
        _deliver(id, HONEST, 600);
        _resolve(id);
        vm.warp(vm.getBlockTimestamp() + 61);
        market.advance(id);
        assertEq(uint8(market.getJob(id).outcome), uint8(XorvMarket.Outcome.PaidCheckerTimeout));
    }

    function test_drawCannotResolveInDeliveryBlock() public {
        uint256 id = _post(true);
        _auction(id, _two(0, 1), _rates2(300, 250));
        _deliver(id, HONEST, 600);
        vm.expectRevert(XorvMarket.DrawNotReady.selector);
        market.resolveDraw(id);
        vm.roll(vm.getBlockNumber() + 1);
        market.resolveDraw(id);
        assertEq(uint8(market.getJob(id).status), uint8(XorvMarket.Status.Checking));
    }

    function test_agedOutDrawBlockForcesACheck() public {
        uint256 id = _post(false);
        _auction(id, _two(0, 1), _rates2(300, 250));
        _deliver(id, HONEST, 600);
        XorvMarket.Job memory j = market.getJob(id);
        vm.roll(j.drawBlock + 300);
        vm.setBlockhash(j.drawBlock, bytes32(0));
        market.resolveDraw(id);
        assertEq(uint8(market.getJob(id).status), uint8(XorvMarket.Status.Checking));
    }

    // ------------------------------------------------------------------ stake

    function test_stakeRulesAndNodeCannotWithdraw() public {
        uint256 id = _post(false);
        _commit(id, 0, 300);
        vm.startPrank(owners[0]);
        registry.requestUnstake(STAKE);
        vm.expectRevert(XorvRegistry.StillUnbonding.selector);
        registry.withdrawStake();
        vm.warp(vm.getBlockTimestamp() + 1801);
        vm.expectRevert(XorvRegistry.OpenJobs.selector);
        registry.withdrawStake();
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + 1);
        market.advance(id); // expires, unlocks
        vm.prank(nodes[0]);
        vm.expectRevert(XorvRegistry.NotProvider.selector);
        registry.withdrawStake();
        uint256 before = token.balanceOf(owners[0]);
        vm.prank(owners[0]);
        registry.withdrawStake();
        assertEq(token.balanceOf(owners[0]), before + STAKE);
    }

    function test_onlyMarketTouchesStake() public {
        vm.expectRevert(XorvRegistry.OnlyMarket.selector);
        registry.slash(owners[0], buyer, 0, "x");
        vm.expectRevert(XorvRegistry.OnlyMarket.selector);
        registry.credit(owners[0], 1, 0);
    }

    function test_earningsWithdrawByOwnerOnly() public {
        uint256 id = _post(false);
        _auction(id, _two(0, 1), _rates2(300, 250));
        _deliver(id, HONEST, 600);
        _resolveWithRoll(id, false);
        vm.prank(nodes[1]);
        vm.expectRevert(XorvRegistry.NotProvider.selector);
        registry.withdrawEarnings(nodes[1]);
        address treasury = makeAddr("treasury");
        vm.prank(owners[1]);
        registry.withdrawEarnings(treasury);
        assertEq(token.balanceOf(treasury), 150);
    }

    function testFuzz_escrowIsAlwaysFullyAccounted(uint64 rateA, uint64 rateB, uint32 tokens, bool sampled) public {
        rateA = uint64(bound(rateA, 1, 1000));
        rateB = uint64(bound(rateB, 1, 1000));
        tokens = uint32(bound(tokens, 0, 5000));
        uint256 id = _post(false);
        uint256 total = token.balanceOf(buyer) + token.balanceOf(address(market)) + token.balanceOf(address(registry));
        _auction(id, _two(0, 1), _rates2(rateA, rateB));
        _deliver(id, HONEST, tokens);
        _resolveWithRoll(id, sampled);
        if (sampled) {
            vm.prank(_checker(id, 0));
            market.deliverCheck(id, HONEST2, tokens, HONEST, "");
        }
        assertEq(token.balanceOf(address(market)), 0, "market holds nothing once closed");
        assertEq(token.balanceOf(address(registry)), registry.totalStaked() + registry.totalEarnedUnclaimed());
        assertEq(token.balanceOf(buyer) + token.balanceOf(address(registry)), total);
    }
}
