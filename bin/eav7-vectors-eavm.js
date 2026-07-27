#!/usr/bin/env node
// Vetores de CONFORMIDADE da integração EAVM <-> estado (fonte de verdade do porte Rust).
//
// Os vetores de estado (eav7-vectors-state.js) fixam a máquina de estado das transações
// nativas. Estes fixam o ACOPLAMENTO entre a VM de contratos e o estado de consenso:
// orçamento de gás derivado de energia+queima, cobrança de taxa mesmo em revert,
// depósito de código (len×20), ledger unificado de valor (fork EAVM_VALUE_HEIGHT),
// gate de contratos pela rota EVM (fork EAVM_CONTRACTS_HEIGHT), anel EIP-2935 do
// BLOCKHASH e a forma exata das folhas `ctr` no stateRoot. É onde um porte diverge
// sem avisar: um byte de storage diferente e a raiz cinde a rede.
//
// Formato de cada caso:
//   pre      — estado inicial declarativo: accounts {E7: {balance, staked, nonce}},
//              contracts {0x: {code, storage, balance, nonce}}, tokens (EAV20),
//              blockHashes [[número, hash]] aplicados via state.recordBlockHash
//   txs      — transações CRUAS como applyTransaction consome. SEM assinatura:
//              applyTransaction NÃO verifica assinatura (isso é do verifyTransaction,
//              que roda antes, stateless). O porte aplica o MESMO objeto.
//   expect   — fees[]     taxa QUEIMADA por tx (delta de totalBurned; o retorno de
//                         applyTransaction é sempre 0n — a taxa some do supply)
//              receipts[] {success, gasUsed, contractAddr?, logs, xfers} por tx EAVM;
//                         null para tx não-EAVM (não emite recibo)
//              leaves[]   TODAS as folhas do stateRoot do estado FINAL, ordenadas —
//                         merkleRoot(leaves) == stateRoot (também gravado)
//              error      mensagem se a tx de índice errorTxIndex LANÇA; nesse caso
//                         as leaves são do estado INTACTO (atomicidade conferida aqui)
//
// Uso:  node bin/eav7-vectors-eavm.js [diretório]     (padrão: ./vectors)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { computeStateRoot } from '../src/core/stateroot.js';
import { encodeCanonical } from '../src/core/canonical.js';
import { eavHash, merkleRoot } from '../src/crypto/hash.js';
import { deriveAddressFrom } from '../src/crypto/keys.js';
import { keccak256 } from '../src/eavm/keccak.js';
import { encodeE7Dest, eavmToE7, EAVM_SCHEME } from '../src/eavm/envelope.js';

const OUT = process.argv[2] ?? join(process.cwd(), 'vectors');
mkdirSync(OUT, { recursive: true });

const UNIT = CHAIN.UNIT;
const TS = 1_700_000_000_000;
// Alturas de referência: acima de TODOS os forks EAVM e abaixo do fork de valor.
const H_HIGH = CHAIN.EAVM_CONTRACTS_HEIGHT + 10;
const H_LOW = CHAIN.EAVM_VALUE_HEIGHT - 10;

// Contas determinísticas (mesmo padrão dos demais geradores de vetor).
const A = deriveAddressFrom('VETOR-EAVM:alice');
const B = deriveAddressFrom('VETOR-EAVM:bob');
const C = deriveAddressFrom('VETOR-EAVM:carol');

// ---------------------------------------------------------------- helpers puros
// Réplica EXATA das funções de derivação usadas pelo State (não exportadas):
//   forma 0x do remetente ACIMA de EAVM_VALUE_HEIGHT  = encodeE7Dest(E7)
//   forma 0x do remetente ABAIXO do fork              = keccak(E7 literal)[12:]
//   endereço de contrato                              = keccak(sender0x + ':' + nonce)[12:]
const createAddr = (s, n) => '0x' + keccak256(Buffer.from(s + ':' + n)).subarray(12).toString('hex');
const legacyForm = (e7) => '0x' + keccak256(Buffer.from(String(e7))).subarray(12).toString('hex');

// Réplica da folha do stateRoot (stateroot.js não exporta stateLeaves; src/ não pode
// ser alterado). A réplica é CONFERIDA contra computeStateRoot em todo caso — se um
// dia stateroot.js mudar e esta cópia divergir, o gerador aborta em vez de emitir
// vetores errados.
const leaf = (domain, key, value) => eavHash(Buffer.concat([
  Buffer.from(domain + '\x1f' + key + '\x1f', 'utf8'),
  encodeCanonical(value),
]));
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
  for (const [addr, c] of Object.entries(state.pendingPerm ?? {})) leaves.push(leaf('pperm', addr, c));
  for (const [addr, c] of Object.entries(state.pendingCommission ?? {})) leaves.push(leaf('pcomm', addr, c));
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
  for (const [id, a] of Object.entries(state.aiAttesters ?? {})) leaves.push(leaf('attest', id, a));
  leaves.push(leaf('brg', 'state', state.bridge));
  leaves.push(leaf('brg', 'relayers', state.bridgeRelayers));
  leaves.push(leaf('brg', 'committees', state.bridgeSourceCommittees ?? {}));
  return leaves;
}
const sortedLeaves = (s) => stateLeaves(s).sort();

