import { keccak256 } from '../eavm/keccak.js';
import { recover, ethAddressFromPoint } from '../eavm/secp256k1.js';

// Ponte trustless (#3): a AUTORIDADE de liberação passa a ser uma PROVA do comitê da
// cadeia de origem — os validadores de lá assinam o evento de depósito exato e a EAV7
// verifica essas assinaturas on-chain. O relayer só transporta a prova; forjar exige as
// chaves de >= quórum do comitê, não a de um relayer. Substitui a confiança na federação
// de relayers (achado C1) por verificação criptográfica.

// Digest determinístico do evento de depósito de origem (o que o comitê assina).
// Amarra TODOS os campos que definem a liberação — mudar qualquer um muda o digest.
export function bridgeEventDigest({ sourceChain, sourceTxHash, to, amount, token }) {
  const msg = [
    'EAV7-BRIDGE-IN',
    String(sourceChain).toUpperCase(),
    String(sourceTxHash),
    String(to),
    BigInt(amount).toString(),
    token ?? 'NATIVE',
  ].join('\x1f');
  return keccak256(Buffer.from(msg, 'utf8'));
}

// Digest de HANDOFF de comitê (rotação, (d)): o comitê ATUAL assina isto para autorizar
// a troca para um NOVO conjunto de membros no próximo epoch. Membros ordenados → o digest
// independe da ordem em que vêm.
export function committeeUpdateDigest({ sourceChain, epoch, members, quorum }) {
  const sorted = [...(members ?? [])].map((m) => String(m).toLowerCase()).sort();
  const msg = ['EAV7-BRIDGE-COMMITTEE', String(sourceChain).toUpperCase(), String(epoch), String(quorum), ...sorted].join('\x1f');
  return keccak256(Buffer.from(msg, 'utf8'));
}

// Conta assinaturas VÁLIDAS e DISTINTAS de membros do comitê sobre o digest.
// sigs: [{ r, s, recId }] com r/s em string decimal e recId 0..3. Um membro só conta
// uma vez (dedup por endereço recuperado) — maleabilidade de assinatura não infla a
// contagem, e uma assinatura de não-membro é ignorada.
export function verifyCommitteeProof(digest, sigs, committee) {
  const members = new Set((committee?.members ?? []).map((m) => String(m).toLowerCase()));
  const seen = new Set();
  let valid = 0;
  // Teto: no máximo `members.size` assinaturas (mais que isso não pode agregar — cada
  // membro conta uma vez). Impede um `recover` secp256k1 por sig de lixo (DoS de cripto).
  const capped = (Array.isArray(sigs) ? sigs : []).slice(0, members.size);
  for (const sig of capped) {
    let point;
    try {
      point = recover(digest, BigInt(sig.r), BigInt(sig.s), BigInt(sig.recId));
    } catch {
      continue;
    }
    if (!point) continue;
    const addr = ethAddressFromPoint(point).toLowerCase();
    if (members.has(addr) && !seen.has(addr)) {
      seen.add(addr);
      valid++;
    }
  }
  return valid;
}
