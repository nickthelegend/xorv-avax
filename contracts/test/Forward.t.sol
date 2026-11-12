// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Base} from "./Base.t.sol";
import {XorvForward} from "../src/XorvForward.sol";
import {IXorvIndex} from "../src/XorvIndex.sol";

contract ForwardTest is Base {
    XorvForward fwd;
    address provider = makeAddr("provider-treasury");
    address app = makeAddr("app-buyer");

    function setUp() public override {
        super.setUp();
        fwd = new XorvForward(token, IXorvIndex(address(index)));
        _fund(provider, 1);
        _fund(app, 1);
        vm.prank(provider);
        token.approve(address(fwd), type(uint256).max);
        vm.prank(app);
        token.approve(address(fwd), type(uint256).max);
    }

    function _clear(uint64 low, uint64 high) internal {
        uint256 id = _post(false);
        _auction(id, _two(0, 1), _rates2(high, low));
        _deliver(id, HONEST, 600);
        _resolveWithRoll(id, false);
    }

    /// app goes long 1M tokens of compute at $0.30 per 1M (300 micro per 1k), for a week
    function _openWeek(uint64 strike) internal returns (uint256 id) {
        vm.prank(app);
        id = fwd.offer(MODEL, true, strike, 1_000_000, 5e6, 7 days);
        vm.prank(provider);
        fwd.take(id);
    }

    function test_computeGotDearerSoTheLongIsPaid() public {
        _clear(300, 400);
        uint256 id = _openWeek(300);
        // a week where the clearing price rises to 360 halfway through
        vm.warp(vm.getBlockTimestamp() + 3.5 days);
        _clear(360, 400);
        vm.warp(vm.getBlockTimestamp() + 3.5 days);
        uint256 a0 = token.balanceOf(app);
        uint256 p0 = token.balanceOf(provider);
        fwd.settle(id);
        XorvForward.Forward memory f = fwd.getForward(id);
        assertEq(uint8(f.state), uint8(XorvForward.State.Settled));
        assertApproxEqAbs(f.settleRate, 330, 1, "TWAP of 300 then 360");
        int256 p = f.payoffToLong;
        assertGt(p, 0);
        assertEq(token.balanceOf(app), a0 + 5e6 + uint256(p));
        assertEq(token.balanceOf(provider), p0 + 5e6 - uint256(p));
        assertEq(token.balanceOf(address(fwd)), 0);
    }

    function test_computeGotCheaperSoTheShortIsPaid() public {
        _clear(300, 400);
        uint256 id = _openWeek(300);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        _clear(240, 400);
        vm.warp(vm.getBlockTimestamp() + 6 days);
        uint256 p0 = token.balanceOf(provider);
        fwd.settle(id);
        int256 p = fwd.getForward(id).payoffToLong;
        assertLt(p, 0);
        assertEq(token.balanceOf(provider), p0 + 5e6 + uint256(-p));
    }

    function test_payoffIsCappedAtMargin() public {
        _clear(300, 400);
        uint256 id = _openWeek(1);
        assertEq(fwd.payoffAt(id, 1_000_000), int256(5e6));
        assertEq(fwd.payoffAt(id, 0), -int256(1000));
    }

    function test_cannotSettleEarlyOrLate_andRefundsAfterTheWindow() public {
        _clear(300, 400);
        uint256 id = _openWeek(300);
        vm.expectRevert(XorvForward.NotExpired.selector);
        fwd.settle(id);
        vm.expectRevert(XorvForward.SettleWindowOpen.selector);
        fwd.refundExpired(id);
        vm.warp(vm.getBlockTimestamp() + 7 days + 1 days + 1);
        vm.expectRevert(XorvForward.SettleWindowOver.selector);
        fwd.settle(id);
        uint256 a0 = token.balanceOf(app);
        fwd.refundExpired(id);
        assertEq(token.balanceOf(app), a0 + 5e6);
    }

    function test_aWashBidCannotMoveTheSettlement() public {
        _clear(300, 400);
        uint256 id = _openWeek(300);
        vm.warp(vm.getBlockTimestamp() + 7 days - 30);
        // the short tries to drag the index down at the last moment with a bid it never delivers
        uint256 j = _post(false);
        _auction(j, _two(2, 3), _rates2(400, 1));
        vm.warp(vm.getBlockTimestamp() + 61);
        market.advance(j);
        fwd.settle(id);
        assertEq(fwd.getForward(id).settleRate, 300, "the undelivered wash bid never reached the index");
    }

    function test_offerRules() public {
        vm.startPrank(app);
        vm.expectRevert(XorvForward.BadTerms.selector);
        fwd.offer(MODEL, true, 300, 1000, 1e6, 5 minutes);
        uint256 id = fwd.offer(MODEL, true, 300, 1000, 1e6, 1 hours);
        vm.expectRevert(XorvForward.SelfTrade.selector);
        fwd.take(id);
        fwd.cancel(id);
        vm.stopPrank();
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(XorvForward.WrongState.selector, XorvForward.State.Cancelled));
        fwd.take(id);
    }
}
