// SDK EAV7 (estilo TronWeb) — biblioteca cliente para dApps/serviços construírem,
// assinarem e submeterem transações e consultarem o estado da rede. Embrulha a
// cripto híbrida (secp256k1 + ML-DSA) e a API HTTP do nó numa interface única.
//
//   import { Eav7Client, generateKeyPair } from 'eav7/sdk';
//   const client = new Eav7Client({ url: 'https://eavscan.com', wallet });
//   await client.transfer(destino, 5n * client.UNIT);
//
// Os métodos build* montam e ASSINAM a tx localmente (sem rede) e podem ser testados
// isoladamente; os métodos de ação fazem build + submit (buscam o nonce ciente do mempool).
import { CHAIN } from '../config.js';
import { generateKeyPair, walletAddress } from '../crypto/keys.js';
import { buildTransaction, verifyTransaction } from '../core/transaction.js';
import { verifyAccountProof, decodeProofBig } from '../core/stateroot.js';

export { generateKeyPair, walletAddress, verifyAccountProof, decodeProofBig };

export class Eav7Client {
  constructor({ url, wallet = null, fetchImpl = fetch } = {}) {
    if (!url) throw new Error('url do nó é obrigatória');
    this.url = url.replace(/\/+$/, '');
    this.wallet = wallet;
    this.address = wallet ? walletAddress(wallet) : null;
    this.UNIT = CHAIN.UNIT;
    this.SYMBOL = CHAIN.SYMBOL;
    this.fetch = fetchImpl;
  }

  // ---- leitura ----
  async #get(path) {
    const r = await this.fetch(this.url + path, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`${path} respondeu ${r.status}`);
    return r.json();
  }
  status() { return this.#get('/status'); }
  account(address) { return this.#get('/address/' + encodeURIComponent(address)); }
  transaction(id) { return this.#get('/tx/' + encodeURIComponent(id)); }
  validators() { return this.#get('/validators'); }
  contract(address) { return this.#get('/contract/' + encodeURIComponent(address)); } // metadados de verificação (#8)
  proof(address) { return this.#get('/proof/' + encodeURIComponent(address)); } // prova de estado p/ light client

  // Busca a prova, VERIFICA contra a raiz de estado do header e devolve o saldo provado.
  // `trustedRoot` opcional: se passado, exige que a raiz da prova bata (o cliente já a tem
  // de um header confiável); senão confia na raiz devolvida pelo nó (verificação de forma).
  async provenBalance(address, trustedRoot = null) {
    const p = await this.proof(address);
    if (trustedRoot && p.stateRoot !== trustedRoot) throw new Error('stateRoot da prova diverge do header confiável');
    if (!verifyAccountProof(p.stateRoot, p.address, p.encodedAccount, p.path)) throw new Error('prova de estado inválida');
    return decodeProofBig(p.encodedAccount.balance);
  }
  async balance(address = this.address) { return BigInt((await this.account(address)).balance); }
  async nextNonce(address = this.address) { return (await this.account(address)).nextNonce; }

  // ---- escrita ----
  async submit(tx) {
    const r = await this.fetch(this.url + '/tx', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(tx),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `submit respondeu ${r.status}`);
    return body;
  }

  // Monta+assina qualquer tx com o nonce dado (sem rede). `verify` opcional confere a
  // assinatura localmente antes de devolver (default true) — falha cedo em erro de uso.
  build(fields, { verify = true } = {}) {
    if (!this.wallet) throw new Error('client sem wallet: não pode assinar');
    const tx = buildTransaction(this.wallet, fields);
    if (verify) {
      const err = verifyTransaction(tx);
      if (err) throw new Error(`tx inválida: ${err}`);
    }
    return tx;
  }
  buildTransfer(to, amount, nonce, opts) { return this.build({ type: 'TRANSFER', to, amount, nonce }, opts); }
  buildStake(amount, nonce, opts) { return this.build({ type: 'STAKE', amount, nonce }, opts); }
  buildUnstake(amount, nonce, opts) { return this.build({ type: 'UNSTAKE', amount, nonce }, opts); }
  buildVote(votes, nonce, opts) { return this.build({ type: 'VOTE', nonce, data: { votes } }, opts); }
  buildDelegate(to, amount, nonce, opts) { return this.build({ type: 'DELEGATE_RESOURCE', nonce, data: { to, amount: String(amount) } }, opts); }

  // Ações de alto nível: buscam o nonce (ciente do mempool) e fazem build + submit.
  async #act(fields) { return this.submit(this.build({ ...fields, nonce: await this.nextNonce() })); }
  transfer(to, amount) { return this.#act({ type: 'TRANSFER', to, amount }); }
  stake(amount) { return this.#act({ type: 'STAKE', amount }); }
  unstake(amount) { return this.#act({ type: 'UNSTAKE', amount }); }
  vote(votes) { return this.#act({ type: 'VOTE', data: { votes } }); }
  delegate(to, amount) { return this.#act({ type: 'DELEGATE_RESOURCE', data: { to, amount: String(amount) } }); }
  undelegate(to, amount) { return this.#act({ type: 'UNDELEGATE_RESOURCE', data: { to, amount: String(amount) } }); }

  // Submete source + bytecode para verificar um contrato EAVM no explorer (#8).
  async verifyContract(address, { source, language = 'solidity', compiler = '', bytecode }) {
    const r = await this.fetch(this.url + '/contract/' + encodeURIComponent(address) + '/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ source, language, compiler, bytecode }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `verify respondeu ${r.status}`);
    return body;
  }
}
