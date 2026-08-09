#!/usr/bin/env node
// Vetores de CICLO DE VIDA da cadeia — gênese → expulsão → âncora → reorg → replay.
//
// `state.json` fixa a transição de UMA transação. Este arquivo fixa o que acontece
// com a JANELA de blocos em RAM ao longo da vida da cadeia:
//
//   1. a ÂNCORA que nasce quando o bloco mais velho é expulso da RAM — em especial
//      a PRIMEIRA expulsão, com `tail_start == 0` e âncora nenhuma, que é o caso do
//      bug real da âncora (docs/plano/07-metodo-testes.md: o arranjo dos testes
//      sempre montava `base_state` pronto e o caminho da gênese nunca rodava);
//   2. a invariante de que a âncora + os blocos da janela reconstroem EXATAMENTE a
//      raiz do estado corrente — é dela que todo reorg depende;
//   3. o estado no ponto de fork de um reorg (âncora + re-execução até o comum) e a
//      raiz após adotar um rabo rival;
//   4. o replay completo da cadeia adotada, que tem de chegar à mesma raiz.
//
// Os blocos daqui NÃO são blocos de consenso: assinatura e hash são marcadores
// fixos. O que o vetor fixa é a APLICAÇÃO DE ESTADO (a sequência de
// `#applyBlockTo`, blockchain.js:309), que é exatamente o que a âncora e o rebuild
// do reorg executam — e que ignora assinaturas. É isso que permite ao gerador ser
// determinístico byte a byte (a regra de ouro dos vetores), o que uma cadeia
// assinada de verdade não consegue: ECDSA/ML-DSA são aleatórias por natureza. O
// caminho REAL, assinado, é exercitado pelos consumidores: o cliente Rust chama o
// `evict_oldest`/`apply_block_to` de produção sobre estes blocos, e
// test/lifecycle.test.js roda o ciclo inteiro numa cadeia assinada com janela
// curta.
//
// Uso:  node bin/eav7-vectors-lifecycle.js [diretório]     (padrão: ./vectors)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAIN } from '../src/config.js';
import { eavHash, merkleRoot } from '../src/crypto/hash.js';
import { deriveAddressFrom } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { computeStateRoot, stateLeaves } from '../src/core/stateroot.js';
import { buildGenesisBlock, blockValidator } from '../src/core/block.js';
import { Blockchain } from '../src/core/blockchain.js';

const OUT = process.argv[2] ?? join(process.cwd(), 'vectors');
mkdirSync(OUT, { recursive: true });

// Serialização estável, como nos demais geradores: chaves ordenadas, BigInt em texto.
const estavel = (v) => {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(estavel);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, estavel(v[k])]));
  }
  return v;
};

const V = deriveAddressFrom('VETOR:validador');
const A = deriveAddressFrom('VETOR:alice');
const B = deriveAddressFrom('VETOR:bob');
const C = deriveAddressFrom('VETOR:carol');
const UNIT = CHAIN.UNIT;
const T0 = 1_700_000_000_000; // alinhado ao slot (múltiplo de BLOCK_TIME_MS)
const SLOT = CHAIN.BLOCK_TIME_MS;

// `blockReward` lê o parâmetro governável do ESTADO — usa o método real do nó.
const regua = new Blockchain();

// O espelho declarado de `#applyBlockTo` (blockchain.js:309) — a MESMA sequência
// que a âncora do slide e o rebuild do reorg executam. Reimplementada aqui porque
// o caminho real só aceita blocos assinados; qualquer passo que divirja daquela
// função produz raiz diferente da rede e o vetor acusaria no primeiro consumidor.
function aplicar(state, block) {
  if (block.height > 0 && block.height >= CHAIN.EAVM_OSAKA_HEIGHT) {
    state.recordBlockHash(block.height - 1, block.previousHash);
  }
  let fees = 0n; // applyTransaction devolve 0n ao bloco: a taxa é QUEIMADA (state.js:2651)
  for (const tx of block.transactions) fees += state.applyTransaction(tx, block.height, block.timestamp);
  const reward = regua.blockReward(block.height, state);
  state.distributeBlockReward(blockValidator(block), reward + fees);
  state.totalMinted += reward;
  state.blockTick(block.height);
}

const idDe = (rotulo) => eavHash('VETOR-CICLO-TX:' + rotulo);
// `to: null` explícito e `protocol`/`scheme` inclusos, pelas mesmas razões do
// gerador de estado: o bandwidth é cobrado pelo TAMANHO da tx canônica.
const tx = (rotulo, extra) => ({
  protocol: CHAIN.PROTOCOL, scheme: 'eav7-hybrid-1', to: null, fee: '10000',
  timestamp: T0, id: idDe(rotulo), ...extra,
});

