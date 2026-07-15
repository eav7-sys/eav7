#!/usr/bin/env node
// Serviço de faucet de TESTNET. Dispensa EAV7 de teste de uma carteira-faucet, com
// cooldown por endereço. Exige EAV7_FAUCET_ENABLED=1 (trava contra rodar em mainnet).
//
// Env: EAV7_FAUCET_ENABLED=1  EAV7_NODE_URL=http://127.0.0.1:6070
//      EAV7_FAUCET_KEY=/caminho/faucet-wallet.json  EAV7_FAUCET_AMOUNT=100 (EAV7)
//      PORT=6090
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { CHAIN } from '../src/config.js';
import { Eav7Client } from '../src/sdk/eav7.js';
import { FaucetService } from '../src/sdk/faucet.js';
import { isValidAddress } from '../src/crypto/keys.js';

if (process.env.EAV7_FAUCET_ENABLED !== '1') {
  console.error('recuse: EAV7_FAUCET_ENABLED != 1 (faucet é só de testnet; não rode em mainnet)');
  process.exit(1);
}
const url = process.env.EAV7_NODE_URL || 'http://127.0.0.1:6070';
const keyFile = process.env.EAV7_FAUCET_KEY;
if (!keyFile) { console.error('defina EAV7_FAUCET_KEY (json da carteira-faucet)'); process.exit(1); }
const wallet = JSON.parse(readFileSync(keyFile, 'utf8'));
const amount = BigInt(process.env.EAV7_FAUCET_AMOUNT || '100') * CHAIN.UNIT;
const port = Number(process.env.PORT || 6090);

const client = new Eav7Client({ url, wallet });
const faucet = new FaucetService({ client, amount });
setInterval(() => faucet.prune(), 10 * 60 * 1000).unref();

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    return send(res, 200, { faucet: 'EAV7 testnet', node: url, amount: amount.toString(), from: client.address });
  }
  if (req.method === 'POST' && req.url === '/faucet') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
    req.on('end', async () => {
      try {
        const { address } = JSON.parse(raw || '{}');
        if (!isValidAddress(address)) return send(res, 400, { error: 'endereço EAV7 (E7…) inválido' });
        const r = await faucet.dispense(address);
        send(res, 200, { ok: true, amount: amount.toString(), id: r.id });
      } catch (err) {
        send(res, 429, { error: String(err.message || err) });
      }
    });
    return;
  }
  send(res, 404, { error: 'rota inexistente' });
}).listen(port, () => console.log(`[faucet] ouvindo em :${port} — dispensa ${amount} de ${client.address}`));
