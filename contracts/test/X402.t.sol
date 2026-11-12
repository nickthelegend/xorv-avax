// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Base} from "./Base.t.sol";
import {TestDollar} from "../src/TestDollar.sol";
import {XorvMarket} from "../src/XorvMarket.sol";
import {X402Router} from "../src/X402Router.sol";

contract X402Test is Base {
    address facilitator = makeAddr("gateway");

    function _payAndPost(X402Router.Authorization memory a) internal returns (uint256) {
        vm.prank(facilitator);
        return router.payAndPost(_params(false), a);
    }

    function test_x402PaymentFundsAJobOwnedByTheSigner() public {
        uint256 value = market.escrowFor(1000, 1000);
        uint256 before = token.balanceOf(buyer);
        X402Router.Authorization memory a =
            _auth(buyerKey, address(router), value, vm.getBlockTimestamp() - 1, vm.getBlockTimestamp() + 60, keccak256("n1"));
        uint256 id = _payAndPost(a);
        XorvMarket.Job memory j = market.getJob(id);
        assertEq(j.buyer, buyer, "buyer owns the job, not the facilitator");
        assertTrue(j.viaX402);
        assertEq(j.escrow, value);
        assertEq(token.balanceOf(buyer), before - value);
        assertEq(token.balanceOf(address(router)), 0, "router keeps nothing");
        assertTrue(token.authorizationState(buyer, keccak256("n1")));

        // the refund goes back to the signer
        _auction(id, _two(0, 1), _rates2(300, 250));
        _deliver(id, HONEST, 600);
        _resolveWithRoll(id, false);
        assertEq(token.balanceOf(buyer), before - 150);
    }

    function test_x402ReplayIsRejected() public {
        uint256 value = market.escrowFor(1000, 1000);
        X402Router.Authorization memory a =
            _auth(buyerKey, address(router), value, vm.getBlockTimestamp() - 1, vm.getBlockTimestamp() + 60, keccak256("n1"));
        _payAndPost(a);
        vm.prank(facilitator);
        vm.expectRevert(X402Router.AuthorizationAlreadyUsed.selector);
        router.payAndPost(_params(false), a);
        assertEq(market.jobCount(), 1);
    }

    function test_x402ReplayDirectlyOnTheTokenIsRejected() public {
        uint256 value = market.escrowFor(1000, 1000);
        X402Router.Authorization memory a =
            _auth(buyerKey, address(router), value, vm.getBlockTimestamp() - 1, vm.getBlockTimestamp() + 60, keccak256("n1"));
        _payAndPost(a);
        vm.expectRevert(TestDollar.AuthorizationUsedOrCanceled.selector);
        token.transferWithAuthorization(a.from, address(router), a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
    }

    function test_x402ExpiredAuthorizationIsRejected() public {
        uint256 value = market.escrowFor(1000, 1000);
        X402Router.Authorization memory a =
            _auth(buyerKey, address(router), value, vm.getBlockTimestamp() - 100, vm.getBlockTimestamp() + 30, keccak256("n2"));
        vm.warp(vm.getBlockTimestamp() + 30);
        vm.prank(facilitator);
        vm.expectRevert(TestDollar.AuthorizationExpired.selector);
        router.payAndPost(_params(false), a);
    }

    function test_x402NotYetValidIsRejected() public {
        uint256 value = market.escrowFor(1000, 1000);
        X402Router.Authorization memory a =
            _auth(buyerKey, address(router), value, vm.getBlockTimestamp() + 10, vm.getBlockTimestamp() + 60, keccak256("n3"));
        vm.prank(facilitator);
        vm.expectRevert(TestDollar.AuthorizationNotYetValid.selector);
        router.payAndPost(_params(false), a);
    }

    function test_x402UnderpaymentIsRejected() public {
        uint256 value = market.escrowFor(1000, 1000) - 1;
        X402Router.Authorization memory a =
            _auth(buyerKey, address(router), value, vm.getBlockTimestamp() - 1, vm.getBlockTimestamp() + 60, keccak256("n4"));
        vm.prank(facilitator);
        vm.expectRevert(abi.encodeWithSelector(X402Router.PaymentTooSmall.selector, value + 1));
        router.payAndPost(_params(false), a);
    }

    function test_x402TamperedAmountOrSignerIsRejected() public {
        uint256 value = market.escrowFor(1000, 1000);
        X402Router.Authorization memory a =
            _auth(buyerKey, address(router), value, vm.getBlockTimestamp() - 1, vm.getBlockTimestamp() + 60, keccak256("n5"));
        a.value = value * 10; // facilitator tries to take more than was signed
        vm.prank(facilitator);
        vm.expectRevert(TestDollar.InvalidSignature.selector);
        router.payAndPost(_params(false), a);

        (address mallory, uint256 malloryKey) = makeAddrAndKey("mallory");
        X402Router.Authorization memory b =
            _auth(malloryKey, address(router), value, vm.getBlockTimestamp() - 1, vm.getBlockTimestamp() + 60, keccak256("n6"));
        b.from = buyer; // claims to spend the buyer's money with mallory's signature
        vm.prank(facilitator);
        vm.expectRevert(TestDollar.InvalidSignature.selector);
        router.payAndPost(_params(false), b);
        assertTrue(mallory != buyer);
    }

    function test_x402SignedForAnotherPayeeIsRejected() public {
        uint256 value = market.escrowFor(1000, 1000);
        X402Router.Authorization memory a =
            _auth(buyerKey, facilitator, value, vm.getBlockTimestamp() - 1, vm.getBlockTimestamp() + 60, keccak256("n7"));
        vm.prank(facilitator);
        vm.expectRevert(TestDollar.InvalidSignature.selector);
        router.payAndPost(_params(false), a);
    }

    function test_x402CanceledAuthorizationIsRejected() public {
        uint256 value = market.escrowFor(1000, 1000);
        bytes32 nonce = keccak256("n8");
        X402Router.Authorization memory a =
            _auth(buyerKey, address(router), value, vm.getBlockTimestamp() - 1, vm.getBlockTimestamp() + 60, nonce);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(token.CANCEL_AUTHORIZATION_TYPEHASH(), buyer, nonce))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerKey, digest);
        token.cancelAuthorization(buyer, nonce, v, r, s);
        vm.prank(facilitator);
        vm.expectRevert(X402Router.AuthorizationAlreadyUsed.selector);
        router.payAndPost(_params(false), a);
    }

    function test_onlyRouterPostsX402Jobs() public {
        vm.expectRevert(XorvMarket.OnlyRouter.selector);
        market.postJobX402(_params(false), buyer, 1e6, bytes32(0));
    }

    function test_frontRunDirectTransferFailsLoudlyAndIsRefundable() public {
        uint256 value = market.escrowFor(1000, 1000);
        X402Router.Authorization memory a =
            _auth(buyerKey, address(router), value, vm.getBlockTimestamp() - 1, vm.getBlockTimestamp() + 60, keccak256("n9"));
        // a mempool watcher submits the authorization straight to the token
        token.transferWithAuthorization(a.from, address(router), a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
        vm.prank(facilitator);
        vm.expectRevert(X402Router.AuthorizationAlreadyUsed.selector);
        router.payAndPost(_params(false), a);
        assertEq(market.jobCount(), 0);
        assertEq(token.balanceOf(address(router)), value);
        uint256 before = token.balanceOf(buyer);
        router.refundStray(a);
        assertEq(token.balanceOf(buyer), before + value, "stray payment returned to the signer");
        vm.expectRevert(X402Router.NotAStrayPayment.selector);
        router.refundStray(a);
    }

    function test_refundStrayCannotDrainPostedJobs() public {
        uint256 value = market.escrowFor(1000, 1000);
        X402Router.Authorization memory a =
            _auth(buyerKey, address(router), value, vm.getBlockTimestamp() - 1, vm.getBlockTimestamp() + 60, keccak256("n10"));
        _payAndPost(a);
        vm.expectRevert(X402Router.NotAStrayPayment.selector);
        router.refundStray(a);
        // a different (unsigned) value for the same nonce does not match the consumed digest
        X402Router.Authorization memory b = a;
        b.value = 1;
        vm.expectRevert(X402Router.NotAStrayPayment.selector);
        router.refundStray(b);
    }

    function test_faucetCooldown() public {
        address u = makeAddr("u");
        vm.prank(u);
        token.faucet();
        vm.prank(u);
        vm.expectRevert(abi.encodeWithSelector(TestDollar.FaucetCooldown.selector, vm.getBlockTimestamp() + 1 hours));
        token.faucet();
        assertEq(token.balanceOf(u), 100e6);
    }
}
