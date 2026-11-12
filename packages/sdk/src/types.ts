export type Hex = `0x${string}`;

export interface Deployment {
  network: string;
  chainId: number;
  rpc: string;
  explorer: string;
  deployedAt: string;
  deployer: Hex;
  contracts: {
    testDollar: Hex;
    index: Hex;
    registry: Hex;
    similarity: Hex;
    market: Hex;
    router: Hex;
    forward?: Hex;
  };
  eerc?: {
    encryptedERC: Hex;
    registrar: Hex;
    babyJubJub: Hex;
    verifiers: Record<string, Hex>;
    decimals: number;
    auditor?: Hex;
    desk?: Hex;
  };
  config: {
    minStake: string;
    slashBps: number;
    unbondSecs: number;
    spotCheckBps: number;
    toleranceBps: number;
    checkFee: string;
    minWindowSecs: number;
    maxWindowSecs: number;
    indexMaxStepBps: number;
  };
  [k: string]: unknown;
}

export const STATUS = ['None', 'Bidding', 'Running', 'Delivered', 'Checking', 'Mismatch', 'Tiebreak', 'Done', 'Faulted', 'Expired'] as const;
export type StatusName = (typeof STATUS)[number];
export const OUTCOME = [
  'None',
  'PaidNotSampled',
  'PaidCheckMatched',
  'PaidNoChecker',
  'PaidCheckerTimeout',
  'PaidTiebreakSidedWithProvider',
  'PaidTiebreakInconclusive',
  'FaultedTiebreakSidedWithChecker',
  'FaultedNoDelivery',
  'ExpiredNoBids',
  'RefundedNoTiebreaker',
] as const;
export type OutcomeName = (typeof OUTCOME)[number];

export const OUTCOME_TEXT: Record<OutcomeName, string> = {
  None: '',
  PaidNotSampled: 'Paid. Not sampled for a spot check.',
  PaidCheckMatched: 'Paid. A second node re-ran it and matched.',
  PaidNoChecker: 'Paid. Sampled, but no other node could check it.',
  PaidCheckerTimeout: 'Paid. The checker did not answer in time.',
  PaidTiebreakSidedWithProvider: 'Paid. The tiebreaker sided with the provider and the checker was slashed.',
  PaidTiebreakInconclusive: 'Paid. The tiebreaker was inconclusive.',
  FaultedTiebreakSidedWithChecker: 'Faulted. The tiebreaker sided with the checker and the provider was slashed.',
  FaultedNoDelivery: 'Faulted. The winner never delivered and was slashed.',
  ExpiredNoBids: 'Expired. No revealed bids, refunded in full.',
  RefundedNoTiebreaker: 'Refunded. The check mismatched and no tiebreaker was available.',
};

export const OPEN_STATUSES: readonly StatusName[] = ['Bidding', 'Running', 'Delivered', 'Checking', 'Mismatch', 'Tiebreak'];

export interface Job {
  id: number;
  buyer: Hex;
  status: StatusName;
  outcome: OutcomeName;
  alwaysCheck: boolean;
  viaX402: boolean;
  bidCount: number;
  revealed: number;
  model: string;
  promptHash: Hex;
  maxRate: bigint;
  maxTokens: number;
  workSecs: number;
  escrow: bigint;
  createdAt: number;
  commitEnd: number;
  revealEnd: number;
  deliverEnd: number;
  checkEnd: number;
  closedAt: number;
  winner: Hex;
  winnerNode: Hex;
  clearedRate: bigint;
  tokens: number;
  charge: bigint;
  resultHash: Hex;
  drawBlock: bigint;
}

export interface Bid { owner: Hex; node: Hex; commitment: Hex; committedAt: number; rate: bigint; revealed: boolean }
export interface Check { owner: Hex; node: Hex; drawnAt: number; deliveredAt: number; outputHash: Hex; tokens: number; similarityBps: number; delivered: boolean }

export interface Provider {
  owner: Hex;
  node: Hex;
  label: string;
  kind: string;
  models: readonly string[];
  stake: bigint;
  unbonding: bigint;
  unbondAt: bigint;
  joinedAt: bigint;
  earned: bigint;
  totalEarned: bigint;
  slashed: bigint;
  active: number;
  wins: number;
  bids: number;
  checks: number;
  slashes: number;
}
