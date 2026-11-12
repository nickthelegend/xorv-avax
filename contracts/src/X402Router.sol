// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {XorvMarket} from "./XorvMarket.sol";

interface IERC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    function authorizationDigest(address authorizer, bytes32 nonce) external view returns (bytes32);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function TRANSFER_WITH_AUTHORIZATION_TYPEHASH() external view returns (bytes32);
}

/// @title X402Router
/// @notice The x402 `payTo` for Xorv on Fuji. A buyer signs an x402 "exact" payment (EIP-3009
///         TransferWithAuthorization to this router); the gateway, acting as facilitator, submits it
///         here and the same transaction moves the money into a new job's escrow, owned by the buyer.
///         The token rejects replayed and expired authorizations.
contract X402Router is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Authorization {
        address from;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    XorvMarket public immutable market;
    IERC20 public immutable token;
    /// @notice keccak(from, nonce) of every authorization this router has turned into a job or refunded
    mapping(bytes32 => bool) public settled;

    event PaidAndPosted(uint256 indexed jobId, address indexed buyer, uint256 value, bytes32 nonce, address facilitator);
    event StrayRefunded(address indexed buyer, uint256 value, bytes32 nonce);

    error AuthorizationAlreadyUsed();
    error PaymentTooSmall(uint256 required);
    error NotAStrayPayment();

    constructor(XorvMarket market_) {
        market = market_;
        token = market_.token();
        token.forceApprove(address(market_), type(uint256).max);
    }

    function payAndPost(XorvMarket.PostParams calldata p, Authorization calldata a)
        external
        nonReentrant
        returns (uint256 id)
    {
        uint256 required = market.escrowFor(p.maxRate, p.maxTokens);
        if (a.value < required) revert PaymentTooSmall(required);
        if (IERC3009(address(token)).authorizationState(a.from, a.nonce)) revert AuthorizationAlreadyUsed();
        IERC3009(address(token)).transferWithAuthorization(
            a.from, address(this), a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s
        );
        settled[keccak256(abi.encode(a.from, a.nonce))] = true;
        id = market.postJobX402(p, a.from, a.value, a.nonce);
        emit PaidAndPosted(id, a.from, a.value, a.nonce, msg.sender);
    }

    /// @notice If someone submitted a buyer's authorization straight to the token (front-running the
    ///         facilitator), the money reached this router without a job. The token recorded the exact
    ///         digest it consumed, so anyone can return that payment to the buyer, once.
    function refundStray(Authorization calldata a) external nonReentrant {
        bytes32 key = keccak256(abi.encode(a.from, a.nonce));
        IERC3009 t = IERC3009(address(token));
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                t.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        t.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), a.from, address(this), a.value, a.validAfter, a.validBefore, a.nonce
                    )
                )
            )
        );
        if (settled[key] || t.authorizationDigest(a.from, a.nonce) != digest) revert NotAStrayPayment();
        settled[key] = true;
        token.safeTransfer(a.from, a.value);
        emit StrayRefunded(a.from, a.value, a.nonce);
    }
}