const estavel = (v) => {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(estavel);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, estavel(v[k])]));
  }
  return v;
};

function fail(msg) {
  console.error('\nFALHA DO GERADOR: ' + msg);
  process.exit(1);
}

// ---------------------------------------------------------------- montagem do pre
function montar(pre) {
  const s = new State();
  for (const [end, conf] of Object.entries(pre.accounts ?? {})) {
    const a = s.getAccount(end);
    if (conf.balance != null) a.balance = BigInt(conf.balance);
    if (conf.staked != null) a.staked = BigInt(conf.staked);
    if (conf.nonce != null) a.nonce = conf.nonce;
  }
  for (const [addr, c] of Object.entries(pre.contracts ?? {})) {
    s.contracts[addr] = {
      code: c.code ?? '', storage: { ...(c.storage ?? {}) },
      balance: BigInt(c.balance ?? 0), nonce: c.nonce ?? 0,
    };
  }
  for (const [id, tok] of Object.entries(pre.tokens ?? {})) {
    s.tokens[id] = {
      standard: 'eav20', id, name: tok.name, symbol: tok.symbol, decimals: tok.decimals,
      totalSupply: BigInt(tok.totalSupply), creator: tok.creator, owner: tok.owner ?? tok.creator,
      mintable: tok.mintable ?? false, paused: false, blacklist: {}, frozen: {},
      createdAt: TS, balances: Object.fromEntries(Object.entries(tok.balances ?? {}).map(([k, v]) => [k, BigInt(v)])),
      allowances: {},
    };
  }
  for (const [n, h] of pre.blockHashes ?? []) s.recordBlockHash(n, h);
  return s;
}

// ---------------------------------------------------------------- execução de caso
const casos = [];
let seq = 0;
const txId = () => eavHash('VETOR-EAVM-TX:' + (seq++));

// Aplica as txs em sequência capturando taxa (delta de totalBurned), recibo, logs e
// transferências internas via logSink. Se uma tx LANÇA, confere a atomicidade
// (folhas idênticas às de antes da tx) e encerra o caso ali.
function caso(nome, { pre, txs, height, blockTs = TS, note }) {
  const s = montar(pre);
  const fees = [];
  const receipts = [];
  let error = null;
  let errorTxIndex = null;
  for (const tx of txs) {
    const events = [];
    const burnedBefore = s.totalBurned;
    const leavesBefore = sortedLeaves(s);
    try {
      s.applyTransaction(tx, height, blockTs, (e) => events.push(e));
    } catch (e) {
      error = e.message;
      errorTxIndex = fees.length;
      const leavesAfter = sortedLeaves(s);
      if (JSON.stringify(leavesAfter) !== JSON.stringify(leavesBefore)) {
        fail(`"${nome}": tx rejeitada MUTOU o estado (bug no nó, não no vetor)`);
      }
      break;
    }
    fees.push((s.totalBurned - burnedBefore).toString());
    if (tx.type === 'EAVM_DEPLOY' || tx.type === 'EAVM_CALL') {
      const r = events.find((e) => e.receipt);
      if (!r) fail(`"${nome}": tx EAVM sem recibo no sink`);
      receipts.push({
        success: r.success,
        gasUsed: String(r.gasUsed),
        ...(r.contract ? { contractAddr: r.contract } : {}),
        logs: events.filter((e) => !e.receipt && !e.internal)
          .map(({ address, topics, data }) => ({ address, topics, data })),
        xfers: events.filter((e) => e.internal)
          .map(({ kind, from, to, fromE7, toE7, amount }) => ({ kind, from, to, fromE7, toE7, amount })),
      });
    } else {
      if (events.some((e) => e.receipt)) fail(`"${nome}": tx não-EAVM emitiu recibo`);
      receipts.push(null);
    }
  }
  const leaves = sortedLeaves(s);
  const root = computeStateRoot(s);
  // Auto-verificação da réplica de stateLeaves: qualquer drift do src aborta aqui.
  if (merkleRoot(leaves) !== root) fail(`"${nome}": réplica de stateLeaves divergiu de computeStateRoot`);
  casos.push({
    name: nome, note, height, blockTs,
    pre: estavel(pre), txs: estavel(txs),
    expect: {
      fees, receipts, leaves, stateRoot: root,
      ...(error != null ? { error, errorTxIndex } : {}),
    },
  });
  return s;
}