// Hash de bloco FICTÍCIO e determinístico. A aplicação de estado nunca lê o hash;
// ele só existe para os campos estarem presentes e o encadeamento ser legível.
const hashDe = (ramo, height) => eavHash(`VETOR-CICLO-BLOCO:${ramo}:${height}`);

function bloco(ramo, height, previousHash, transactions) {
  return {
    protocol: CHAIN.PROTOCOL,
    version: CHAIN.PROTOCOL_VERSION,
    scheme: 'eav7-hybrid-1',
    height,
    // O ramo rival vive em slots POSTERIORES (como num fork real); +8 garante que
    // todo rival tem timestamp acima do bloco comum e slots livres.
    timestamp: T0 + (ramo === 'rival' ? height + 8 : height) * SLOT,
    previousHash,
    txRoot: merkleRoot(transactions.map((t) => t.id)),
    txCount: transactions.length,
    producer: V,
    publicKey: null,
    pqPublicKey: null,
    signature: 'VETOR-SEM-ASSINATURA',
    pqSignature: 'VETOR-SEM-ASSINATURA',
    hash: hashDe(ramo, height),
    transactions,
  };
}

// --- gênese REAL: buildGenesisBlock é determinístico (sem produtor, assinatura
// fixa), então o vetor fixa também o HASH da gênese — que é o valor que o pin
// `expectedGenesisHash` protege. O consumidor adota pela porta real.
const genese = buildGenesisBlock({
  timestamp: T0,
  balances: { [V]: (CHAIN.GENESIS_SUPPLY - CHAIN.GENESIS_STAKE).toString() },
  stakes: { [V]: CHAIN.GENESIS_STAKE.toString() },
  bridgeRelayers: [V],
});

// --- a janela: 10 blocos com transações que espalham estado por vários domínios
// de folha (acct, tok, meta), para a âncora carregar mais do que saldos.
const TOKID = eavHash('EAV20-TOKEN:' + idDe('token-create')); // derivação real (state.js:1681)
const blocos = [];
{
  let prev = genese.hash;
  const emite = (height, txs) => {
    const b = bloco('principal', height, prev, txs);
    prev = b.hash;
    blocos.push(b);
  };
  emite(1, []);
  emite(2, [tx('v-a', { type: 'TRANSFER', from: V, to: A, amount: (5_000n * UNIT).toString(), nonce: 1 })]);
  emite(3, [tx('v-b', { type: 'TRANSFER', from: V, to: B, amount: (3_000n * UNIT).toString(), nonce: 2 })]);
  emite(4, [tx('a-stake', { type: 'STAKE', from: A, amount: (1_000n * UNIT).toString(), nonce: 1 })]);
  emite(5, [tx('token-create', {
    type: 'TOKEN_CREATE', from: A, amount: '0', nonce: 2,
    data: { name: 'Ciclo', symbol: 'CIC', decimals: 6, totalSupply: '1000000000' },
  })]);
  emite(6, [tx('token-transfer', { type: 'TOKEN_TRANSFER', from: A, to: B, amount: '250000', nonce: 3, data: { token: TOKID } })]);
  emite(7, [
    tx('a-b', { type: 'TRANSFER', from: A, to: B, amount: (10n * UNIT).toString(), nonce: 4 }),
    tx('b-a', { type: 'TRANSFER', from: B, to: A, amount: (4n * UNIT).toString(), nonce: 1 }),
  ]);
  emite(8, []);
  emite(9, [tx('b-a-2', { type: 'TRANSFER', from: B, to: A, amount: (1n * UNIT).toString(), nonce: 2 })]);
  emite(10, []);
}

// Replay independente até a altura `h` — cada chamada parte de um State NOVO, para
// que raiz de âncora e raiz corrente nunca venham do mesmo objeto.
function replayAte(h, rabos = []) {
  const s = new State();
  s.applyGenesis(genese.genesis);
  for (const b of blocos) {
    if (b.height > h) break;
    aplicar(s, b);
  }
  for (const b of rabos) aplicar(s, b);
  return s;
}

// --- aplica a cadeia principal, raiz (e folhas, para depurar) por altura
const st = new State();
st.applyGenesis(genese.genesis);
const raizGenese = computeStateRoot(st);
const folhasGenese = stateLeaves(st).slice().sort();
const registros = [];
for (const b of blocos) {
  aplicar(st, b);
  registros.push({ ...b, stateRootAfter: computeStateRoot(st), leavesAfter: stateLeaves(st).slice().sort() });
}
const raizCabeca = registros[registros.length - 1].stateRootAfter;

