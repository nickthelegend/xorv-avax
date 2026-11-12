// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title Similarity
/// @notice Deployed once and linked into the market.
///         Jaccard similarity of two texts' word sets, in basis points, computed on-chain.
///         A word is a run of ASCII letters/digits or non-ASCII bytes; ASCII letters are lowercased.
///         Each word is hashed with 64-bit FNV-1a and the two word sets are merged in an open-addressing
///         hash table, so the cost is linear in the text length.
///         Mirrors `similarityBps` in sdk/src/similarity.ts.
library Similarity {
    function jaccardBps(bytes calldata a, bytes calldata b) external pure returns (uint256 bps) {
        assembly ("memory-safe") {
            // Appends one 32-byte entry per word: (fnv64 << 8) | tag. Returns the new write pointer.
            function tokenize(off, len, ptr, tag) -> p {
                p := ptr
                let h := 0
                let inWord := 0
                let end := add(off, len)
                for { let i := off } lt(i, end) { i := add(i, 1) } {
                    let c := byte(0, calldataload(i))
                    let upper := and(gt(c, 0x40), lt(c, 0x5b))
                    let isWord :=
                        or(or(and(gt(c, 0x2f), lt(c, 0x3a)), and(gt(c, 0x60), lt(c, 0x7b))), or(upper, gt(c, 0x7f)))
                    switch isWord
                    case 1 {
                        if upper { c := add(c, 32) }
                        if iszero(inWord) {
                            h := 0xcbf29ce484222325
                            inWord := 1
                        }
                        h := and(mul(xor(h, c), 0x100000001b3), 0xffffffffffffffff)
                    }
                    default {
                        if inWord {
                            mstore(p, or(shl(8, h), tag))
                            p := add(p, 32)
                            inWord := 0
                        }
                    }
                }
                if inWord {
                    mstore(p, or(shl(8, h), tag))
                    p := add(p, 32)
                }
            }

            let start := mload(0x40)
            let mid := tokenize(a.offset, a.length, start, 1)
            let finish := tokenize(b.offset, b.length, mid, 2)
            let n := shr(5, sub(finish, start))
            switch n
            case 0 { bps := 10000 }
            default {
                let size := 1
                for {} lt(size, shl(1, n)) {} { size := shl(1, size) }
                let mask := sub(size, 1)
                let table := finish
                // zero the table: copying from past the end of calldata yields zeros
                calldatacopy(table, calldatasize(), shl(5, size))
                let ua := 0
                let ub := 0
                let inter := 0
                for { let e := start } lt(e, finish) { e := add(e, 32) } {
                    let entry := mload(e)
                    let tag := and(entry, 0xff)
                    let key := shr(8, entry)
                    let idx := and(key, mask)
                    for {} 1 {} {
                        let slotPtr := add(table, shl(5, idx))
                        let slot := mload(slotPtr)
                        if iszero(slot) {
                            mstore(slotPtr, entry)
                            switch tag
                            case 1 { ua := add(ua, 1) }
                            default { ub := add(ub, 1) }
                            break
                        }
                        if eq(shr(8, slot), key) {
                            if iszero(and(slot, tag)) {
                                mstore(slotPtr, or(slot, tag))
                                switch tag
                                case 1 { ua := add(ua, 1) }
                                default { ub := add(ub, 1) }
                                inter := add(inter, 1)
                            }
                            break
                        }
                        idx := and(add(idx, 1), mask)
                    }
                }
                bps := div(mul(inter, 10000), sub(add(ua, ub), inter))
            }
        }
    }
}