const tx = (extra) => ({
  protocol: CHAIN.PROTOCOL, scheme: 'eav7-hybrid-1', to: null, amount: '0',
  fee: '10000000', timestamp: TS, data: {}, id: txId(), ...extra,
});

// ---------------------------------------------------------------- bytecodes à mão
// (mesmo estilo dos testes: PUSH/MSTORE/RETURN comentados, nada de solc — exceto o
// fixture ERC20, que é um artefato REAL de solc 0.8.26 gravado em test/)
//
// init padrão: PUSH1 len, PUSH1 0x0c, PUSH1 0, CODECOPY, PUSH1 len, PUSH1 0, RETURN
const initFor = (runtime) => {
  const len = (runtime.length / 2).toString(16).padStart(2, '0');
  return `60${len}600c600039` + `60${len}6000f3` + runtime;
};
// contador: SLOAD(0), +1, DUP, SSTORE(0), MSTORE(0), RETURN 32 bytes (18 bytes)
const COUNTER = '6000546001018060005560005260206000f3';
// reverter: PUSH1 0, PUSH1 0, REVERT
const REVERTER = '60006000fd';
// payout(target): CALL(gas=0xffff, target, value=SELFBALANCE, sem args) e STOP —
// devolve TODO o saldo do contrato para `target` (transferência INTERNA observável)
const payout = (target) => '6000600060006000' + '47' + '73' + target.slice(2).toLowerCase() + '61ffff' + 'f1' + '00';
// leitor de BLOCKHASH(n): PUSH3 n, BLOCKHASH, PUSH1 0, SSTORE, STOP (9 bytes)
const blockhashReader = (n) => '62' + n.toString(16).padStart(6, '0') + '40' + '600055' + '00';
// init que devolve 30.000 bytes de runtime (acima de MAX_CONTRACT_BYTES=24.576):
// PUSH2 0x7530, PUSH1 0, RETURN
const INIT_OVERSIZED = '6175306000f3';
// fábrica (CREATE aninhado no runtime): PUSH13 <initFilho>, PUSH1 0, MSTORE (fica nos
// bytes 19..31), PUSH1 13 (size), PUSH1 19 (offset), PUSH1 0 (value), CREATE,
// PUSH1 0, SSTORE (endereço do filho no slot 0), STOP
const CHILD_INIT = initFor('00'); // filho: runtime de 1 byte (STOP)
const FACTORY = '6c' + CHILD_INIT + '600052' + '600d' + '6013' + '6000' + 'f0' + '600055' + '00';
// suicida: runtime de 1 byte SELFDESTRUCT (0xff) — a referência LANÇA EavmError
const SELFDESTRUCT = 'ff';

// ---------------------------------------------------------------- fixture ERC20
const ART = JSON.parse(readFileSync(new URL('../test/fixtures-erc20.json', import.meta.url), 'utf8'));
const w32 = (v) => BigInt(v).toString(16).padStart(64, '0');
const strArg = (str) => {
  const hex = Buffer.from(str, 'utf8').toString('hex');
  return w32(str.length) + hex.padEnd(64, '0');
};
// constructor(string _name, string _symbol, uint8 _decimals, uint256 _initialSupply)
const ERC20_CTOR_ARGS =
  w32(0x80) + w32(0xc0) + w32(6) + w32(10n ** 12n) + strArg('Vetor') + strArg('VET');
const ERC20_CREATION = ART.creation + ERC20_CTOR_ARGS;
const SEL_TRANSFER = keccak256(Buffer.from('transfer(address,uint256)')).subarray(0, 4).toString('hex');
const TOPIC_TRANSFER = '0x' + keccak256(Buffer.from('Transfer(address,address,uint256)')).toString('hex');
const ERC20_RECIPIENT = '0x' + '22'.repeat(20);
const ERC20_TRANSFER_INPUT = '0x' + SEL_TRANSFER + w32(BigInt(ERC20_RECIPIENT)) + w32(250_000_000n);

// ================================================================ CASOS

