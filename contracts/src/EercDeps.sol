// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

// Pulls Ava Labs' official eERC contracts (vendored unmodified in lib/eerc, Ecosystem License)
// into the build so scripts can deploy them from forge artifacts.
import {EncryptedERC} from "eerc/EncryptedERC.sol";
import {Registrar} from "eerc/Registrar.sol";
import {BabyJubJub} from "eerc/libraries/BabyJubJub.sol";
import {RegistrationVerifier} from "eerc/prod/RegistrationVerifier.sol";
import {MintVerifier} from "eerc/prod/MintVerifier.sol";
import {WithdrawVerifier} from "eerc/prod/WithdrawVerifier.sol";
import {TransferVerifier} from "eerc/prod/TransferVerifier.sol";
import {BurnVerifier} from "eerc/prod/BurnVerifier.sol";
