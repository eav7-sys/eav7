#!/usr/bin/env node
// Gerador de VETORES DE CONFORMIDADE do protocolo eav20.
//
// Por que existe: o nó em JavaScript é a implementação de REFERÊNCIA — legível e
// auditável, no mesmo papel que o `execution-specs` em Python tem para o Ethereum.
// Qualquer outra implementação (o cliente em Rust, a seguir) precisa reproduzir
// estes vetores byte a byte. Sem eles, um segundo cliente é ato de fé: "parece
// certo" não é critério de aceitação para consenso.
//
// Regra de ouro: TUDO aqui é determinístico. Nada de Date.now(), nada de chave
// aleatória, nada de iteração sobre objeto sem ordenar. Rodar duas vezes tem de
// produzir arquivos idênticos byte a byte — senão o vetor não serve para provar
// equivalência, e o `git diff` vira ruído.
//
// Assinaturas (ECDSA e ML-DSA) SÃO aleatórias por natureza, então não são geradas
// aqui: os vetores afirmam o que é determinístico (payload canônico, id, hash,
// transição de estado) e trazem assinaturas FIXAS como fixture para o caso de
// verificação.
//
// Uso:  node bin/eav7-vectors.js [diretório]     (padrão: ./vectors)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAIN, FORK_HEIGHTS } from '../src/config.js';
import { eavHash, merkleRoot, isValidHash } from '../src/crypto/hash.js';
import { deriveAddressFrom, isValidAddress } from '../src/crypto/keys.js';
import { txSigningPayload } from '../src/core/transaction.js';
import { State } from '../src/core/state.js';
import { computeStateRoot, accountLeaf } from '../src/core/stateroot.js';
import { canonicalHex } from '../src/core/canonical.js';
import { runEavm } from '../src/eavm/vm.js';
import { createHost } from '../src/eavm/host.js';
import { decodeRawTransaction, createSignedTx } from '../src/eavm/tx.js';
import { buildEavmEnvelope, encodeE7Dest } from '../src/eavm/envelope.js';

const OUT = process.argv[2] ?? join(process.cwd(), 'vectors');

// Serialização estável: chaves ordenadas e BigInt como string decimal. É o que
// garante que dois geradores (ou dois clientes) produzam o MESMO texto.
function estavel(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(estavel);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, estavel(v[k])]));
  }
  return v;
}
function grava(nome, corpo) {
  const texto = JSON.stringify(estavel(corpo), null, 2) + '\n';
  writeFileSync(join(OUT, nome), texto);
  const casos = Array.isArray(corpo.cases) ? corpo.cases.length : 0;
  console.log(`  ${nome.padEnd(22)} ${String(casos).padStart(4)} casos  ${String(texto.length).padStart(7)} bytes`);
}


// Forma TIPADA de um valor, para os vetores. O `estavel()` achata BigInt em texto e
// o cliente fica sem saber se `"1000000000"` é inteiro (tag 0x03) ou texto (0x04) —
// e os dois produzem folhas DIFERENTES. Aqui o tipo viaja junto, espelhando o enum
// da codificação canônica, então qualquer implementação reconstrói o valor exato
// sem lista de campos codificada à mão.
function tipado(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return { bool: v };
  if (typeof v === 'bigint' || typeof v === 'number') return { int: v.toString() };
  if (typeof v === 'string') return { str: v };
  if (Array.isArray(v)) return { list: v.map(tipado) };
  if (typeof v === 'object') {
    return { map: Object.fromEntries(
      Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, tipado(v[k])]),
    ) };
  }
  throw new Error(`tipo não representável no vetor: ${typeof v}`);
}

// --- endereços fixos, derivados de rótulos: legíveis no diff e reproduzíveis ---
const addr = (rotulo) => deriveAddressFrom('VETOR:' + rotulo);
const A = addr('alice');
const B = addr('bob');
const C = addr('carol');

mkdirSync(OUT, { recursive: true });
console.log(`vetores de conformidade do protocolo ${CHAIN.PROTOCOL} -> ${OUT}\n`);