// 1 — deploy simples: folha ctr criada, código depositado, gás do depósito (len×20)
// embutido no gasUsed do recibo.
{
  const pre = { accounts: { [A]: { balance: (1_000n * UNIT).toString(), staked: (10_000n * UNIT).toString() } } };
  const s = caso('deploy simples: contador publicado, deposito de codigo cobrado', {
    pre, height: H_HIGH,
    txs: [tx({ type: 'EAVM_DEPLOY', from: A, nonce: 1, data: { code: '0x' + initFor(COUNTER) } })],
    note: 'gasUsed do recibo INCLUI o depósito de código (len×20 = ' + (COUNTER.length / 2) * 20 + '); ' +
          'endereço do contrato = keccak(encodeE7Dest(remetente) + ":" + nonceDaConta)[12:]',
  });
  const addr = createAddr(encodeE7Dest(A), 0);
  if (s.contracts[addr]?.code !== '0x' + COUNTER) fail('caso 1: runtime não publicado');
}

// 2 — ERC20 real (solc 0.8.26) + transfer(): storage muda, eventos Transfer emitidos
// no construtor E na chamada.
{
  const pre = { accounts: { [A]: { balance: (1_000n * UNIT).toString(), staked: (100_000n * UNIT).toString() } } };
  const s = caso('ERC20 do fixture: deploy com args de construtor + transfer() com sucesso', {
    pre, height: H_HIGH,
    txs: [
      tx({ type: 'EAVM_DEPLOY', from: A, nonce: 1, data: { code: ERC20_CREATION } }),
      tx({ type: 'EAVM_CALL', from: A, nonce: 2, data: { to: createAddr(encodeE7Dest(A), 0), input: ERC20_TRANSFER_INPUT } }),
    ],
    note: 'bytecode real de solc 0.8.26 (shanghai); `decimals` é immutable — gravado no ' +
          'RUNTIME pelo construtor, então o código on-chain difere do artefato do compilador',
  });
  const addr = createAddr(encodeE7Dest(A), 0);
  const rec = casos.at(-1).expect.receipts;
  if (!rec[0].success || !rec[1].success) fail('caso 2: execução deveria suceder');
  if (rec[0].logs.length !== 1 || rec[0].logs[0].topics[0] !== TOPIC_TRANSFER) fail('caso 2: Transfer do construtor ausente');
  if (rec[1].logs.length !== 1 || rec[1].logs[0].topics[0] !== TOPIC_TRANSFER) fail('caso 2: Transfer da chamada ausente');
  if (Object.keys(s.contracts[addr].storage).length < 4) fail('caso 2: storage do ERC20 não populado');
}

// 3 — call que REVERTE: recibo success:false, TAXA COBRADA (o gás gasto vira energia
// e a falta queima EAV7), folha ctr INTACTA (idêntica à pós-deploy).
{
  const pre = { accounts: { [A]: { balance: (1_000n * UNIT).toString() } } }; // SEM stake: só 10 de energia grátis => taxa > 0
  const txDeploy = tx({ type: 'EAVM_DEPLOY', from: A, nonce: 1, fee: '2000000', data: { code: '0x' + initFor(REVERTER) } });
  const txCall = tx({ type: 'EAVM_CALL', from: A, nonce: 2, fee: '2000000', data: { to: createAddr(encodeE7Dest(A), 0), input: '0x' } });
  const s = caso('call que reverte: taxa cobrada, contrato intacto, recibo success:false', {
    pre, height: H_HIGH, txs: [txDeploy, txCall],
    note: 'revert NÃO devolve a taxa: o gás consumido pela execução é convertido em ' +
          'energia e a falta é queimada — a tx entra no bloco como válida',
  });
  const addr = createAddr(encodeE7Dest(A), 0);
  const rec = casos.at(-1).expect.receipts;
  if (rec[1].success !== false) fail('caso 3: chamada deveria reverter');
  if (casos.at(-1).expect.fees[1] === '0') fail('caso 3: taxa da chamada revertida deveria ser > 0');
  // prova de que o mundo de contratos ficou como estava após o deploy
  const soDeploy = montar(pre);
  soDeploy.applyTransaction(structuredClone(txDeploy), H_HIGH, TS);
  if (leaf('ctr', addr, s.contracts[addr]) !== leaf('ctr', addr, soDeploy.contracts[addr])) {
    fail('caso 3: folha ctr mudou com a chamada revertida');
  }
}

