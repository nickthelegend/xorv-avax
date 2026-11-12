// Ava Labs' eERC SDK imports three wagmi hooks for its React hooks (useEERC / useEncryptedBalance). Xorv uses only
// the SDK's EERC class with plain viem clients, so wagmi is replaced by this stub at build time. The hooks throw
// if anything ever calls them.
const unused = (name: string) => () => { throw new Error(`wagmi.${name} is not bundled in Xorv; use the EERC class.`); };
export const useBlockNumber = unused('useBlockNumber');
export const useReadContract = unused('useReadContract');
export const useReadContracts = unused('useReadContracts');
