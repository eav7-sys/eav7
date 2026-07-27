// EAVM até Osaka: BLOCKHASH (que faltava desde sempre), os opcodes de Cancun
// (TLOAD/TSTORE, MCOPY, BLOBHASH, BLOBBASEFEE) e o CLZ de Osaka.
//
// Tudo sob EAVM_OSAKA_HEIGHT: abaixo do fork os opcodes continuam INVÁLIDOS,
// exatamente como eram antes de existirem — é o que impede um nó atualizado de
// aceitar bytecode que um nó antigo rejeita.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { CHAIN } from '../src/config.js';
import { runEavm, EavmError } from '../src/eavm/vm.js';
import { createHost } from '../src/eavm/host.js';
import { State } from '../src/core/state.js';

const H = CHAIN.EAVM_OSAKA_HEIGHT;
const bc = (hex) => Buffer.from(hex, 'hex');

// Executa bytecode cru e devolve o retorno como BigInt.
function roda(hex, { number = H, host = null, gas = 1_000_000n } = {}) {
  const res = runEavm({
    code: bc(hex), gas, host: host ?? createHost(mundoVazio()),
    address: '0x' + '11'.repeat(20), caller: '0x' + '22'.repeat(20),
    block: { number, timestamp: 1_000, chainId: CHAIN.EAVM_CHAIN_ID },
  });
  if (!res.success) throw new EavmError('execução falhou');
  return BigInt('0x' + (res.returnData.toString('hex') || '0'));
}

// Mundo mínimo em memória — só o que o host precisa.
function mundoVazio(extra = {}) {
  const C = {};
  return {
    getCode: () => Buffer.alloc(0),
    putCode: () => {},
    getStorage: (a, k) => BigInt(C[a]?.[k] ?? 0n),
    setStorage: (a, k, v) => { (C[a] ??= {})[k] = v; },
    getBalance: () => 0n,
    addBalance: () => {},
    moveValue: () => true,
    bumpNonce: () => 0,
    createAddress: () => '0x' + '33'.repeat(20),
    create2Address: () => '0x' + '44'.repeat(20),
    snapshot: () => 0,
    revert: () => {},
    ...extra,
  };
}

// Devolve os 32 bytes do topo da pilha: MSTORE em 0, RETURN de 32 bytes.
const RET = '60005260206000f3';

test('CLZ (Osaka): conta zeros à esquerda numa palavra de 256 bits', () => {
  assert.equal(roda('6001' + '1e' + RET), 255n, 'valor 1 -> 255 zeros à esquerda');
  assert.equal(roda('60ff' + '1e' + RET), 248n, '0xff ocupa 8 bits');
  assert.equal(roda('6000' + '1e' + RET), 256n, 'zero -> 256, como manda o EIP-7939');
  // 2^255: bit mais alto ligado, nenhum zero à esquerda.
  assert.equal(roda('7f' + '80' + '00'.repeat(31) + '1e' + RET), 0n);
});

test('MCOPY (Cancun): copia um bloco de memória para outro endereço', () => {
  // 0xaa… em [0,32); copia 32 bytes de 0 para 32; devolve [32,64).
  const escreve = '7f' + 'aa'.repeat(32) + '600052';      // MSTORE(0, 0xaa…)
  const copia = '6020' + '6000' + '6020' + '5e';           // len=32, src=0, dest=32
  const devolve32 = '6020' + '6020' + 'f3';                // RETURN(offset=32, size=32)
  assert.equal(roda(escreve + copia + devolve32), BigInt('0x' + 'aa'.repeat(32)));
});

test('MCOPY com origem e destino sobrepostos não corrompe os dados', () => {
  // 0x01..0x20 em 0; copia 31 bytes de 0 para 1 (sobreposto); byte em 1 deve virar 0x01.
  const escreve = '7f' + '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20' + '600052';
  const copia = '601f' + '6000' + '6001' + '5e'; // len=31, src=0, dest=1
  const devolve0 = '6020' + '6000' + 'f3';       // RETURN(offset=0, size=32) — sem MSTORE antes
  const out = roda(escreve + copia + devolve0);
  assert.equal((out >> 248n) & 0xffn, 0x01n, 'byte 0 intacto');
  assert.equal((out >> 240n) & 0xffn, 0x01n, 'byte 1 recebeu o byte 0 — memmove correto');
});

test('TSTORE/TLOAD (Cancun): guarda e lê dentro da execução', () => {
  // TSTORE(chave=7, valor=0x2a) e depois TLOAD(7).
  const grava = '602a' + '6007' + '5d'; // pops: key, value
  const le = '6007' + '5c';
  assert.equal(roda(grava + le + RET), 0x2an);
});

test('TSTORE não vai para o storage permanente', () => {
  const escritas = [];
  const mundo = mundoVazio({ setStorage: (a, k, v) => escritas.push([a, k, v]) });
  roda('602a' + '6007' + '5d' + '6007' + '5c' + RET, { host: createHost(mundo) });
  assert.equal(escritas.length, 0, 'transiente não pode tocar o estado permanente');
});

test('BLOBHASH e BLOBBASEFEE: cadeia sem blobs responde 0 e 1', () => {
  assert.equal(roda('6000' + '49' + RET), 0n, 'sem blobs, qualquer índice é 0');
  assert.equal(roda('4a' + RET), 1n, 'taxa mínima de blob');
});

