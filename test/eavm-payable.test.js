import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { buildTransaction } from '../src/core/transaction.js';
import { keccak256 } from '../src/eavm/keccak.js';
import { encodeE7Dest, decodeE7Dest, eavmToE7 } from '../src/eavm/envelope.js';

// Fase 2.3 — contratos EAVM pagáveis sobre LEDGER UNIFICADO.
//
// O ponto destes testes é o achado A-3: a ponte de valor antiga era UNIDIRECIONAL
// (entrava e nunca saía), então os fundos ficavam presos. Aqui provamos que o valor
// entra, circula e SAI, e que o supply se conserva em todos os caminhos.

const H = CHAIN.EAVM_VALUE_HEIGHT;          // acima do fork: pagável
const BELOW = CHAIN.EAVM_VALUE_HEIGHT - 1;  // abaixo: non-payable (comportamento antigo)

const createAddr = (s, n) => '0x' + keccak256(Buffer.from(s + ':' + n)).subarray(12).toString('hex');
const e7Of = (a) => decodeE7Dest(a) ?? eavmToE7(a);

// Runtime que devolve TODO o saldo do contrato para um destino fixo.
//   PUSH1 0 ×4 (ret/args) · SELFBALANCE · PUSH20 alvo · PUSH2 0xffff · CALL · STOP
const payoutRuntime = (target) =>
  '6000600060006000' + '47' + '73' + target.slice(2).toLowerCase() + '61ffff' + 'f1' + '00';
// Init padrão: copia o runtime (35 bytes = 0x23) a partir do offset 12 e retorna.
const initFor = (runtime) => '6023600c60003960236000f3' + runtime;

const REVERTER = '60006000fd';                       // PUSH1 0, PUSH1 0, REVERT
const INIT_REVERTER = '6005600c60003960056000f3' + REVERTER;

function funded(state, eav7 = 1000n) {
  const w = generateKeyPair();
  const addr = walletAddress(w);
  state.getAccount(addr).balance = eav7 * CHAIN.UNIT;
  state.getAccount(addr).staked = 1000n * CHAIN.UNIT; // energia/bandwidth cobrem => taxa 0
  return { w, addr };
}

// Soma de tudo que existe: saldos + stake + queimado. Tem de ser invariante.
function totalSupply(state) {
  let t = state.totalBurned;
  for (const a of Object.values(state.accounts)) t += a.balance + a.staked;
  return t;
}

test('2.3: contrato RECEBE valor acima do fork (payable) e o saldo vai para a conta nativa', () => {
  const state = new State();
  const { w, addr } = funded(state);
  const before = totalSupply(state);

  state.applyTransaction(buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + initFor(payoutRuntime('0x' + '11'.repeat(20))) } }), H);
  const contract = createAddr(encodeE7Dest(addr), 0);
  assert.ok(state.contracts[contract]?.code, 'contrato implantado');

  // envia 5 EAV7 junto da chamada
  state.applyTransaction(buildTransaction(w, { type: 'EAVM_CALL', amount: 5n * CHAIN.UNIT, nonce: 2, data: { to: contract, input: '0x' } }), H);

  // o alvo do payout é 0x1111… (sem contrato) — recebeu os 5 na conta nativa dele
  assert.equal(state.balanceOf(e7Of('0x' + '11'.repeat(20))), 5n * CHAIN.UNIT);
  assert.equal(state.balanceOf(addr), 995n * CHAIN.UNIT, 'remetente debitado em exatamente 5');
  assert.equal(state.contracts[contract].balance, 0n, 'contracts[].balance permanece 0 (serialização intacta)');
  assert.equal(totalSupply(state), before, 'supply conservado');
});

test('2.3: valor SAI do contrato — o achado A-3 (fundos presos) não voltou', () => {
  const state = new State();
  const { w, addr } = funded(state);
  const sink = funded(state, 0n); // destino do payout, conta E7 real
  const target = encodeE7Dest(sink.addr);

  state.applyTransaction(buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + initFor(payoutRuntime(target)) } }), H);
  const contract = createAddr(encodeE7Dest(addr), 0);

  const before = totalSupply(state);
  state.applyTransaction(buildTransaction(w, { type: 'EAVM_CALL', amount: 7n * CHAIN.UNIT, nonce: 2, data: { to: contract, input: '0x' } }), H);

  // entrou 7 no contrato e o runtime devolveu os 7 para o destino E7 REAL
  assert.equal(state.balanceOf(sink.addr), 7n * CHAIN.UNIT, 'destino recebeu — valor não ficou preso');
  assert.equal(state.balanceOf(e7Of(contract)), 0n, 'contrato não retém saldo');
  assert.equal(totalSupply(state), before, 'supply conservado');
});

test('2.3: destino E7 é resolvido de volta (mapeamento bidirecional, não conta órfã)', () => {
  const state = new State();
  const { addr } = funded(state);
  // encodeE7Dest → decodeE7Dest tem de fechar exatamente no mesmo E7
  assert.equal(decodeE7Dest(encodeE7Dest(addr)), addr);
  assert.equal(e7Of(encodeE7Dest(addr)), addr);
});