// --- expulsões: após expulsar o bloco `k-1`, a âncora é o estado APÓS ele.
// A primeira (k=1) expulsa a GÊNESE: a âncora é a ALOCAÇÃO — o caso do bug.
const expulsoes = [1, 2, 3].map((tailStart) => ({
  tailStart,
  anchorRoot: computeStateRoot(replayAte(tailStart - 1)),
  ...(tailStart === 1
    ? { note: 'a PRIMEIRA expulsão: a âncora nasce da alocação da gênese, nunca de "estado vazio + bloco 0"' }
    : {}),
}));
if (expulsoes[0].anchorRoot !== raizGenese) {
  console.error('FALHA DE INVARIANTE: a âncora da primeira expulsão difere da raiz da gênese.');
  process.exit(1);
}
// A invariante central, conferida no próprio gerador com replays independentes:
// âncora (estado após k-1) + blocos k..cabeça == raiz corrente.
if (computeStateRoot(replayAte(blocos.length)) !== raizCabeca) {
  console.error('FALHA DE INVARIANTE: replay independente não chega à raiz da cabeça.');
  process.exit(1);
}

// --- reorg: fork no bloco COMMON (dentro da janela pós-expulsões), rabo rival
// MAIS LONGO. O estado no ponto de fork é âncora + janela até o comum.
const COMMON = 6;
const raizNoFork = registros[COMMON - 1].stateRootAfter;
const rivais = [];
{
  let prev = blocos[COMMON - 1].hash;
  const emite = (height, txs) => {
    const b = bloco('rival', height, prev, txs);
    prev = b.hash;
    rivais.push(b);
  };
  // Nonces continuam do estado NO FORK (após o bloco 6): A usou 1..3, B nenhum.
  emite(7, [tx('rival-a-b', { type: 'TRANSFER', from: A, to: B, amount: (7n * UNIT).toString(), nonce: 4 })]);
  emite(8, []);
  emite(9, [tx('rival-b-c', { type: 'TRANSFER', from: B, to: C, amount: (2n * UNIT).toString(), nonce: 1 })]);
  emite(10, []);
  emite(11, [tx('rival-b-stake', { type: 'STAKE', from: B, amount: (500n * UNIT).toString(), nonce: 2 })]);
}
const forkState = replayAte(COMMON);
if (computeStateRoot(forkState) !== raizNoFork) {
  console.error('FALHA DE INVARIANTE: o estado reconstruído no fork difere do registrado.');
  process.exit(1);
}
const rivaisRegistrados = [];
for (const b of rivais) {
  aplicar(forkState, b);
  rivaisRegistrados.push({ ...b, stateRootAfter: computeStateRoot(forkState), leavesAfter: stateLeaves(forkState).slice().sort() });
}
const raizAposReorg = rivaisRegistrados[rivaisRegistrados.length - 1].stateRootAfter;
// Replay COMPLETO da cadeia adotada (gênese + 1..common + rival), de um estado novo.
if (computeStateRoot(replayAte(COMMON, rivais)) !== raizAposReorg) {
  console.error('FALHA DE INVARIANTE: o replay da cadeia adotada não chega à raiz do reorg.');
  process.exit(1);
}

// ------------------------------------------------------------------- gravação
const corpo = {
  description:
    'Ciclo de vida da cadeia: gênese → expulsão da janela → âncora → reorg → replay. ' +
    'Os blocos não são blocos de consenso (assinatura/hash são marcadores): o vetor fixa a ' +
    'APLICAÇÃO DE ESTADO — a sequência que a âncora do slide e o rebuild do reorg executam. ' +
    'A gênese é real e determinística, então o hash dela também é conferido.',
  invariants: [
    'a âncora da PRIMEIRA expulsão é a alocação da gênese (tail_start 0 -> 1), nunca "estado vazio + bloco 0"',
    'após k expulsões a âncora é o estado APÓS o bloco k-1; âncora + blocos da janela == raiz corrente',
    'o estado no ponto de fork de um reorg é âncora + re-execução da janela até o bloco comum',
    'o replay completo da cadeia adotada (gênese + 1..common + rival) chega à MESMA raiz do reorg',
  ],
  genesisActive: process.env.EAV7_GENESIS_ACTIVE === '1',
  genesis: { block: genese, stateRoot: raizGenese, leaves: folhasGenese },
  blocks: registros,
  evictions: expulsoes,
  headRoot: raizCabeca,
  reorg: { common: COMMON, rootAtFork: raizNoFork, rival: rivaisRegistrados, rootAfterReorg: raizAposReorg },
};

const texto = JSON.stringify(estavel(corpo), null, 2) + '\n';
writeFileSync(join(OUT, 'lifecycle.json'), texto);
console.log(`  lifecycle.json       ${String(blocos.length + rivais.length).padStart(4)} blocos ${String(texto.length).padStart(7)} bytes`);
console.log(`    ${expulsoes.length} expulsões, reorg no bloco ${COMMON}, raiz final ${raizAposReorg.slice(0, 16)}…`);
console.log('    invariantes conferidas: âncora da gênese, âncora+janela, fork, replay da adotada');