test('BLOCKHASH lê o anel de histórico e respeita a janela de 256', () => {
  const state = new State();
  state.recordBlockHash(H - 1, 'ab'.repeat(32));
  state.recordBlockHash(H - 250, 'cd'.repeat(32));
  state.recordBlockHash(H - 300, 'ef'.repeat(32));

  // O world real do State expõe blockHash; usamos o host sobre ele.
  const host = createHost({
    ...mundoVazio(),
    blockHash: (n) => {
      const slot = '0x' + (n % BigInt(CHAIN.BLOCKHASH_HISTORY)).toString(16);
      const addr = '0x0000f90827f1c53a10cb7a02335b175320002935';
      return BigInt(state.contracts[addr]?.storage?.[slot] ?? 0n);
    },
  });

  const pede = (n) => roda('7f' + n.toString(16).padStart(64, '0') + '40' + RET, { host });
  assert.equal(pede(H - 1), BigInt('0x' + 'ab'.repeat(32)), 'bloco anterior está na janela');
  assert.equal(pede(H - 250), BigInt('0x' + 'cd'.repeat(32)), '250 blocos atrás ainda vale');
  assert.equal(pede(H - 300), 0n, 'fora da janela de 256 -> 0, como em toda EVM');
  assert.equal(pede(H), 0n, 'bloco atual não tem hash ainda');
  assert.equal(pede(H + 5), 0n, 'bloco futuro -> 0');
});

test('FORK: abaixo de EAVM_OSAKA_HEIGHT os opcodes novos são inválidos', () => {
  const abaixo = H - 1;
  for (const [nome, code] of [
    ['CLZ', '6001' + '1e' + RET],
    ['MCOPY', '6020600060205e' + RET],
    ['TLOAD', '60075c' + RET],
    ['TSTORE', '602a60075d' + RET],
    ['BLOBHASH', '600049' + RET],
    ['BLOBBASEFEE', '4a' + RET],
  ]) {
    assert.throws(() => roda(code, { number: abaixo }), /falhou|inválido/, `${nome} deve falhar abaixo do fork`);
  }
});

test('FORK: BLOCKHASH devolve 0 abaixo da altura em vez de falhar', () => {
  // BLOCKHASH é opcode antigo: não pode virar "inválido" abaixo do fork, senão
  // bytecode legítimo pré-fork quebraria. Sem o anel, simplesmente devolve 0.
  assert.equal(roda('6001' + '40' + RET, { number: H - 1 }), 0n);
});

// Os precompiles novos precisam ser alcançáveis PELA VM, não só importáveis —
// e abaixo do fork o mesmo bytecode tem de se comportar como num nó antigo,
// senão nó atualizado e nó velho divergem no mesmo bloco.
test('precompiles 0x06-0x09 respondem acima do fork e não existem abaixo', () => {
  // STATICCALL(gas, 0x08, 0, 0, 0, 32) — ecPairing de entrada vazia devolve 1.
  const chama = (endereco) =>
    '6020' + '6000' + '6000' + '6000' + '60' + endereco + '620f4240' + 'fa' + '50' + '60206000f3';

  assert.equal(roda(chama('08'), { number: H, gas: 5_000_000n }), 1n, 'ecPairing vazio -> 1');
  assert.equal(
    roda(chama('08'), { number: H - 1, gas: 5_000_000n }), 0n,
    'abaixo do fork 0x08 é conta comum: sucesso vazio, igual a um nó antigo',
  );
});

// REGRESSÃO. O produtor e o validador TÊM de gravar o anel de histórico do mesmo
// jeito, senão computam raízes diferentes para o MESMO bloco — e o produtor
// commita uma raiz que a própria rede rejeita.
//
// Aconteceu de verdade: `produceBlock` montava o pseudo-bloco de `#simulate` sem
// `previousHash`, então `recordBlockHash` virava no-op só no caminho de produção.
// Acima de EAVM_OSAKA_HEIGHT a cadeia travaria no primeiro bloco após o fork.
//
// Roda em SUBPROCESSO com `EAV7_GENESIS_ACTIVE=1`: as alturas de fork são lidas na
// carga do módulo, e sem isso o teste passaria por estar abaixo do fork — ou seja,
// passaria sem testar nada.
test('REGRESSÃO: produtor e validador gravam o anel do EIP-2935 igual', () => {
  const script = `
    process.env.EAV7_GENESIS_ACTIVE = '1';
    const { CHAIN } = await import('./src/config.js');
    const { generateKeyPair, walletAddress } = await import('./src/crypto/keys.js');
    const { buildGenesisBlock } = await import('./src/core/block.js');
    const { Blockchain } = await import('./src/core/blockchain.js');
    const HIST = '0x0000f90827f1c53a10cb7a02335b175320002935';

    if (CHAIN.EAVM_OSAKA_HEIGHT !== 0) throw new Error('gênese-ativo não zerou o fork');

    const w = generateKeyPair(), A = walletAddress(w);
    const t0 = Date.now() - 60000;
    const chain = new Blockchain();
    chain.adoptGenesis(buildGenesisBlock({
      timestamp: t0,
      balances: { [A]: (1000n * CHAIN.UNIT).toString() },
      stakes: { [A]: (CHAIN.MIN_VALIDATOR_STAKE * 5n).toString() },
    }));

    // Se o produtor não gravasse o anel, a raiz que ele commita divergiria da que
    // o próprio addBlock recomputa — e o bloco seria rejeitado aqui dentro.
    const bloco = chain.produceBlock(w, [], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
    const anel = chain.state.contracts[HIST]?.storage ?? {};
    const slot = '0x' + (0n % BigInt(CHAIN.BLOCKHASH_HISTORY)).toString(16);
    if (Object.keys(anel).length !== 1) throw new Error('produtor NÃO gravou o anel');
    if (anel[slot] !== '0x' + chain.hashAt(0).toLowerCase()) throw new Error('gravou o hash errado');
    console.log('ok');
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8',
  });
  assert.match(out, /ok/, 'produtor e validador precisam gravar o anel igual');
});