// 4 — payable (acima de EAVM_VALUE_HEIGHT), ledger UNIFICADO: o valor da tx entra no
// contrato e o runtime repassa TUDO (SELFBALANCE) a um E7 real via CALL com valor —
// transferência INTERNA capturada em xfers.
{
  const pre = { accounts: {
    [A]: { balance: (1_000n * UNIT).toString(), staked: (10_000n * UNIT).toString() },
    [C]: { balance: '0' },
  } };
  const s = caso('payable: valor entra, contrato repassa via CALL, xfer interna registrada', {
    pre, height: H_HIGH,
    txs: [
      tx({ type: 'EAVM_DEPLOY', from: A, nonce: 1, data: { code: '0x' + initFor(payout(encodeE7Dest(C))) } }),
      tx({ type: 'EAVM_CALL', from: A, nonce: 2, amount: (5n * UNIT).toString(), data: { to: createAddr(encodeE7Dest(A), 0), input: '0x' } }),
    ],
    note: 'ledger unificado: contracts[].balance permanece 0n SEMPRE — o saldo 0x É o da ' +
          'conta nativa resolvida por decodeE7Dest ?? eavmToE7. O valor de ENTRADA (amount) ' +
          'não vira xfer interna (kind "entry" não é registrado)',
  });
  const contract = createAddr(encodeE7Dest(A), 0);
  const xf = casos.at(-1).expect.receipts[1].xfers;
  if (s.balanceOf(C) !== 5n * UNIT) fail('caso 4: destino não recebeu os 5 EAV7');
  if (s.balanceOf(A) >= 1_000n * UNIT - 5n * UNIT + 1n) fail('caso 4: remetente não debitado');
  if (xf.length !== 1 || xf[0].from !== contract || xf[0].toE7 !== C || xf[0].amount !== (5n * UNIT).toString()) {
    fail('caso 4: xfer interna incorreta');
  }
  if (s.contracts[contract].balance !== 0n) fail('caso 4: contracts[].balance deveria permanecer 0');
}

// 5 — EAVM_TRANSFER (esquema eavm): débito/crédito + taxa, sem VM.
{
  const eavmFrom = '0x' + '5a'.repeat(20);
  const from = eavmToE7(eavmFrom);
  caso('EAVM_TRANSFER (scheme eavm): débito, crédito e taxa — sem recibo (null)', {
    pre: { accounts: { [from]: { balance: (100n * UNIT).toString() } } },
    height: H_HIGH,
    txs: [tx({
      type: 'EAVM_TRANSFER', scheme: EAVM_SCHEME, from, to: B, nonce: 1,
      amount: (3n * UNIT).toString(), fee: '100000', data: { eavmFrom },
    })],
    note: 'EAVM_TRANSFER aceita amount 0 (carteiras EVM permitem); transação não-EAVM_CALL/DEPLOY não emite recibo',
  });
}

// 6 — GATE: deploy pela rota EVM (scheme eavm) ABAIXO de EAVM_CONTRACTS_HEIGHT lança.
{
  const eavmFrom = '0x' + '6b'.repeat(20);
  const from = eavmToE7(eavmFrom);
  caso('fork gate: EAVM_DEPLOY com scheme eavm abaixo de EAVM_CONTRACTS_HEIGHT lança', {
    pre: { accounts: { [from]: { balance: (100n * UNIT).toString(), staked: (1_000n * UNIT).toString() } } },
    height: CHAIN.EAVM_CONTRACTS_HEIGHT - 10,
    txs: [tx({
      type: 'EAVM_DEPLOY', scheme: EAVM_SCHEME, from, nonce: 1,
      data: { code: '0x' + initFor(COUNTER), eavmFrom },
    })],
    note: 'o gate vive no State (stateful) porque o envelope relaxado é stateless — ' +
          'abaixo do fork nó velho e nó novo rejeitam igual; leaves = estado intacto',
  });
  if (!casos.at(-1).expect.error) fail('caso 6: deveria lançar');
}

// 7 — valor != 0 ABAIXO de EAVM_VALUE_HEIGHT lança (non-payable), estado intacto.
{
  const contract = '0x' + '77'.repeat(20);
  caso('fork valor: EAVM_CALL com amount>0 abaixo de EAVM_VALUE_HEIGHT lança', {
    pre: {
      accounts: { [A]: { balance: (100n * UNIT).toString(), staked: (1_000n * UNIT).toString() } },
      contracts: { [contract]: { code: '0x00', storage: {}, balance: '0', nonce: 0 } },
    },
    height: H_LOW,
    txs: [tx({ type: 'EAVM_CALL', from: A, nonce: 1, amount: (1n * UNIT).toString(), data: { to: contract, input: '0x' } })],
    note: 'rejeitado ANTES de rodar a VM — abaixo do fork os contratos são non-payable',
  });
  if (!/não aceita valor/.test(casos.at(-1).expect.error ?? '')) fail('caso 7: erro inesperado');
}

// 8 — orçamento inviável: sem stake e fee 0, energia grátis (10) não cobre o custo
// base do deploy (10) => budgetEnergy <= 0, lança ANTES de rodar a VM.
{
  caso('orçamento: energia/saldo insuficiente lança antes de executar a VM', {
    pre: { accounts: { [B]: { balance: '1000' } } },
    height: H_HIGH,
    txs: [tx({ type: 'EAVM_DEPLOY', from: B, nonce: 1, fee: '0', data: { code: '0x' + initFor(COUNTER) } })],
    note: 'budget = energiaDisponível + min(fee, saldo)/BURN_PER_ENERGY − custoBase; ' +
          '<= 0 rejeita sem tocar na VM (fechamento do achado A-4)',
  });
  if (!/energia\/saldo insuficiente/.test(casos.at(-1).expect.error ?? '')) fail('caso 8: erro inesperado');
}