// ---------------------------------------------------------------- 1. criptografia
grava('crypto.json', {
  description:
    'Primitivas de hash e derivação de endereço. O hash é SHA3-256 COMPLETA, 64 hex ' +
    'minúsculos, SEM prefixo — o prefixo E7 pertence ao endereço, não à hash.',
  cases: [
    ...['', 'eav7', 'a', 'abc', 'EAV7-EMPTY-ROOT'].map((entrada) => ({
      kind: 'eavHash',
      input: entrada,
      output: eavHash(entrada),
    })),
    { kind: 'eavHash.multipart', input: ['a', 'b', 'c'], output: eavHash('a', 'b', 'c'),
      note: 'partes são concatenadas na ordem, sem separador' },
    { kind: 'merkleRoot', input: [], output: merkleRoot([]),
      note: 'lista vazia tem raiz própria, não zero' },
    ...[1, 2, 3, 4, 5, 8].map((n) => {
      const ids = Array.from({ length: n }, (_, i) => eavHash('folha' + i));
      return { kind: 'merkleRoot', input: ids, output: merkleRoot(ids),
        note: n % 2 === 1 && n > 1 ? 'quantidade ímpar: o último pareia consigo mesmo' : undefined };
    }),
    ...['alice', 'bob', 'carol', ''].map((rotulo) => ({
      kind: 'deriveAddressFrom',
      input: 'VETOR:' + rotulo,
      output: addr(rotulo),
      note: 'E7 + 28 hex do SHA3 + 4 hex de checksum',
    })),
    ...[
      [A, true], [B, true],
      ['E7' + '0'.repeat(32), false],
      [A.slice(0, -1) + '0', false],
      [A.toLowerCase(), false],
      ['', false],
    ].map(([v, ok]) => ({ kind: 'isValidAddress', input: v, output: ok })),
    ...[
      [eavHash('x'), true],
      [eavHash('x').toUpperCase(), false],
      ['0'.repeat(64), true],
      ['0'.repeat(63), false],
      ['E7' + '0'.repeat(62), false],
    ].map(([v, ok]) => ({ kind: 'isValidHash', input: v, output: ok })),
  ],
});

// ------------------------------------------------------- 2. payload canônico e id
// O id deriva APENAS do payload canônico — nunca dos bytes da assinatura. É o que
// elimina maleabilidade de txid: remodelar s->N-s muda a assinatura, não o id.
const txsBase = [
  { type: 'TRANSFER', from: A, to: B, amount: '1000000', fee: '10000', nonce: 1, timestamp: 1_700_000_000_000 },
  { type: 'TRANSFER', from: A, to: B, amount: '0', fee: '0', nonce: 2, timestamp: 1_700_000_000_001 },
  { type: 'STAKE', from: A, to: null, amount: '5000000000', fee: '10000', nonce: 3, timestamp: 1_700_000_000_002 },
  { type: 'VOTE', from: A, to: null, amount: '0', fee: '10000', nonce: 4, timestamp: 1_700_000_000_003,
    data: { votes: { [B]: '2000000000' } } },
  { type: 'TOKEN_TRANSFER', from: A, to: C, amount: '250', fee: '10000', nonce: 5, timestamp: 1_700_000_000_004,
    data: { token: eavHash('token-de-teste') } },
];
grava('transaction.json', {
  description:
    'Payload canônico e id. O id deriva SÓ do payload assinado — nunca dos bytes da ' +
    'assinatura, que são maleáveis. Duas assinaturas diferentes do mesmo payload ' +
    'produzem o MESMO id, e é isso que a deduplicação do mempool aproveita.',
  cases: txsBase.map((tx) => {
    const core = { protocol: CHAIN.PROTOCOL, scheme: 'eav7-hybrid-1', ...tx };
    const payload = txSigningPayload(core);
    return { kind: 'canonicalPayload+id', input: core, payload, id: eavHash(payload) };
  }),
});

