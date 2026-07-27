#!/usr/bin/env node
// Gera uma cadeia REAL com o nó de referência e emite as raízes de estado por
// altura. É a fonte de verdade da PROVA DE REPLAY do cliente Rust: o Rust
// carrega o MESMO `blocks.jsonl` e tem de chegar às MESMAS raízes, bloco a bloco.
//
// Rodar com EAV7_GENESIS_ACTIVE=1 zera todos os forks — a cadeia nasce com TODAS
// as regras novas ligadas (stateRoot, recursos, permissões v2, contratos EAVM,
// Osaka). É o cenário do relançamento, e o mais exigente para o porte.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAIN } from '../src/config.js';
import { eavHash } from '../src/crypto/hash.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';
import { Blockchain } from '../src/core/blockchain.js';
import { computeStateRoot, stateLeaves } from '../src/core/stateroot.js';

const destino = process.argv[2];
if (!destino) {
  console.error('uso: node bin/eav7-gerar-cadeia-replay.js <dir-de-saida>');
  process.exit(1);
}
rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });

// Carteiras determinísticas? Não — as chaves são aleatórias por natureza. O que
// o teste compara é a RAIZ, e ela é função do conteúdo, não de chaves fixas.
const validador = generateKeyPair();
const alice = generateKeyPair();
const bob = generateKeyPair();
const addr = (w) => walletAddress(w);

// Os timestamps têm de ficar NO PASSADO: `produceBlock` valida o bloco contra o
// relógio real (drift/slot-futuro), então uma cadeia inteira gerada "para frente"
// seria rejeitada nos últimos blocos. Ancoramos a gênese alguns slots atrás e
// caminhamos até perto do agora — que é, aliás, o que a rede real faz.
const SLOT = CHAIN.BLOCK_TIME_MS;
const BLOCOS_PREVISTOS = 24;
const slotAgora = Math.floor(Date.now() / SLOT);
let slot = slotAgora - BLOCOS_PREVISTOS;

const chain = new Blockchain({ dataDir: destino });
chain.createGenesis({ address: addr(validador), timestamp: slot * SLOT });
slot += 1;
const raizes = [];
const anota = () => {
  const h = chain.height;
  raizes.push({
    height: h,
    hash: chain.head.hash,
    stateRoot: computeStateRoot(chain.state),
    // As FOLHAS, não só a raiz: quando o replay diverge, a raiz diz "algo mudou"
    // e as folhas dizem O QUÊ. É a diferença entre um teste que acusa e um que
    // localiza — e o custo é alguns KB no fixture.
    leaves: stateLeaves(chain.state).slice().sort(),
  });
};
anota();

// Nonce por conta, do jeito que o remetente faria.
const nonces = new Map();
const proximoNonce = (w) => {
  const a = addr(w);
  const n = (nonces.get(a) ?? (chain.state.accounts[a]?.nonce ?? 0)) + 1;
  nonces.set(a, n);
  return n;
};

// Produz um bloco no próximo slot, com a carteira DONA daquele slot. Depois que
// alguém stakeia o mínimo, o rodízio DPoS passa a alternar entre validadores —
// respeitar isso é o que a rede faz, e exercita o `expectedProducer` de verdade
// em vez de fingir que existe um produtor só.
const carteiras = new Map([validador, alice, bob].map((w) => [addr(w), w]));
const bloco = (txs = []) => {
  // Avança até um slot cujo dono seja uma das nossas carteiras (com todas elas
  // no conjunto isso é o primeiro slot, mas a guarda evita laço infinito).
  for (let tentativa = 0; tentativa < 64; tentativa += 1) {
    const ts = slot * SLOT;
    slot += 1;
    const dono = chain.expectedProducer(ts);
    const w = carteiras.get(dono);
    if (!w) continue;
    const b = chain.produceBlock(w, txs, { timestamp: ts });
    anota();
    return b;
  }
  throw new Error('nenhum slot pertence às carteiras conhecidas');
};

// 1) blocos vazios — o caminho mais comum da rede
for (let i = 0; i < 3; i++) bloco();

