import { eavHash, merkleRoot } from '../crypto/hash.js';

// stateRoot: compromisso criptográfico determinístico do ESTADO INTEIRO, commitado
// no header do bloco (a partir de CHAIN.STATEROOT_HEIGHT). Destrava prova de estado,
// light clients e a ponte trustless — hoje "os blocos validam estrutura, não estado".
//
// Construção: cada fatia do estado vira folhas `eavHash(domínio:chave:valor)`, as
// folhas são ORDENADAS (independente da ordem de iteração dos objetos) e reduzidas a
// uma raiz de Merkle. Duas réplicas com o mesmo estado produzem a MESMA raiz; qualquer
// divergência de saldo/stake/ponte/contrato muda a raiz e é detectada no addBlock.
//
// Serialização estável: BigInt vira "B<decimal>" (sem colisão com strings normais) e
// as chaves de objeto são ordenadas — determinístico entre nós e versões de Node.
function stable(v) {
  if (typeof v === 'bigint') return 'B' + v.toString();
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = stable(v[k]);
    return o;
  }
  return v;
}
const canonicalState = (v) => JSON.stringify(stable(v));

// Folha com separação de domínio: o prefixo impede que uma conta e um token de mesma
// chave colidam, e que reordenar seções mude a raiz.
const leaf = (domain, key, value) => eavHash(domain + '\x1f' + key + '\x1f' + canonicalState(value));

// Enumera TODAS as folhas do estado de consenso. Ordem de inserção é irrelevante:
// computeStateRoot ordena antes de reduzir. Toda seção que participa do consenso
// entra aqui — se ficasse de fora, dois estados divergindo só nela teriam a mesma
// raiz e os nós poderiam divergir sem detecção.
function stateLeaves(state) {
  const leaves = [];
  leaves.push(leaf('meta', 'totalMinted', state.totalMinted));
  leaves.push(leaf('meta', 'totalBurned', state.totalBurned));
  for (const [addr, acc] of Object.entries(state.accounts)) leaves.push(leaf('acct', addr, acc));
  for (const [id, tok] of Object.entries(state.tokens)) leaves.push(leaf('tok', id, tok));
  for (const [id, col] of Object.entries(state.nfts ?? {})) leaves.push(leaf('nft', id, col));
  for (const [n, rec] of Object.entries(state.names ?? {})) leaves.push(leaf('name', n, rec));
  for (const [addr, c] of Object.entries(state.contracts)) leaves.push(leaf('ctr', addr, c));
  for (const [addr, o] of Object.entries(state.oracles)) leaves.push(leaf('orc', addr, o));
  for (const [addr, v] of Object.entries(state.votes ?? {})) leaves.push(leaf('vote', addr, v));
  for (const [addr, t] of Object.entries(state.candidateVotes ?? {})) leaves.push(leaf('cvotes', addr, t));
  for (const [addr, p] of Object.entries(state.permissions ?? {})) leaves.push(leaf('perm', addr, p));
  for (const [id, o] of Object.entries(state.pendingOps ?? {})) leaves.push(leaf('pop', id, o));
  for (const [addr, d] of Object.entries(state.delegations ?? {})) leaves.push(leaf('deleg', addr, d));
  leaves.push(leaf('gov', 'params', state.params ?? {}));
  leaves.push(leaf('treasury', 'balance', state.treasury ?? 0n));
  for (const [id, p] of Object.entries(state.proposals ?? {})) leaves.push(leaf('gov', id, p));
  leaves.push(leaf('slash', 'set', state.slashed ?? {}));
  leaves.push(leaf('unbond', 'queue', state.unbonding ?? []));
  for (const [id, v] of Object.entries(state.vesting ?? {})) leaves.push(leaf('vest', id, v));
  for (const [a, c] of Object.entries(state.commission ?? {})) leaves.push(leaf('comm', a, c));
  for (const [a, r] of Object.entries(state.rewardAccPerVote ?? {})) leaves.push(leaf('racc', a, r));
  for (const [a, d] of Object.entries(state.voterRewardDebt ?? {})) leaves.push(leaf('rdebt', a, d));
  for (const [id, t] of Object.entries(state.aiTasks)) leaves.push(leaf('ai', id, t));
  leaves.push(leaf('brg', 'state', state.bridge));
  leaves.push(leaf('brg', 'relayers', state.bridgeRelayers));
  leaves.push(leaf('brg', 'committees', state.bridgeSourceCommittees ?? {}));
  return leaves;
}

// Raiz de Merkle sobre as folhas ORDENADAS. O(estado) por bloco — correto primeiro;
// otimização incremental (árvore persistente / MPT) é follow-up antes de a cadeia
// cruzar STATEROOT_HEIGHT (ver docs).
export function computeStateRoot(state) {
  return merkleRoot(stateLeaves(state).sort());
}

// Exportado para provas/light-client (#3): a folha canônica de uma conta específica.
export function accountLeaf(address, account) {
  return leaf('acct', address, account);
}

// Caminho de Merkle da folha em `index` até a raiz — espelha o pareamento do merkleRoot
// (parent = eavHash(esq + dir), último ímpar pareia consigo). Cada passo: { hash: irmão,
// right: true se ESTA folha é a da esquerda (irmão à direita) }.
function merklePath(sortedLeaves, index) {
  const path = [];
  let level = sortedLeaves;
  let i = index;
  while (level.length > 1) {
    const isLeft = i % 2 === 0;
    const sib = level[isLeft ? i + 1 : i - 1] ?? level[i];
    path.push({ hash: sib, right: isLeft });
    const next = [];
    for (let j = 0; j < level.length; j += 2) next.push(eavHash(level[j] + (level[j + 1] ?? level[j])));
    level = next;
    i = i >> 1;
  }
  return path;
}

// Forma canônica JSON-safe de uma conta (BigInt vira "B<decimal>"), para o light client
// recomputar a folha sem saber quais campos são BigInt. `decodeProofBig` lê de volta.
export const encodeAccountForProof = (account) => stable(account);
export const decodeProofBig = (s) => (typeof s === 'string' && s[0] === 'B' ? BigInt(s.slice(1)) : s);

// Folha de conta a partir da forma ENCODED (o que a prova transporta) — idêntica a
// accountLeaf(address, account), mas sem exigir os tipos BigInt no cliente.
export function accountLeafFromEncoded(address, encoded) {
  return eavHash('acct' + '\x1f' + address + '\x1f' + JSON.stringify(encoded));
}

// Prova de inclusão de UMA conta no stateRoot: { leaf, encodedAccount, path }. Um light
// client verifica com verifyStateProof e lê os campos de encodedAccount sem estado cheio.
export function accountProof(state, address) {
  const account = state.accounts[address];
  if (!account) return null;
  const target = accountLeaf(address, account);
  const sorted = stateLeaves(state).sort();
  const idx = sorted.indexOf(target);
  if (idx < 0) return null;
  return { leaf: target, encodedAccount: stable(account), path: merklePath(sorted, idx) };
}

// Recomputa a raiz a partir da folha + caminho e compara. Não precisa do estado inteiro.
export function verifyStateProof(root, leaf, path) {
  let h = leaf;
  for (const step of path ?? []) h = step.right ? eavHash(h + step.hash) : eavHash(step.hash + h);
  return h === root;
}

// Verificação completa para o light client: recompõe a folha a partir de (endereço,
// encodedAccount), confere contra a prova e valida o caminho até a raiz do header.
export function verifyAccountProof(stateRoot, address, encodedAccount, path) {
  const leaf = accountLeafFromEncoded(address, encodedAccount);
  return verifyStateProof(stateRoot, leaf, path);
}