// ------------------------------------------------- 3b. codificação canônica
// A folha do stateRoot depende DESTES bytes. Um cliente que os produza diferente
// produz outra raiz — por isso o formato tem vetor próprio, antes do stateRoot.
grava('canonical.json', {
  description:
    'Codificação canônica do estado (src/core/canonical.js). Substitui JSON.stringify, ' +
    'que não é especificação: no V8, inteiro acima de 2^53 perde precisão, 1e21 vira ' +
    '"1e+21" e -0 vira 0. Formato: tag + u32BE(comprimento) + carga.',
  format: {
    '0x00': 'nulo', '0x01': 'falso', '0x02': 'verdadeiro',
    '0x03': 'inteiro: u32BE(n) + n bytes ASCII decimal',
    '0x04': 'texto: u32BE(n) + n bytes UTF-8',
    '0x05': 'lista: u32BE(n) + n valores',
    '0x06': 'mapa: u32BE(n) + n pares (texto, valor), ordenados por bytes da chave',
  },
  cases: [
    { input: null, encoded: canonicalHex(null) },
    { input: true, encoded: canonicalHex(true) },
    { input: false, encoded: canonicalHex(false) },
    { input: 0, encoded: canonicalHex(0), note: '0 e -0 codificam igual' },
    { input: 42, encoded: canonicalHex(42) },
    { input: -1, encoded: canonicalHex(-1) },
    { input: '9007199254740993', kind: 'bigint', encoded: canonicalHex(9007199254740993n),
      note: 'acima de 2^53: JSON.stringify truncaria para ...992' },
    { input: (10n ** 40n + 7n).toString(), kind: 'bigint', encoded: canonicalHex(10n ** 40n + 7n) },
    { input: '', encoded: canonicalHex('') },
    { input: 'eav7', encoded: canonicalHex('eav7') },
    { input: 'café', encoded: canonicalHex('café'), note: 'UTF-8 cru, sem escape' },
    { input: [], encoded: canonicalHex([]) },
    { input: ['ab'], encoded: canonicalHex(['ab']), note: 'não pode colidir com ["a","b"]' },
    { input: ['a', 'b'], encoded: canonicalHex(['a', 'b']) },
    { input: {}, encoded: canonicalHex({}) },
    { input: { a: 1, b: 2 }, encoded: canonicalHex({ a: 1, b: 2 }) },
    { input: { b: 2, a: 1 }, encoded: canonicalHex({ b: 2, a: 1 }), note: 'ordem de inserção é irrelevante' },
    { input: { A: 2, a: 1 }, encoded: canonicalHex({ A: 2, a: 1 }), note: "ordenação por BYTE: 'A' antes de 'a'" },
    { input: { a: 1 }, encoded: canonicalHex({ a: 1, b: undefined }), note: 'undefined é omitido' },
    { input: { lista: [1, 'dois', null] }, encoded: canonicalHex({ lista: [1, 'dois', null] }) },
  ],
});

// ------------------------------------------------------------- 3. raiz de estado
function estadoExemplo() {
  const s = new State();
  const a = s.getAccount(A); a.balance = 1_000n * CHAIN.UNIT; a.nonce = 3;
  const b = s.getAccount(B); b.balance = 500n * CHAIN.UNIT; b.staked = 2_000n * CHAIN.UNIT;
  const c = s.getAccount(C); c.balance = 1n;
  return s;
}
const stAmostra = estadoExemplo();
grava('stateroot.json', {
  description:
    'Folhas canônicas e raiz de Merkle do estado. O campo `account` vem TIPADO ' +
    '({int|str|bool|list|map}) porque `"1000000000"` sozinho é ambíguo entre inteiro ' +
    'e texto, e os dois produzem folhas diferentes. As folhas são ORDENADAS antes de ' +
    'compor a árvore, então a raiz não depende da ordem de inserção — requisito para ' +
    'dois clientes chegarem ao mesmo valor partindo de caminhos diferentes.',
  cases: [
    { kind: 'stateRoot', input: 'estado vazio', output: computeStateRoot(new State()) },
    { kind: 'stateRoot', input: 'três contas', output: computeStateRoot(stAmostra) },
    ...[A, B, C].map((end) => ({
      kind: 'accountLeaf',
      // Estas três contas COMPÕEM o estado de amostra: as folhas delas entram na
      // raiz. Os casos de cobertura abaixo exercitam só a função `leaf` e NÃO
      // pertencem a nenhum estado — sem esta marca, um cliente tentaria montar a
      // raiz com todas e chegaria a outro valor.
      role: 'sampleState',
      input: { address: end, account: tipado(stAmostra.accounts[end]) },
      output: accountLeaf(end, stAmostra.accounts[end]),
    })),
    // COBERTURA DE BYTE ALTO. Sem estes casos o vetor não exercita a codificação
    // de nada acima de 0x7f, e um cliente que passe a forma canônica por uma
    // string intermediária (o erro que a referência cometeu e corrigiu) passa em
    // tudo e diverge só na primeira folha com acentuação ou texto longo.
    {
      kind: 'accountLeaf',
      role: 'encodingCoverage',
      input: { address: A, account: tipado({ apelido: 'café ção', balance: 1n }) },
      output: accountLeaf(A, { apelido: 'café ção', balance: 1n }),
      note: 'UTF-8 multibyte no VALOR hasheado, não só na descrição',
    },
    {
      kind: 'accountLeaf',
      role: 'encodingCoverage',
      input: { address: A, account: tipado({ memo: 'x'.repeat(200) }) },
      output: accountLeaf(A, { memo: 'x'.repeat(200) }),
      note: 'comprimento 200: o u32BE do tamanho tem byte 0xc8, acima de 0x7f',
    },
    {
      kind: 'accountLeaf',
      role: 'encodingCoverage',
      input: { address: A, account: tipado({ s: '\u00ff\u0080\u00c0' }) },
      output: accountLeaf(A, { s: '\u00ff\u0080\u00c0' }),
      note: 'os pontos de código exatos onde latin1 e UTF-8 divergem',
    },
    {
      kind: 'stateRoot.ordemNaoImporta',
      input: 'mesmas contas inseridas em ordem inversa',
      output: (() => {
        const s = new State();
        const c = s.getAccount(C); c.balance = 1n;
        const b = s.getAccount(B); b.balance = 500n * CHAIN.UNIT; b.staked = 2_000n * CHAIN.UNIT;
        const a = s.getAccount(A); a.balance = 1_000n * CHAIN.UNIT; a.nonce = 3;
        return computeStateRoot(s);
      })(),
      note: 'tem de bater com o caso "três contas"',
    },
  ],
});