// 2) TRANSFER do validador (que tem o supply) para alice e bob
bloco([
  buildTransaction(validador, { type: 'TRANSFER', to: addr(alice), amount: 5_000n * CHAIN.UNIT, nonce: proximoNonce(validador), timestamp: slot * SLOT }),
]);
bloco([
  buildTransaction(validador, { type: 'TRANSFER', to: addr(bob), amount: 3_000n * CHAIN.UNIT, nonce: proximoNonce(validador), timestamp: slot * SLOT }),
]);

// 3) STAKE — muda o conjunto de validadores em potencial e a folha acct
bloco([
  buildTransaction(alice, { type: 'STAKE', amount: 1_000n * CHAIN.UNIT, nonce: proximoNonce(alice), timestamp: slot * SLOT }),
]);

// 4) duas txs no MESMO bloco (ordem importa para o estado)
bloco([
  buildTransaction(alice, { type: 'TRANSFER', to: addr(bob), amount: 10n * CHAIN.UNIT, nonce: proximoNonce(alice), timestamp: slot * SLOT }),
  buildTransaction(bob, { type: 'TRANSFER', to: addr(alice), amount: 4n * CHAIN.UNIT, nonce: proximoNonce(bob), timestamp: slot * SLOT }),
]);

// 5) token EAV20: cria e transfere — exercita a folha `tok`
const tokenTx = buildTransaction(alice, {
  type: 'TOKEN_CREATE', nonce: proximoNonce(alice), timestamp: slot * SLOT,
  data: { name: 'Teste', symbol: 'TST', decimals: 6, totalSupply: (1_000_000n * CHAIN.UNIT).toString() },
});
bloco([tokenTx]);
// O id do token é derivado do id da tx (state.js:1681), não é o id da tx.
const tokenId = eavHash('EAV20-TOKEN:' + tokenTx.id);
bloco([
  buildTransaction(alice, {
    // O valor vai no `amount` da PRÓPRIA tx (state.js:1708), não em `data`.
    type: 'TOKEN_TRANSFER', to: addr(bob), amount: 250n * CHAIN.UNIT,
    nonce: proximoNonce(alice), timestamp: slot * SLOT,
    data: { token: tokenId },
  }),
]);

// 6) VOTE — folhas vote/cvotes. O poder de voto é limitado pelo STAKE, então
// bob precisa stakear antes (state.js:426).
//
// Só entra ACIMA do fork de votação. Com as alturas reais (VOTING_HEIGHT = 1.4M)
// uma cadeia curta não o alcança, e insistir produziria um gerador que só roda em
// gênese-ativo — o que deixaria o replay INERTE no build padrão, que é
// exatamente o problema que este gerador existe para não ter.
const pulados = [];
if (CHAIN.VOTING_HEIGHT === 0) {
  bloco([
    buildTransaction(bob, { type: 'STAKE', amount: 500n * CHAIN.UNIT, nonce: proximoNonce(bob), timestamp: slot * SLOT }),
  ]);
  bloco([
    buildTransaction(bob, {
      type: 'VOTE', nonce: proximoNonce(bob), timestamp: slot * SLOT,
      data: { votes: { [addr(alice)]: (100n * CHAIN.UNIT).toString() } },
    }),
  ]);
} else {
  pulados.push(`VOTE (exige altura >= ${CHAIN.VOTING_HEIGHT})`);
}

// 7) mais blocos vazios no fim (o caso do rabo)
for (let i = 0; i < 3; i++) bloco();

writeFileSync(join(destino, 'raizes-esperadas.json'), JSON.stringify({
  descricao: 'Raízes de estado por altura, produzidas pelo nó de REFERÊNCIA (JS). O cliente Rust tem de reproduzi-las carregando o mesmo blocks.jsonl.',
  genesisAtivo: process.env.EAV7_GENESIS_ACTIVE === '1',
  // O que o modo de fork desta cadeia NÃO exercita — para o relatório do teste
  // não dar a impressão de cobertura que não existe.
  pulados,
  alturaFinal: chain.height,
  raizes,
}, null, 2) + '\n');

console.log(`cadeia gerada em ${destino}`);
if (pulados.length) {
  console.log(`  PULADOS (fork acima da cadeia): ${pulados.join(', ')}`);
  console.log('  Para exercitá-los, gere com EAV7_GENESIS_ACTIVE=1 (forks em 0).');
}
console.log(`  altura final : ${chain.height}`);
console.log(`  blocos       : ${raizes.length}`);
console.log(`  raiz final   : ${raizes[raizes.length - 1].stateRoot}`);
