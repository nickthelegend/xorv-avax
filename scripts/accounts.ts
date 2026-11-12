// Names of this repo's test-account keys in the gitignored .env.
export const LABELS = ['atlas', 'birch', 'cobalt', 'dune'] as const;
export const ACCOUNTS: Record<string, string> = {
  deployer: 'XORV_DEPLOYER_KEY',
  desk: 'XORV_DESK_KEY',
  auditor: 'XORV_AUDITOR_KEY',
  buyer: 'XORV_BUYER_KEY',
  qa: 'XORV_QA_KEY',
  ...Object.fromEntries(LABELS.flatMap((l) => [[`owner.${l}`, `XORV_OWNER_${l.toUpperCase()}_KEY`], [`node.${l}`, `XORV_NODE_${l.toUpperCase()}_KEY`]])),
};