// ------------------------------------------------------------- 4. execução EAVM
const H_OSAKA = CHAIN.EAVM_OSAKA_HEIGHT;
const mundoVazio = () => ({
  getCode: () => Buffer.alloc(0), putCode: () => {},
  getStorage: () => 0n, setStorage: () => {},
  getBalance: () => 0n, addBalance: () => {}, moveValue: () => true, bumpNonce: () => 0,
  createAddress: () => '0x' + '33'.repeat(20), create2Address: () => '0x' + '44'.repeat(20),
  snapshot: () => 0, revert: () => {},
});
function execuisa(codeHex, number) {
  const r = runEavm({
    code: Buffer.from(codeHex, 'hex'), gas: 1_000_000n, host: createHost(mundoVazio()),
    address: '0x' + '11'.repeat(20), caller: '0x' + '22'.repeat(20),
    block: { number, timestamp: 1_000, chainId: CHAIN.EAVM_CHAIN_ID },
  });
  return { success: r.success, gasUsed: r.gasUsed.toString(), returnData: '0x' + r.returnData.toString('hex') };
}
const RET = '60005260206000f3'; // MSTORE(0, topo) ; RETURN(0,32)
const progsEavm = [
  ['ADD', '6001600201' + RET],
  ['MUL', '6003600402' + RET],
  ['SUB com underflow (wrap em 2^256)', '6002600103' + RET],
  ['DIV por zero é 0, não erro', '6000600104' + RET],
  // 0x05 é SDIV, não EXP — o rótulo estava errado desde a primeira versão deste
  // gerador. O bytecode e o gás sempre foram consistentes entre si, então o vetor
  // funcionava como juiz; só o nome enganava quem lesse.
  ['SDIV', '6008600205' + RET],
  ['EXP (0x0a)', '600860020a' + RET],
  ['KECCAK256 de vazio', '600060002' + '0' + RET],
  ['SHL', '600160ff1b' + RET],
  ['CLZ de 1 (Osaka)', '60011e' + RET],
  ['CLZ de 0 é 256', '60001e' + RET],
  ['MCOPY (Cancun)', '7f' + 'aa'.repeat(32) + '600052' + '6020600060205e' + '60206020f3'],
  ['TSTORE/TLOAD (Cancun)', '602a60075d' + '60075c' + RET],
  ['BLOBHASH sem blobs é 0', '600049' + RET],
  ['BLOBBASEFEE é 1', '4a' + RET],
];
grava('evm.json', {
  description:
    'Execução de bytecode na EAVM. Cada caso traz o gás consumido: um cliente que ' +
    'produza o mesmo retorno com gás diferente DIVERGE — o gás é consenso.',
  evmVersion: 'osaka',
  forkHeight: H_OSAKA,
  cases: progsEavm.map(([nome, code]) => ({
    kind: 'runEavm', name: nome, code: '0x' + code, blockNumber: H_OSAKA, ...execuisa(code, H_OSAKA),
  })),
});

