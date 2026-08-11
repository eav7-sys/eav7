// Catálogo dos 58 tipos de transação do protocolo (`TX_TYPES` em
// rust/src/transaction.rs). `fee` é o LIMITE de queima autorizado em e7
// (`CHAIN.FEES` / rust/src/config.rs::fees) — não é o que de fato é queimado.

export interface TxType {
  name: string;
  /** limite de taxa em e7 */
  fee: number;
}

export interface TxGroup {
  /** chave do título em `dev.tx.group.*` */
  key: string;
  types: TxType[];
}

export const TX_GROUPS: TxGroup[] = [
  {
    key: "native",
    types: [
      { name: "TRANSFER", fee: 10_000 },
      { name: "STAKE", fee: 10_000 },
      { name: "UNSTAKE", fee: 10_000 },
      { name: "EAVM_TRANSFER", fee: 10_000 },
    ],
  },
  {
    key: "consensus",
    types: [
      { name: "VOTE", fee: 10_000 },
      { name: "SET_COMMISSION", fee: 10_000 },
      { name: "CLAIM_VOTER_REWARD", fee: 10_000 },
      { name: "SLASH_DOUBLE_SIGN", fee: 20_000 },
    ],
  },
  {
    key: "resources",
    types: [
      { name: "DELEGATE_RESOURCE", fee: 10_000 },
      { name: "UNDELEGATE_RESOURCE", fee: 10_000 },
    ],
  },
  {
    key: "permissions",
    types: [
      { name: "PERMISSION_UPDATE", fee: 20_000 },
      { name: "PERMISSION_PROPOSE", fee: 20_000 },
      { name: "PERMISSION_APPROVE", fee: 10_000 },
      { name: "PERMISSION_VETO", fee: 1_000 },
      { name: "MULTISIG_PROPOSE", fee: 20_000 },
      { name: "MULTISIG_APPROVE", fee: 10_000 },
    ],
  },
  {
    key: "governance",
    types: [
      { name: "GOV_PROPOSE", fee: 50_000 },
      { name: "GOV_VOTE", fee: 10_000 },
    ],
  },
  {
    key: "vesting",
    types: [
      { name: "VESTING_CREATE", fee: 20_000 },
      { name: "VESTING_CLAIM", fee: 10_000 },
      { name: "META_TX", fee: 30_000 },
    ],
  },
  {
    key: "token",
    types: [
      { name: "TOKEN_CREATE", fee: 10_000_000 },
      { name: "TOKEN_TRANSFER", fee: 20_000 },
      { name: "TOKEN_APPROVE", fee: 10_000 },
      { name: "TOKEN_TRANSFER_FROM", fee: 20_000 },
      { name: "TOKEN_MINT", fee: 20_000 },
      { name: "TOKEN_BURN", fee: 20_000 },
      { name: "TOKEN_PAUSE", fee: 10_000 },
      { name: "TOKEN_UNPAUSE", fee: 10_000 },
      { name: "TOKEN_BLACKLIST", fee: 10_000 },
      { name: "TOKEN_FREEZE", fee: 10_000 },
      { name: "TOKEN_UNFREEZE", fee: 10_000 },
    ],
  },
  {
    key: "nft",
    types: [
      { name: "NFT_CREATE", fee: 10_000_000 },
      { name: "NFT_MINT", fee: 30_000 },
      { name: "NFT_TRANSFER", fee: 20_000 },
      { name: "NFT_APPROVE", fee: 10_000 },
      { name: "NFT_BURN", fee: 20_000 },
    ],
  },
  {
    key: "names",
    types: [
      { name: "NAME_REGISTER", fee: 1_000_000 },
      { name: "NAME_UPDATE", fee: 10_000 },
      { name: "NAME_TRANSFER", fee: 10_000 },
      { name: "NAME_RELEASE", fee: 10_000 },
    ],
  },
  {
    key: "ai",
    types: [
      { name: "ORACLE_REGISTER", fee: 10_000 },
      { name: "AI_TASK", fee: 50_000 },
      { name: "AI_RESULT", fee: 0 },
      { name: "AI_REFUND", fee: 0 },
      { name: "AI_COMMIT", fee: 10_000 },
      { name: "AI_REVEAL", fee: 10_000 },
      { name: "AI_CLAIM", fee: 10_000 },
      { name: "AI_CHALLENGE", fee: 20_000 },
      { name: "AI_VERDICT", fee: 10_000 },
      { name: "AI_BID", fee: 10_000 },
      { name: "AI_AWARD", fee: 10_000 },
    ],
  },
  {
    key: "bridge",
    types: [
      { name: "BRIDGE_OUT", fee: 20_000 },
      { name: "BRIDGE_IN", fee: 0 },
      { name: "BRIDGE_SETTLE", fee: 0 },
      { name: "BRIDGE_COMMITTEE_UPDATE", fee: 20_000 },
    ],
  },
  {
    key: "eavm",
    types: [
      { name: "EAVM_DEPLOY", fee: 200_000 },
      { name: "EAVM_CALL", fee: 100_000 },
    ],
  },
];

export const TX_TYPE_COUNT: number = TX_GROUPS.reduce((total, group) => total + group.types.length, 0);
