#!/usr/bin/env node
// CLI da blockchain EAV7 (protocolo eav20).
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CHAIN, toJson, formatEav7, eav7ToE7 } from '../src/config.js';
import { generateKeyPair, walletAddress, isValidAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';
import { Eav7Node } from '../src/node/node.js';
import { AiOracleWorker } from '../src/ai/worker.js';
import { SecuritySentinel } from '../src/ai/sentinel.js';

const DEFAULT_NODE = process.env.EAV7_NODE ?? 'http://127.0.0.1:6070';

const HELP = `
EAV7 — blockchain com protocolo eav20 (hashes e carteiras E7, camada nativa de IA)

Uso: eav7 <comando> [opções]

Carteira
  wallet new [--out arquivo]            cria carteira E7 (secp256k1)
  wallet show <arquivo>                 mostra endereço e chave pública

Nó / mineração
  node start [--port 6070] [--host 0.0.0.0] [--data dir] [--validator carteira.json]
             [--peers url,url] [--url urlPublica] [--observer]
             [--allow-private-peers] [--genesis-hash E7...] [--eavm-port 7070] [--no-eavm]
  mine       atalho de "node start" (cria/reusa carteira de minerador automaticamente)
  status [--node url]                   status da rede
  Plataforma de mineração: http://127.0.0.1:<porta>/app
  RPC EAVM (MetaMask/Trust Wallet): http://127.0.0.1:<porta+1000> (Chain ID 72020)

Protocolo EAVM (MetaMask / Trust Wallet)
  eavm address <0x...>                  endereço E7 correspondente a uma conta EAVM

Moeda nativa
  balance <endereço> [--node url]
  send   --wallet w.json --to E7... --amount 12.5
  stake  --wallet w.json --amount 1000        (>= 100 zera taxas; >= 1000 vira minerador)
  unstake --wallet w.json --amount 500

Tokens EAV20
  token create --wallet w.json --name "Meu Token" --symbol MTK --supply 1000000 [--decimals 6]
  token send   --wallet w.json --token E7... --to E7... --amount 10
  token list | token info <id>

Inteligência artificial
  ai task    --wallet w.json --prompt "..." --oracle E7... [--model claude-sonnet-5] [--reward 1]
  ai tasks   [--status PENDING|DONE]
  ai worker  --wallet w.json [--interval 2000]   (oráculo de IA; usa ANTHROPIC_API_KEY se definida)
  ai sentinel [--node url]                        (vigilância de segurança 24h por IA)

Ponte cross-chain
  bridge out --wallet w.json --chain TRON --address T... --amount 10 [--token E7...]
  bridge transfers

Opção global: --node url (padrão ${DEFAULT_NODE} ou env EAV7_NODE)
`;

const { values: opts, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    node: { type: 'string' },
    wallet: { type: 'string' },
    to: { type: 'string' },
    amount: { type: 'string' },
    port: { type: 'string' },
    data: { type: 'string' },
    validator: { type: 'string' },
    peers: { type: 'string' },
    url: { type: 'string' },
    observer: { type: 'boolean' },
    'eavm-port': { type: 'string' },
    'no-eavm': { type: 'boolean' },
    'genesis-hash': { type: 'string' },
    genesis: { type: 'string' },
    'public-rpc': { type: 'string' },
    'digest-minutes': { type: 'string' },
    name: { type: 'string' },
    symbol: { type: 'string' },
    supply: { type: 'string' },
    decimals: { type: 'string' },
    token: { type: 'string' },
    prompt: { type: 'string' },
    oracle: { type: 'string' },
    model: { type: 'string' },
    reward: { type: 'string' },
    host: { type: 'string' },
    'allow-private-peers': { type: 'boolean' },
    interval: { type: 'string' },
    status: { type: 'string' },
    chain: { type: 'string' },
    address: { type: 'string' },
    help: { type: 'boolean' },
  },
});

const nodeUrl = (opts.node ?? DEFAULT_NODE).replace(/\/$/, '');

// ---------------------------------------------------------------- utilidades
function fail(message) {
  console.error(`erro: ${message}`);
  process.exit(1);
}

function require_(value, flag) {
  if (value === undefined || value === '') fail(`opção obrigatória: ${flag}`);
  return value;
}

function loadWallet(file) {
  if (!existsSync(file)) fail(`carteira não encontrada: ${file}`);
  const wallet = JSON.parse(readFileSync(file, 'utf8'));
  if (!wallet.privateKeyPem || !wallet.publicKeyPem || !wallet.pqPrivateKeyPem || !wallet.pqPublicKeyPem) {
    fail(`arquivo de carteira inválido ou sem chaves pós-quânticas (eav7-hybrid-1): ${file}`);
  }
  return wallet;
}

function saveWallet(keys, file) {
  const wallet = {
    chain: CHAIN.NAME,
    protocol: CHAIN.PROTOCOL,
    address: walletAddress(keys),
    ...keys,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(wallet, null, 2), { mode: 0o600 });
  return wallet;
}

