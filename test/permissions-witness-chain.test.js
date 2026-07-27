// `witness` numa CADEIA real, em modo gênese-ativo (todas as alturas de fork em 0),
// que é como a rede vai nascer. `node --test` isola cada arquivo em seu processo,
// então mutar CHAIN aqui não vaza para os outros testes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN, FORK_HEIGHTS } from '../src/config.js';

for (const k of FORK_HEIGHTS) CHAIN[k] = 0;

const { generateKeyPair, walletAddress } = await import('../src/crypto/keys.js');
const { Blockchain } = await import('../src/core/blockchain.js');
const { buildGenesisBlock } = await import('../src/core/block.js');
const { buildTransaction } = await import('../src/core/transaction.js');

function cadeia(contaWallet, extras = {}) {
  const addr = walletAddress(contaWallet);
  const t0 = Date.now() - 60_000;
  const gen = buildGenesisBlock({
    timestamp: t0,
    balances: { [addr]: (10_000n * CHAIN.UNIT).toString(), ...(extras.balances ?? {}) },
    stakes: { [addr]: (CHAIN.MIN_VALIDATOR_STAKE * 2n).toString() },
  });
  const chain = new Blockchain();
  chain.adoptGenesis(gen);
  return { chain, addr, t0 };
}

function delegar(chain, contaWallet, addr, witAddr, t0, slot) {
  const o = walletAddress(generateKeyPair());
  const act = walletAddress(generateKeyPair());
  chain.produceBlock(
    contaWallet,
    [
      buildTransaction(contaWallet, {
        type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
        data: {
          permission: {
            owner: { threshold: 1, keys: { [o]: 1 } },
            active: { threshold: 1, keys: { [act]: 1 } },
            witness: witAddr,
            delayBlocks: CHAIN.PERM_DELAY_MIN_BLOCKS,
          },
        },
      }),
    ],
    { timestamp: t0 + slot * CHAIN.BLOCK_TIME_MS },
  );
}

test('witness na cadeia: a chave witness assina e a recompensa vai para a CONTA', () => {
  const conta = generateKeyPair();
  const wit = generateKeyPair();
  const witAddr = walletAddress(wit);
  const { chain, addr, t0 } = cadeia(conta);

  delegar(chain, conta, addr, witAddr, t0, 1);
  assert.equal(chain.state.permissions[addr].witness, witAddr, 'delegação registrada');

  const saldoAntes = chain.state.balanceOf(addr);
  const b = chain.produceBlock(wit, [], { timestamp: t0 + 2 * CHAIN.BLOCK_TIME_MS, producerAccount: addr });

  assert.equal(b.producer, witAddr, 'assinado pela chave witness');
  assert.equal(b.producerAccount, addr, 'produzido em nome da conta');
  assert.ok(chain.state.balanceOf(addr) > saldoAntes, 'recompensa creditada à CONTA');
  assert.equal(chain.state.balanceOf(witAddr), 0n, 'a chave witness não recebe nada');
  assert.equal(chain.height, 2);
});

test('witness na cadeia: impostor não produz em nome de conta alheia', () => {
  const conta = generateKeyPair();
  const wit = generateKeyPair();
  const impostor = generateKeyPair();
  const { chain, addr, t0 } = cadeia(conta);

  delegar(chain, conta, addr, walletAddress(wit), t0, 1);

  assert.throws(
    () => chain.produceBlock(impostor, [], { timestamp: t0 + 2 * CHAIN.BLOCK_TIME_MS, producerAccount: addr }),
    /não é a chave witness registrada/,
  );
  assert.equal(chain.height, 1, 'nenhum bloco entrou');
});

test('witness na cadeia: a chave witness NÃO move fundos da conta', () => {
  const conta = generateKeyPair();
  const wit = generateKeyPair();
  const witAddr = walletAddress(wit);
  const destino = walletAddress(generateKeyPair());
  const { chain, addr, t0 } = cadeia(conta, { balances: { [witAddr]: (100n * CHAIN.UNIT).toString() } });

  delegar(chain, conta, addr, witAddr, t0, 1);

  // a witness participa da permissão, mas não é chave de GASTO (nível active)
  assert.throws(
    () => chain.produceBlock(wit, [
      buildTransaction(wit, {
        type: 'MULTISIG_PROPOSE', amount: 0, nonce: 1,
        data: { account: addr, op: { type: 'TRANSFER', to: destino, amount: (1n * CHAIN.UNIT).toString() } },
      }),
    ], { timestamp: t0 + 2 * CHAIN.BLOCK_TIME_MS, producerAccount: addr }),
    /não é uma chave autorizada/,
  );
});

test('witness na cadeia: sem delegação o campo não existe e a produção segue normal', () => {
  const conta = generateKeyPair();
  const { chain, addr, t0 } = cadeia(conta);
  const b = chain.produceBlock(conta, [], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
  assert.equal('producerAccount' in b, false, 'campo ausente sem delegação');
  assert.equal(b.producer, addr);
});
