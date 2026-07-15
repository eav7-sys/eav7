#!/usr/bin/env node
// Gera a GÊNESE nova da rede EAV7 (relaunch ou testnet), com TODAS as features ativas do
// bloco 0. Cria as carteiras dos validadores + a tesouraria, monta o bloco gênese e
// imprime o hash a fixar (expectedGenesisHash) nos nós.
//
// Uso:  EAV7_GENESIS_ACTIVE=1 node bin/eav7-genesis.js <dir-saida> [nValidadores]
//
// IMPORTANTE: rode com EAV7_GENESIS_ACTIVE=1 — o hash da gênese depende disso (com o flag,
// a altura 0 usa hash payload-only). Os nós que adotarem esta gênese também precisam do flag.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAIN } from '../src/config.js';
import { buildGenesisBlock } from '../src/core/block.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';

if (process.env.EAV7_GENESIS_ACTIVE !== '1') {
  console.error('rode com EAV7_GENESIS_ACTIVE=1 (senão a gênese usa as alturas de fork antigas)');
  process.exit(1);
}
const outDir = process.argv[2];
if (!outDir) { console.error('uso: EAV7_GENESIS_ACTIVE=1 node bin/eav7-genesis.js <dir-saida> [nValidadores]'); process.exit(1); }
const nVal = Math.max(1, Number(process.argv[3] || 3));
mkdirSync(outDir, { recursive: true });

// Tesouraria: recebe o supply menos o stake dos validadores. Guarde esta carteira!
const treasury = generateKeyPair();
const treAddr = walletAddress(treasury);
const validators = Array.from({ length: nVal }, () => generateKeyPair());

const stakes = {}, balances = {};
let totalStake = 0n;
for (const w of validators) { const a = walletAddress(w); stakes[a] = CHAIN.GENESIS_STAKE.toString(); totalStake += CHAIN.GENESIS_STAKE; }
balances[treAddr] = (CHAIN.GENESIS_SUPPLY - totalStake).toString();

const genesis = buildGenesisBlock({
  timestamp: Number(process.env.EAV7_GENESIS_TIME || Date.now()),
  balances,
  stakes,
  bridgeRelayers: [treAddr], // relayer inicial; migre para uma allowlist por governança
  bridgeSourceCommittees: {}, // registre comitês de origem (ex.: TRON) por governança
});

writeFileSync(join(outDir, 'genesis.json'), JSON.stringify(genesis, null, 2));
writeFileSync(join(outDir, 'treasury-wallet.json'), JSON.stringify(treasury, null, 2));
validators.forEach((w, i) => writeFileSync(join(outDir, `validator-${i}-wallet.json`), JSON.stringify(w, null, 2)));

console.log('== GÊNESE EAV7 (gênese-ativo) ==');
console.log('dir:', outDir);
console.log('validadores:', nVal, '| stake cada:', CHAIN.GENESIS_STAKE.toString());
console.log('tesouraria:', treAddr);
console.log('hash da gênese (FIXAR como expectedGenesisHash nos nós):');
console.log('  ' + genesis.hash);
console.log('\nnos 3 nós: EAV7_GENESIS_ACTIVE=1 e adote esta genesis.json (--genesis) com o hash fixado.');
