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
  for (const [addr, c] of Object.entries(state.contracts)) leaves.push(leaf('ctr', addr, c));
  for (const [addr, o] of Object.entries(state.oracles)) leaves.push(leaf('orc', addr, o));
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