test('2.3: execução que reverte DEVOLVE o valor ao remetente', () => {
  const state = new State();
  const { w, addr } = funded(state);

  state.applyTransaction(buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + INIT_REVERTER } }), H);
  const contract = createAddr(encodeE7Dest(addr), 0);

  const before = totalSupply(state);
  const saldoAntes = state.balanceOf(addr);
  state.applyTransaction(buildTransaction(w, { type: 'EAVM_CALL', amount: 9n * CHAIN.UNIT, nonce: 2, data: { to: contract, input: '0x' } }), H);

  assert.equal(state.balanceOf(addr), saldoAntes, 'valor voltou integralmente (revert do EVM)');
  assert.equal(state.balanceOf(e7Of(contract)), 0n);
  assert.equal(totalSupply(state), before, 'supply conservado');
});

test('2.3: saldo insuficiente para o valor enviado é rejeitado sem mutar estado', () => {
  const state = new State();
  const { w, addr } = funded(state, 10n);

  state.applyTransaction(buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + initFor(payoutRuntime('0x' + '11'.repeat(20))) } }), H);
  const contract = createAddr(encodeE7Dest(addr), 0);
  const before = totalSupply(state);

  assert.throws(
    () => state.applyTransaction(buildTransaction(w, { type: 'EAVM_CALL', amount: 999n * CHAIN.UNIT, nonce: 2, data: { to: contract, input: '0x' } }), H),
    /saldo insuficiente/,
  );
  assert.equal(totalSupply(state), before, 'nada mutou');
});

test('2.3: ABAIXO do fork continua non-payable (comportamento antigo intacto)', () => {
  const state = new State();
  const { w, addr } = funded(state);
  assert.throws(
    () => state.applyTransaction(buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 5n * CHAIN.UNIT, nonce: 1, data: { code: '0x' + INIT_REVERTER } }), BELOW),
    /não aceita valor/,
  );
  assert.equal(state.balanceOf(addr), 1000n * CHAIN.UNIT);
});

test('2.3: transferência INTERNA é emitida para o índice node-local (fora do consenso)', () => {
  const state = new State();
  const { w, addr } = funded(state);
  const sink = funded(state, 0n);
  const target = encodeE7Dest(sink.addr);

  state.applyTransaction(buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + initFor(payoutRuntime(target)) } }), H);
  const contract = createAddr(encodeE7Dest(addr), 0);

  const captured = [];
  const tx = buildTransaction(w, { type: 'EAVM_CALL', amount: 4n * CHAIN.UNIT, nonce: 2, data: { to: contract, input: '0x' } });
  state.applyTransaction(tx, H, 0, (e) => captured.push(e));

  const internos = captured.filter((e) => e.internal);
  assert.equal(internos.length, 1, 'exatamente uma transferência interna');
  assert.equal(internos[0].txId, tx.id);
  assert.equal(internos[0].from, contract);
  assert.equal(internos[0].toE7, sink.addr);
  assert.equal(internos[0].amount, (4n * CHAIN.UNIT).toString());
  // o valor de ENTRADA não é transferência interna: já é o `amount` da própria tx
  assert.ok(!internos.some((e) => e.kind === 'entry'));
});

test('2.3: execução revertida NÃO emite transferência interna nem cria conta-fantasma', () => {
  const state = new State();
  const { w, addr } = funded(state);

  state.applyTransaction(buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + INIT_REVERTER } }), H);
  const contract = createAddr(encodeE7Dest(addr), 0);

  const captured = [];
  state.applyTransaction(buildTransaction(w, { type: 'EAVM_CALL', amount: 3n * CHAIN.UNIT, nonce: 2, data: { to: contract, input: '0x' } }), H, 0, (e) => captured.push(e));

  assert.equal(captured.filter((e) => e.internal).length, 0);
  assert.equal(state.accounts[e7Of(contract)], undefined, 'sem conta-fantasma de saldo 0 no estado');
});

test('2.3: recibo distingue execução bem-sucedida de revertida', () => {
  const state = new State();
  const { w, addr } = funded(state);
  const rec = [];
  const sink = (e) => { if (e.receipt) rec.push(e); };

  // contrato que reverte
  state.applyTransaction(buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + INIT_REVERTER } }), H, 0, sink);
  const reverter = createAddr(encodeE7Dest(addr), 0);
  state.applyTransaction(buildTransaction(w, { type: 'EAVM_CALL', amount: 0, nonce: 2, data: { to: reverter, input: '0x' } }), H, 0, sink);

  assert.equal(rec.length, 2, 'um recibo por tx EAVM');
  assert.equal(rec[0].success, true, 'deploy bem-sucedido');
  assert.equal(rec[1].success, false, 'chamada revertida marcada como falha');
  assert.ok(rec.every((r) => typeof r.txId === 'string'), 'recibo referencia a tx');
});

test('2.3: transação não-EAVM não emite recibo (inclusão já implica sucesso)', () => {
  const state = new State();
  const { w } = funded(state);
  const dest = walletAddress(generateKeyPair());
  const rec = [];
  state.applyTransaction(
    buildTransaction(w, { type: 'TRANSFER', to: dest, amount: 1n * CHAIN.UNIT, nonce: 1 }),
    H, 0, (e) => { if (e.receipt) rec.push(e); },
  );
  assert.equal(rec.length, 0);
});