// 9 — anel EIP-2935 ponta a ponta: hashes semeados com recordBlockHash, contrato
// executa BLOCKHASH(H_HIGH-1) e grava o resultado no storage.
{
  const seed = [
    [H_HIGH - 1, eavHash('VETOR-EAVM:bloco:' + (H_HIGH - 1))],
    [H_HIGH - 2, eavHash('VETOR-EAVM:bloco:' + (H_HIGH - 2))],
  ];
  const s = caso('BLOCKHASH: anel EIP-2935 semeado via recordBlockHash, lido pela VM', {
    pre: {
      accounts: { [A]: { balance: (1_000n * UNIT).toString(), staked: (10_000n * UNIT).toString() } },
      blockHashes: seed,
    },
    height: H_HIGH,
    txs: [
      tx({ type: 'EAVM_DEPLOY', from: A, nonce: 1, data: { code: '0x' + initFor(blockhashReader(H_HIGH - 1)) } }),
      tx({ type: 'EAVM_CALL', from: A, nonce: 2, data: { to: createAddr(encodeE7Dest(A), 0), input: '0x' } }),
    ],
    note: 'o anel vive no storage do endereço de sistema 0x0000f908…2935 (slot = número % ' +
          CHAIN.BLOCKHASH_HISTORY + ') e por isso é folha ctr do stateRoot; o opcode só serve a ' +
          'janela de ' + CHAIN.BLOCKHASH_WINDOW + ' blocos e exige altura >= EAVM_OSAKA_HEIGHT',
  });
  const reader = createAddr(encodeE7Dest(A), 0);
  const esperado = '0x' + BigInt('0x' + seed[0][1]).toString(16);
  if (s.contracts[reader].storage['0x' + '0'.repeat(64)] !== esperado) {
    fail('caso 9: BLOCKHASH não devolveu o hash semeado');
  }
}

// 10 — runtime acima de MAX_CONTRACT_BYTES: success:false, NENHUM código gravado,
// mas a tx é válida (taxa do gás gasto cobrada, nonce avança).
{
  const s = caso('deploy oversized: runtime > MAX_CONTRACT_BYTES falha sem gravar código', {
    pre: { accounts: { [A]: { balance: (1_000n * UNIT).toString(), staked: (100_000n * UNIT).toString() } } },
    height: H_HIGH,
    txs: [tx({ type: 'EAVM_DEPLOY', from: A, nonce: 1, data: { code: '0x' + INIT_OVERSIZED } })],
    note: 'init devolve 30.000 bytes (teto ' + CHAIN.MAX_CONTRACT_BYTES + '); o gasUsed do recibo ' +
          'NÃO inclui o depósito (o depósito nunca é cobrado quando o deploy falha na checagem)',
  });
  const rec = casos.at(-1).expect.receipts[0];
  if (rec.success !== false || rec.contractAddr) fail('caso 10: deploy deveria falhar sem endereço');
  if (Object.keys(s.contracts).length !== 0) fail('caso 10: nenhum contrato deveria existir');
}

// 11a — CREATE aninhado no runtime: a fábrica publica um filho; o nonce do CONTRATO
// (campo nonce da folha ctr) avança via bumpNonce.
{
  const pre = { accounts: { [A]: { balance: (1_000n * UNIT).toString(), staked: (10_000n * UNIT).toString() } } };
  const s = caso('CREATE aninhado: fábrica publica filho, nonce do contrato avança', {
    pre, height: H_HIGH,
    txs: [
      tx({ type: 'EAVM_DEPLOY', from: A, nonce: 1, data: { code: '0x' + initFor(FACTORY) } }),
      tx({ type: 'EAVM_CALL', from: A, nonce: 2, data: { to: createAddr(encodeE7Dest(A), 0), input: '0x' } }),
    ],
    note: 'endereço do filho = keccak(fábrica + ":" + nonceDoContrato)[12:] — a MESMA regra ' +
          'de derivação do deploy de topo, com o nonce do CONTRATO (bumpNonce do mundo)',
  });
  const factory = createAddr(encodeE7Dest(A), 0);
  const child = createAddr(factory, 0);
  if (s.contracts[child]?.code !== '0x00') fail('caso 11a: filho não publicado');
  if (s.contracts[factory].nonce !== 1) fail('caso 11a: nonce da fábrica não avançou');
  if (BigInt(s.contracts[factory].storage['0x' + '0'.repeat(64)]) !== BigInt(child)) fail('caso 11a: slot 0 != endereço do filho');
}

