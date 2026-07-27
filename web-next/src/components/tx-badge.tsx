import type { TxType } from "@/lib/api";

// Rótulo curto + cor por tipo de transação. Cores agrupadas por domínio:
//   verde  = transferência nativa · azul = staking/consenso · teal = governança/conta
//   rosa   = tokens EAV20 / NFT EAV721 · violeta = IA · dourado = ponte
const MAP: Record<TxType, { label: string; cls: string }> = {
  // nativo
  TRANSFER: { label: "transfer", cls: "badge-green" },
  EAVM_TRANSFER: { label: "eavm", cls: "badge-green" },
  // staking / consenso
  STAKE: { label: "stake", cls: "badge-blue" },
  UNSTAKE: { label: "unstake", cls: "badge-blue" },
  VOTE: { label: "vote", cls: "badge-blue" },
  SET_COMMISSION: { label: "commission", cls: "badge-blue" },
  CLAIM_VOTER_REWARD: { label: "reward↓", cls: "badge-blue" },
  SLASH_DOUBLE_SIGN: { label: "slash", cls: "badge-blue" },
  // recursos
  DELEGATE_RESOURCE: { label: "delegate", cls: "badge-teal" },
  UNDELEGATE_RESOURCE: { label: "undelegate", cls: "badge-teal" },
  // permissões / multisig
  PERMISSION_UPDATE: { label: "permission", cls: "badge-teal" },
  MULTISIG_PROPOSE: { label: "multisig+", cls: "badge-teal" },
  MULTISIG_APPROVE: { label: "multisig✓", cls: "badge-teal" },
  // governança
  GOV_PROPOSE: { label: "gov+", cls: "badge-teal" },
  GOV_VOTE: { label: "gov vote", cls: "badge-teal" },
  // vesting / meta-tx
  VESTING_CREATE: { label: "vesting+", cls: "badge-teal" },
  VESTING_CLAIM: { label: "vesting↓", cls: "badge-teal" },
  META_TX: { label: "meta-tx", cls: "badge-teal" },
  // token EAV20
  TOKEN_CREATE: { label: "token+", cls: "badge-pink" },
  TOKEN_TRANSFER: { label: "token", cls: "badge-pink" },
  TOKEN_APPROVE: { label: "approve", cls: "badge-pink" },
  TOKEN_TRANSFER_FROM: { label: "token←", cls: "badge-pink" },
  TOKEN_MINT: { label: "mint", cls: "badge-pink" },
  TOKEN_BURN: { label: "burn", cls: "badge-pink" },
  TOKEN_PAUSE: { label: "pause", cls: "badge-pink" },
  TOKEN_UNPAUSE: { label: "unpause", cls: "badge-pink" },
  TOKEN_BLACKLIST: { label: "blacklist", cls: "badge-pink" },
  TOKEN_FREEZE: { label: "freeze", cls: "badge-pink" },
  TOKEN_UNFREEZE: { label: "unfreeze", cls: "badge-pink" },
  // NFT EAV721
  NFT_CREATE: { label: "nft+", cls: "badge-pink" },
  NFT_MINT: { label: "nft mint", cls: "badge-pink" },
  NFT_TRANSFER: { label: "nft", cls: "badge-pink" },
  NFT_APPROVE: { label: "nft✓", cls: "badge-pink" },
  NFT_BURN: { label: "nft burn", cls: "badge-pink" },
  // serviço de nomes EAV-NS
  NAME_REGISTER: { label: "name+", cls: "badge-teal" },
  NAME_UPDATE: { label: "name~", cls: "badge-teal" },
  NAME_TRANSFER: { label: "name→", cls: "badge-teal" },
  NAME_RELEASE: { label: "name−", cls: "badge-teal" },
  // IA (camada de oráculos em 6 fases)
  AI_TASK: { label: "ai task", cls: "badge-violet" },
  AI_RESULT: { label: "ai result", cls: "badge-violet" },
  AI_COMMIT: { label: "ai commit", cls: "badge-violet" },
  AI_REVEAL: { label: "ai reveal", cls: "badge-violet" },
  AI_CLAIM: { label: "ai claim", cls: "badge-violet" },
  AI_CHALLENGE: { label: "ai challenge", cls: "badge-violet" },
  AI_VERDICT: { label: "ai verdict", cls: "badge-violet" },
  AI_BID: { label: "ai bid", cls: "badge-violet" },
  AI_AWARD: { label: "ai award", cls: "badge-violet" },
  AI_REFUND: { label: "ai refund", cls: "badge-violet" },
  ORACLE_REGISTER: { label: "oracle", cls: "badge-violet" },
  // ponte trustless
  BRIDGE_OUT: { label: "bridge→", cls: "badge-gold" },
  BRIDGE_IN: { label: "bridge←", cls: "badge-gold" },
  BRIDGE_SETTLE: { label: "settle", cls: "badge-gold" },
  BRIDGE_COMMITTEE_UPDATE: { label: "committee", cls: "badge-gold" },
  // EAVM
  EAVM_DEPLOY: { label: "deploy", cls: "badge-green" },
  EAVM_CALL: { label: "call", cls: "badge-green" },
};

export function TxBadge({ type }: { type: TxType }) {
  const m = MAP[type] ?? { label: String(type).toLowerCase(), cls: "" };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