async function getJson(path) {
  const response = await fetch(nodeUrl + path, { signal: AbortSignal.timeout(10_000) })
    .catch(() => fail(`não consegui falar com o nó em ${nodeUrl} — ele está rodando? (eav7 mine)`));
  const body = await response.json();
  if (!response.ok) fail(body.error ?? `nó respondeu ${response.status}`);
  return body;
}

async function postJson(path, payload) {
  const response = await fetch(nodeUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: toJson(payload),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => fail(`não consegui falar com o nó em ${nodeUrl} — ele está rodando? (eav7 mine)`));
  const body = await response.json();
  if (!response.ok) fail(body.error ?? `nó respondeu ${response.status}`);
  return body;
}

// Próximo nonce considerando também as transações do remetente ainda no mempool.
async function nextNonce(address) {
  const [account, mempool] = await Promise.all([getJson(`/address/${address}`), getJson('/mempool')]);
  let nonce = account.nonce;
  for (const tx of mempool) if (tx.from === address && tx.nonce > nonce) nonce = tx.nonce;
  return { nonce: nonce + 1, feeExempt: account.feeExempt };
}

async function signAndSend(wallet, { type, to = null, amount = 0, data = {} }) {
  const address = walletAddress(wallet);
  const { nonce, feeExempt } = await nextNonce(address);
  const tx = buildTransaction(wallet, {
    type,
    to,
    amount,
    nonce,
    data,
    fee: feeExempt ? 0n : undefined,
  });
  const result = await postJson('/tx', tx);
  console.log(toJson({ ...result, type, fee: `${formatEav7(BigInt(tx.fee))} ${CHAIN.SYMBOL}${feeExempt ? ' (isento por stake)' : ''}` }, 2));
  return tx;
}

function parseUnits(text, decimals, field = 'valor') {
  const match = String(text).trim().match(new RegExp(`^(\\d+)(?:[.,](\\d{1,${Math.max(decimals, 1)}}))?$`));
  if (!match || (match[2] && decimals === 0)) fail(`${field} inválido: ${text}`);
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((match[2] ?? '0').padEnd(decimals || 1, '0')) * (decimals === 0 ? 0n : 1n);
}

// ---------------------------------------------------------------- comandos
const [cmd, sub, ...rest] = positionals;

if (opts.help || !cmd) {
  console.log(HELP);
  process.exit(0);
}