// 11b — SELFDESTRUCT: a referência NÃO suporta (opcode 0xff lança EavmError). No frame
// de ENTRADA isso vira success:false com o ORÇAMENTO INTEIRO consumido.
{
  const pre = { accounts: { [A]: { balance: (1_000n * UNIT).toString(), staked: (100_000n * UNIT).toString() } } };
  caso('SELFDESTRUCT: não suportado — halt excepcional consome TODO o orçamento de gás', {
    pre, height: H_HIGH,
    txs: [
      tx({ type: 'EAVM_DEPLOY', from: A, nonce: 1, fee: '0', data: { code: '0x' + initFor(SELFDESTRUCT) } }),
      tx({ type: 'EAVM_CALL', from: A, nonce: 2, fee: '0', data: { to: createAddr(encodeE7Dest(A), 0), input: '0x' } }),
    ],
    note: 'opcode 0xff lança EavmError ("SELFDESTRUCT não suportado"); #runEavmTx trata como ' +
          'falha com gasUsed = orçamento INTEIRO — aqui o teto MAX_EAVM_GAS (' + CHAIN.MAX_EAVM_GAS + '). ' +
          'A energia correspondente é consumida da conta (visível na folha acct)',
  });
  const rec = casos.at(-1).expect.receipts[1];
  if (rec.success !== false) fail('caso 11b: chamada deveria falhar');
  if (rec.gasUsed !== String(CHAIN.MAX_EAVM_GAS)) fail('caso 11b: gasUsed deveria ser o orçamento inteiro (MAX_EAVM_GAS)');
}

// 12 — integração não perturba os outros domínios: conta com stake + token EAV20
// pré-existente + deploy/call EAVM no MESMO estado. As folhas acct/tok/ctr coexistem.
{
  const TOKID = eavHash('VETOR-EAVM-TOKEN');
  const pre = {
    accounts: {
      [A]: { balance: (1_000n * UNIT).toString(), staked: (10_000n * UNIT).toString() },
      [B]: { balance: (500n * UNIT).toString(), staked: (2_000n * UNIT).toString() },
    },
    tokens: { [TOKID]: {
      name: 'VetorTok', symbol: 'VTK', decimals: 6, totalSupply: '1000000000',
      creator: B, balances: { [B]: '1000000000' },
    } },
  };
  const s = caso('coexistência: stake + token EAV20 + contrato EAVM no mesmo stateRoot', {
    pre, height: H_HIGH,
    txs: [
      tx({ type: 'EAVM_DEPLOY', from: A, nonce: 1, data: { code: '0x' + initFor(COUNTER) } }),
      tx({ type: 'EAVM_CALL', from: A, nonce: 2, data: { to: createAddr(encodeE7Dest(A), 0), input: '0x' } }),
    ],
    note: 'prova que a integração EAVM não perturba folhas de outros domínios: o token e o ' +
          'stake de B não mudam — apenas acct de A (taxa/energia/nonce) e a ctr do contador',
  });
  if (s.tokens[TOKID].balances[B] !== 1_000_000_000n) fail('caso 12: token perturbado');
  if (s.accounts[B].staked !== 2_000n * UNIT) fail('caso 12: stake de B perturbado');
  const counter = createAddr(encodeE7Dest(A), 0);
  if (BigInt(s.contracts[counter].storage['0x' + '0'.repeat(64)]) !== 1n) fail('caso 12: contador não incrementou');
}

// 13 (bônus) — remetente pela rota EVM acima do fork: com data.eavmFrom, a identidade
// 0x na VM é o PRÓPRIO endereço EVM (não encodeE7Dest) — muda a derivação do contrato.
{
  const eavmFrom = '0x' + '9c'.repeat(20);
  const from = eavmToE7(eavmFrom);
  const s = caso('sender eavm: deploy com data.eavmFrom deriva o contrato do 0x REAL', {
    pre: { accounts: { [from]: { balance: (1_000n * UNIT).toString(), staked: (10_000n * UNIT).toString() } } },
    height: H_HIGH,
    txs: [tx({
      type: 'EAVM_DEPLOY', scheme: EAVM_SCHEME, from, nonce: 1,
      data: { code: '0x' + initFor(COUNTER), eavmFrom },
    })],
    note: 'acima de EAVM_VALUE_HEIGHT: scheme eavm + data.eavmFrom => sender0x = eavmFrom ' +
          '(a conta MetaMask é a identidade); contrato = keccak(eavmFrom + ":0")[12:]',
  });
  if (s.contracts[createAddr(eavmFrom, 0)]?.code !== '0x' + COUNTER) fail('caso 13: derivação por eavmFrom falhou');
}