// --------------------------------------------------- 5. envelope EAVM (rota EVM)
// Chave privada FIXA (nunca use em rede real). Os raws são gerados aqui e não
// escritos à mão: hex inventado à mão gera vetor que testa o meu erro de digitação,
// não o protocolo.
// Raws CONGELADOS. Não são gerados a cada execução porque nosso `sign` usa `k`
// aleatório (não RFC 6979): assinar de novo produz bytes diferentes e o vetor
// deixaria de ser reproduzível. Congelar é o certo — o que o vetor precisa fixar
// é a DECODIFICAÇÃO e a CLASSIFICAÇÃO destes bytes, não o ato de assinar.
//
// Gerados uma vez com a chave privada fixa
// 0x1111…1111 (jamais usar em rede real).
const CASOS_RAW = [
  ['transferência simples',
    '0xf86d80856edf2a079e832dc6c094777777777777777777777777777777777777777785e8d4a5100080830232cba0550fe727de2fb864a6f1691e38476cbdd7b86973635bfa6d2805b53368f9bcf5a04d6f03ff12fca1087dc6788278005ae289208039a985f043b8436ae2a8c06952'],
  ['destino E7 nativo no campo to',
    '0xf86e01856edf2a079e832dc6c094e7000000d36986e47ac3768974578f7ccd3123ae8601d1a94a200080830232cca0481eea10da4838adf91dd22d511c624b9103a30a4be69b47559590d96e7412c2a05acb390ff245fc2adf840e42c8f94e2d885bb14b33636837e54571549bcbd3bf'],
  ['operação nativa STAKE por endereço de sistema',
    '0xf86e02856edf2a079e832dc6c094000000000000000000000000000000000000700186048c2739500080830232cba0ab15f1d617e3e5f8063673b8155a9eedd48c6970be74f1a9d459bbdb50b78f23a05c52f3599a04343ef66216bfae5d899da042c31f4dff0a8ef132637e98e8c37f'],
  ['implantação de contrato',
    '0xf86803856edf2a079e832dc6c08080946008600c60003960086000f360aa60006000a100830232cca095a804c82a15a796ff6de43e80dba629cbc90e11e8bda49c652d6c37aad1eda5a01bb48f2fa6465ded572f8c24d69f4e7ab14b8be934faa9938a3e0df66656112c'],
  ['chamada de contrato com calldata',
    '0xf86c04856edf2a079e832dc6c09488888888888888888888888888888888888888888084deadbeef830232cca041635286b883e14c489045be64a303f8a24a24403d09576d0ece0935dff845faa008c896aeb0b624ab6fb5e685d9163f21ed08b2b9e49e4b9ae0ef86beb5744c01'],
];

const envelopes = [];
for (const [nome, raw] of CASOS_RAW) {
  const parsed = decodeRawTransaction(raw);
  const env = buildEavmEnvelope(raw, { timestamp: 1_700_000_000_000 });
  envelopes.push({
    kind: 'buildEavmEnvelope', name: nome, raw,
    // `from` é RECUPERADO da assinatura — nunca vem informado no envelope.
    recoveredFrom: parsed.from,
    parsed: estavel({ ...parsed, gasPrice: parsed.gasPrice, gasLimit: parsed.gasLimit, value: parsed.value }),
    envelope: estavel({ type: env.type, from: env.from, to: env.to, amount: env.amount, fee: env.fee, nonce: env.nonce, id: env.id, data: env.data }),
  });
}
grava('eavm-envelope.json', {
  description:
    'Decodificação da transação EVM assinada e classificação do envelope. É o ponto ' +
    'em que uma carteira do ecossistema Ethereum entra na EAV7: o `from` é RECUPERADO ' +
    'da assinatura, nunca informado.',
  cases: envelopes,
});

// ------------------------------------------------------------------ 6. metadados
grava('meta.json', {
  description:
    'Parâmetros do protocolo no momento da geração. Um cliente que implemente valores ' +
    'diferentes destes não é a mesma rede — comparar este arquivo é o primeiro teste.',
  protocol: CHAIN.PROTOCOL,
  protocolVersion: CHAIN.PROTOCOL_VERSION,
  addressPrefix: CHAIN.ADDRESS_PREFIX,
  hashLength: CHAIN.HASH_LENGTH,
  addressLength: CHAIN.ADDRESS_LENGTH,
  decimals: CHAIN.DECIMALS,
  blockTimeMs: CHAIN.BLOCK_TIME_MS,
  maxValidators: CHAIN.MAX_VALIDATORS,
  eavmChainId: CHAIN.EAVM_CHAIN_ID,
  eavmWeiPerE7: CHAIN.EAVM_WEI_PER_E7.toString(),
  forkHeights: Object.fromEntries(
    [...FORK_HEIGHTS].sort().map((k) => [k, CHAIN[k]]),
  ),
});

console.log('\npronto. Qualquer implementação do eav20 tem de reproduzir estes arquivos.');