if (cmd === 'wallet' && sub === 'new') {
  const keys = generateKeyPair();
  const address = walletAddress(keys);
  const file = opts.out ?? `wallet-${address.slice(0, 12)}.json`;
  saveWallet(keys, file);
  console.log(`endereço  : ${address}`);
  console.log(`segurança : eav7-hybrid-1 (secp256k1 + ML-DSA-44 pós-quântico)`);
  console.log(`arquivo   : ${file} (permissão 600 — guarde com segurança)`);
} else if (cmd === 'wallet' && sub === 'show') {
  const wallet = loadWallet(require_(rest[0] ?? opts.wallet, 'arquivo da carteira'));
  console.log(`endereço  : ${walletAddress(wallet)}`);
  console.log(`segurança : ${wallet.scheme ?? 'eav7-hybrid-1'} (secp256k1 + ML-DSA-44)`);
  console.log(`chave pública (ECDSA) :\n${wallet.publicKeyPem}`);
} else if ((cmd === 'node' && sub === 'start') || cmd === 'mine') {
  const port = Number(opts.port ?? 6070);
  const dataDir = opts.data ?? join('data', `node-${port}`);
  mkdirSync(dataDir, { recursive: true });

  let validatorWallet = null;
  if (!opts.observer) {
    const walletFile = opts.validator ?? join(dataDir, 'validator-wallet.json');
    if (existsSync(walletFile)) {
      validatorWallet = loadWallet(walletFile);
    } else if (opts.validator) {
      fail(`carteira de validador não encontrada: ${walletFile}`);
    } else {
      validatorWallet = saveWallet(generateKeyPair(), walletFile);
      console.log(`[nó] carteira de minerador criada em ${walletFile}`);
    }
  }

  const node = new Eav7Node({
    port,
    host: opts.host ?? '0.0.0.0',
    dataDir,
    validatorWallet,
    peers: (opts.peers ?? '').split(',').filter(Boolean),
    selfUrl: opts.url ?? null,
    allowPrivatePeers: Boolean(opts['allow-private-peers']),
    expectedGenesisHash: opts['genesis-hash'] ?? process.env.EAV7_GENESIS_HASH ?? null,
    genesisFile: opts.genesis ?? process.env.EAV7_GENESIS_FILE ?? null,
    publicRpcUrl: opts['public-rpc'] ?? process.env.EAV7_PUBLIC_RPC_URL ?? null,
    eavm: !opts['no-eavm'],
    eavmPort: opts['eavm-port'] ? Number(opts['eavm-port']) : null,
  });
  await node.start();
  process.on('SIGINT', () => {
    node.stop();
    process.exit(0);
  });
} else if (cmd === 'status') {
  console.log(toJson(await getJson('/status'), 2));
} else if (cmd === 'balance') {
  const address = require_(sub, 'endereço');
  if (!isValidAddress(address)) fail('endereço EAV7 inválido');
  console.log(toJson(await getJson(`/address/${address}`), 2));
} else if (cmd === 'send') {
  const wallet = loadWallet(require_(opts.wallet, '--wallet'));
  await signAndSend(wallet, {
    type: 'TRANSFER',
    to: require_(opts.to, '--to'),
    amount: eav7ToE7(require_(opts.amount, '--amount')),
  });
} else if (cmd === 'stake' || cmd === 'unstake') {
  const wallet = loadWallet(require_(opts.wallet, '--wallet'));
  await signAndSend(wallet, {
    type: cmd.toUpperCase(),
    amount: eav7ToE7(require_(opts.amount, '--amount')),
  });
} else if (cmd === 'token' && sub === 'create') {
  const wallet = loadWallet(require_(opts.wallet, '--wallet'));
  const decimals = Number(opts.decimals ?? 6);
  const supply = parseUnits(require_(opts.supply, '--supply'), decimals, 'supply');
  await signAndSend(wallet, {
    type: 'TOKEN_CREATE',
    data: {
      name: require_(opts.name, '--name'),
      symbol: require_(opts.symbol, '--symbol').toUpperCase(),
      decimals,
      totalSupply: supply.toString(),
    },
  });
  console.log('token criado — veja o id em: eav7 token list');
} else if (cmd === 'token' && sub === 'send') {
  const wallet = loadWallet(require_(opts.wallet, '--wallet'));
  const tokenId = require_(opts.token, '--token');
  const token = await getJson(`/tokens/${tokenId}`);
  await signAndSend(wallet, {
    type: 'TOKEN_TRANSFER',
    to: require_(opts.to, '--to'),
    amount: parseUnits(require_(opts.amount, '--amount'), token.decimals),
    data: { token: tokenId },
  });
} else if (cmd === 'token' && sub === 'list') {
  console.log(toJson(await getJson('/tokens'), 2));
} else if (cmd === 'token' && sub === 'info') {
  console.log(toJson(await getJson(`/tokens/${require_(rest[0], 'id do token')}`), 2));
} else if (cmd === 'ai' && sub === 'task') {
  const wallet = loadWallet(require_(opts.wallet, '--wallet'));
  const oracle = require_(opts.oracle, '--oracle (endereço E7 do oráculo designado)');
  if (!isValidAddress(oracle)) fail('endereço de oráculo inválido');
  const tx = await signAndSend(wallet, {
    type: 'AI_TASK',
    amount: eav7ToE7(opts.reward ?? '1', '--reward'),
    data: { prompt: require_(opts.prompt, '--prompt'), oracle, model: opts.model ?? null, params: null },
  });
  console.log(`tarefa de IA: ${tx.id}\nacompanhe com: curl ${nodeUrl}/ai/tasks/${tx.id}`);
} else if (cmd === 'ai' && sub === 'tasks') {
  const query = opts.status ? `?status=${opts.status}` : '';
  console.log(toJson(await getJson(`/ai/tasks${query}`), 2));
} else if (cmd === 'ai' && sub === 'worker') {
  const wallet = loadWallet(require_(opts.wallet, '--wallet'));
  const worker = new AiOracleWorker({ nodeUrl, wallet, pollMs: Number(opts.interval ?? 2000) });
  await worker.start();
  process.on('SIGINT', () => {
    worker.stop();
    process.exit(0);
  });
} else if (cmd === 'ai' && sub === 'sentinel') {
  const digestMin = Number(opts['digest-minutes'] ?? 10);
  const sentinel = new SecuritySentinel({ nodeUrl, aiDigestMs: Math.max(1, digestMin) * 60_000 });
  await sentinel.start();
  process.on('SIGINT', () => {
    sentinel.stop();
    process.exit(0);
  });
} else if (cmd === 'bridge' && sub === 'out') {
  const wallet = loadWallet(require_(opts.wallet, '--wallet'));
  let amount;
  if (opts.token) {
    const token = await getJson(`/tokens/${opts.token}`);
    amount = parseUnits(require_(opts.amount, '--amount'), token.decimals);
  } else {
    amount = eav7ToE7(require_(opts.amount, '--amount'));
  }
  await signAndSend(wallet, {
    type: 'BRIDGE_OUT',
    amount,
    data: {
      targetChain: require_(opts.chain, '--chain').toUpperCase(),
      targetAddress: require_(opts.address, '--address'),
      token: opts.token ?? null,
    },
  });
} else if (cmd === 'bridge' && sub === 'transfers') {
  console.log(toJson(await getJson('/bridge/transfers'), 2));
} else if (cmd === 'eavm' && sub === 'address') {
  const { eavmToE7 } = await import('../src/eavm/envelope.js');
  const eavm = require_(rest[0], 'endereço 0x');
  console.log(`EAVM : ${eavm.toLowerCase()}`);
  console.log(`EAV7 : ${eavmToE7(eavm)}`);
} else {
  console.log(HELP);
  fail(`comando desconhecido: ${[cmd, sub].filter(Boolean).join(' ')}`);
}
