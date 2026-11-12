// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {TestDollar} from "../src/TestDollar.sol";
import {XorvIndex} from "../src/XorvIndex.sol";
import {XorvRegistry} from "../src/XorvRegistry.sol";
import {XorvMarket, IXorvRegistry, IXorvIndexWriter} from "../src/XorvMarket.sol";
import {X402Router} from "../src/X402Router.sol";

abstract contract Base is Test {
    string constant MODEL = "groq:openai/gpt-oss-20b";
    string constant PROMPT = "Explain in two sentences why sealed-bid auctions resist price collusion.";
    string constant HONEST =
        "Sealed bids hide each price until every bidder has committed, so nobody can watch and undercut a rival at the last second. That makes quiet coordination hard to enforce, since a cartel member can cheat without being seen until it is too late.";
    string constant HONEST2 =
        "Sealed bids hide every price until all bidders have committed, so no one can watch and undercut a rival at the last second. That makes coordination hard to enforce, because a cartel member can cheat unseen until it is too late.";
    string constant JUNK = "lorem ipsum dolor sit amet placeholder output";

    TestDollar token;
    XorvIndex index;
    XorvRegistry registry;
    XorvMarket market;
    X402Router router;

    address buyer;
    uint256 buyerKey;
    address[4] owners;
    address[4] nodes;
    uint256 nonceSalt;

    uint128 constant STAKE = 10e6;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        vm.roll(100);
        token = new TestDollar();
        index = new XorvIndex(2500);
        registry = new XorvRegistry(token, 5e6, 1000, 1800);
        market = new XorvMarket(
            token,
            IXorvRegistry(address(registry)),
            IXorvIndexWriter(address(index)),
            XorvMarket.Config({spotCheckBps: 3000, toleranceBps: 6000, checkFee: 200, minWindowSecs: 3, maxWindowSecs: 600})
        );
        router = new X402Router(market);
        registry.setMarket(address(market));
        index.setMarket(address(market));
        market.setRouter(address(router));

        (buyer, buyerKey) = makeAddrAndKey("buyer");
        _fund(buyer, 2);
        string[] memory models = new string[](1);
        models[0] = MODEL;
        string[4] memory labels = ["atlas", "birch", "cobalt", "dune"];
        for (uint256 i; i < 4; i++) {
            owners[i] = makeAddr(string.concat(labels[i], "-owner"));
            nodes[i] = makeAddr(string.concat(labels[i], "-node"));
            _fund(owners[i], 1);
            vm.startPrank(owners[i]);
            token.approve(address(registry), type(uint256).max);
            registry.register(nodes[i], labels[i], "api", models, STAKE);
            vm.stopPrank();
        }
    }

    function _fund(address who, uint256 drips) internal {
        for (uint256 i; i < drips; i++) {
            vm.warp(vm.getBlockTimestamp() + 1 hours + 1);
            vm.prank(who);
            token.faucet();
        }
    }

    function _params(bool alwaysCheck) internal pure returns (XorvMarket.PostParams memory) {
        return XorvMarket.PostParams({
            model: MODEL,
            prompt: PROMPT,
            maxRate: 1000,
            maxTokens: 1000,
            commitSecs: 10,
            revealSecs: 10,
            workSecs: 60,
            alwaysCheck: alwaysCheck
        });
    }

    function _post(bool alwaysCheck) internal returns (uint256 id) {
        vm.startPrank(buyer);
        token.approve(address(market), type(uint256).max);
        id = market.postJob(_params(alwaysCheck));
        vm.stopPrank();
    }

    function _salt(uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", i));
    }

    function _commit(uint256 id, uint256 i, uint64 rate) internal {
        bytes32 c = market.bidCommitment(id, nodes[i], rate, _salt(i));
        vm.prank(nodes[i]);
        market.commitBid(id, c);
    }

    function _reveal(uint256 id, uint256 i, uint64 rate) internal {
        vm.prank(nodes[i]);
        market.revealBid(id, rate, _salt(i));
    }

    /// commits for the listed nodes, warps past the commit window and reveals all
    function _auction(uint256 id, uint256[] memory who, uint64[] memory rates) internal {
        for (uint256 k; k < who.length; k++) {
            _commit(id, who[k], rates[k]);
        }
        vm.warp(vm.getBlockTimestamp() + 11);
        for (uint256 k; k < who.length; k++) {
            _reveal(id, who[k], rates[k]);
        }
    }

    function _two(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    function _three(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory r) {
        r = new uint256[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }

    function _rates2(uint64 a, uint64 b) internal pure returns (uint64[] memory r) {
        r = new uint64[](2);
        r[0] = a;
        r[1] = b;
    }

    function _rates3(uint64 a, uint64 b, uint64 c) internal pure returns (uint64[] memory r) {
        r = new uint64[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }

    function _nodeIndexOf(address o) internal view returns (uint256) {
        for (uint256 i; i < 4; i++) {
            if (owners[i] == o) return i;
        }
        revert("not an owner");
    }

    /// mines the draw block and pins its hash so the roll is `roll` (searching a few hashes)
    function _resolveWithRoll(uint256 id, bool wantSampled) internal {
        XorvMarket.Job memory j = market.getJob(id);
        vm.roll(j.drawBlock + 1);
        for (uint256 k; k < 500; k++) {
            bytes32 h = keccak256(abi.encode("hash", k, id));
            bytes32 seed = keccak256(abi.encode(h, id, j.status));
            bool sampled = uint256(seed) % 10_000 < 3000;
            if (sampled == wantSampled) {
                vm.setBlockhash(j.drawBlock, h);
                market.resolveDraw(id);
                return;
            }
        }
        revert("no hash found");
    }

    function _resolve(uint256 id) internal {
        XorvMarket.Job memory j = market.getJob(id);
        vm.roll(j.drawBlock + 1);
        vm.setBlockhash(j.drawBlock, keccak256(abi.encode("hash", id, j.drawBlock)));
        market.resolveDraw(id);
    }

    function _deliver(uint256 id, string memory output, uint32 tokens) internal {
        XorvMarket.Job memory j = market.getJob(id);
        vm.prank(j.winnerNode);
        market.deliver(id, output, tokens);
    }

    function _checker(uint256 id, uint256 round) internal view returns (address node) {
        (, node,,,,,,) = market.checks(id, round);
    }

    // ------------------------------------------------------------------ x402 signing

    function _auth(uint256 key, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (X402Router.Authorization memory a)
    {
        address from = vm.addr(key);
        bytes32 structHash = keccak256(
            abi.encode(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        a = X402Router.Authorization({
            from: from,
            value: value,
            validAfter: validAfter,
            validBefore: validBefore,
            nonce: nonce,
            v: v,
            r: r,
            s: s
        });
    }
}