// 14 (bônus) — ABAIXO de EAVM_VALUE_HEIGHT o remetente nativo usa a forma LEGADA
// keccak(E7)[12:] (não reversível) — deploy nativo é permitido, o gate é só p/ scheme eavm.
{
  const s = caso('sender legado: deploy nativo abaixo do fork de valor usa keccak(E7)[12:]', {
    pre: { accounts: { [A]: { balance: (1_000n * UNIT).toString(), staked: (10_000n * UNIT).toString() } } },
    height: H_LOW,
    txs: [tx({ type: 'EAVM_DEPLOY', from: A, nonce: 1, data: { code: '0x' + initFor(COUNTER) } })],
    note: 'a MESMA tx acima do fork derivaria outro endereço (encodeE7Dest); é exatamente o ' +
          'tipo de divergência silenciosa que um porte precisa acertar por altura',
  });
  if (s.contracts[createAddr(legacyForm(A), 0)]?.code !== '0x' + COUNTER) fail('caso 14: forma legada divergiu');
}

// ---------------------------------------------------------------- gravação
const corpo = {
  description:
    'Conformidade da integração EAVM<->estado. Cada caso: estado inicial declarativo + ' +
    'transações CRUAS (applyTransaction não verifica assinatura) + altura -> taxas ' +
    'queimadas, recibos (success/gasUsed/logs/xfers) e TODAS as folhas do stateRoot ' +
    'do estado final (merkleRoot(leaves) == stateRoot). Casos com `error`: a tx de ' +
    'índice errorTxIndex lança e as leaves provam o estado intacto (atomicidade).',
  invariants: [
    'tx EAVM rejeitada (gate de fork, orçamento, saldo) não muta NADA: leaves intactas',
    'execução revertida ainda é tx válida: taxa cobrada, nonce avança, mundo de contratos intacto',
    'contracts[].balance é sempre 0n — acima de EAVM_VALUE_HEIGHT o saldo 0x É o da conta nativa (decodeE7Dest ?? eavmToE7)',
    'deploy bem-sucedido cobra depósito de código: gasUsed += len(runtime) × 20',
    'a taxa é QUEIMADA (totalBurned), nunca vai ao produtor; applyTransaction retorna 0',
    'sender0x: altura < EAVM_VALUE_HEIGHT => keccak(E7)[12:]; acima => eavmFrom (scheme eavm) ou encodeE7Dest(E7)',
    'SELFDESTRUCT não é suportado: halt excepcional que consome o orçamento inteiro',
  ],
  constants: estavel({
    EAVM_VALUE_HEIGHT: CHAIN.EAVM_VALUE_HEIGHT,
    EAVM_CONTRACTS_HEIGHT: CHAIN.EAVM_CONTRACTS_HEIGHT,
    EAVM_OSAKA_HEIGHT: CHAIN.EAVM_OSAKA_HEIGHT,
    RESOURCE_HEIGHT: CHAIN.RESOURCE_HEIGHT,
    GAS_PER_ENERGY: CHAIN.GAS_PER_ENERGY,
    MAX_EAVM_GAS: CHAIN.MAX_EAVM_GAS,
    MAX_CONTRACT_BYTES: CHAIN.MAX_CONTRACT_BYTES,
    BLOCKHASH_HISTORY: CHAIN.BLOCKHASH_HISTORY,
    BLOCKHASH_WINDOW: CHAIN.BLOCKHASH_WINDOW,
    BURN_PER_ENERGY: CHAIN.ENERGY.BURN_PER_ENERGY,
    ENERGY_FREE: CHAIN.ENERGY.FREE,
    ENERGY_COST_DEPLOY: CHAIN.ENERGY.COST.EAVM_DEPLOY,
    ENERGY_COST_CALL: CHAIN.ENERGY.COST.EAVM_CALL,
    heightAboveForks: H_HIGH,
    heightBelowValueFork: H_LOW,
  }),
  cases: casos,
};
const texto = JSON.stringify(estavel(corpo), null, 2) + '\n';
writeFileSync(join(OUT, 'eavm-state.json'), texto);

const comErro = casos.filter((c) => c.expect.error).length;
console.log(`  eavm-state.json      ${String(casos.length).padStart(4)} casos  ${String(texto.length).padStart(7)} bytes`);
console.log(`    ${casos.length - comErro} aplicados, ${comErro} rejeitados (atomicidade conferida em cada rejeição)`);
console.log('    réplica de stateLeaves conferida contra computeStateRoot em todos os casos');
