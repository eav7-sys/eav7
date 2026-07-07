import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addNetwork, readAccount, type EavmCfg } from '../lib/wallet-ext';
import { api } from '../lib/api';
import { Card, CardTitle, Mono } from './ui';

function ManualHint({ cfg }: { cfg: EavmCfg }) {
  const rpc = cfg.rpcUrl ?? `${location.protocol}//${location.hostname}:${cfg.rpcPort ?? 7075}`;
  return (
    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-tile border border-line bg-[var(--field-bg)] p-3.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--violet)' }}>
{`Nome da rede  : EAV7
URL do RPC    : ${rpc}
Chain ID      : ${Number(cfg.chainId ?? 72020)}
Símbolo       : EAV7
Casas decimais: 18`}
    </pre>
  );
}

export function AddNetworkCard({ cfg }: { cfg: EavmCfg | undefined }) {
  const [msg, setMsg] = useState<React.ReactNode>(null);
  const c = cfg ?? {};
  const run = async (prefer: 'metamask' | 'trust') => {
    const r = await addNetwork(c, prefer);
    if (r.code === 'added') setMsg(<span className="text-ok">rede EAV7 adicionada! ✅</span>);
    else if (r.code === 'nowallet') setMsg(<div><span className="text-muted">Nenhuma carteira detectada. Abra dentro da carteira:</span>
      <div className="mt-2 flex gap-2"><a className="btn flex-1" href={`https://metamask.app.link/dapp/${location.host}${location.pathname}`}>MetaMask</a><a className="btn ghost flex-1" href={`https://link.trustwallet.com/open_url?url=${encodeURIComponent(location.href)}`}>Trust</a></div><ManualHint cfg={c} /></div>);
    else if (r.code === 'unsupported') setMsg(<div><span className="text-muted">Sua carteira não adiciona por 1 clique. Adicione manualmente:</span><ManualHint cfg={c} /></div>);
    else if (r.code === 'cancelled') setMsg(<span className="text-muted">adição cancelada.</span>);
    else setMsg(<span className="text-muted">não adicionado: {r.message}</span>);
  };
  return (
    <Card>
      <CardTitle>MetaMask / Trust Wallet · EAVM</CardTitle>
      <p className="text-muted">Adicione a EAV7 com 1 clique (a carteira pede confirmação):</p>
      <div className="mt-3 flex gap-2">
        <button className="flex-1" onClick={() => run('metamask')}>Adicionar à MetaMask</button>
        <button className="ghost flex-1" onClick={() => run('trust')}>Adicionar à Trust</button>
      </div>
      {msg && <div className="mt-3 break-all text-[12.5px]">{msg}</div>}
      <p className="mt-3 text-[12px] text-muted">Chain ID 72020 · símbolo EAV7 · 18 casas. Ou use a <Link to="/wallet" className="text-link">carteira web</Link>.</p>
    </Card>
  );
}

export function ConverterCard() {
  const [val, setVal] = useState('');
  const [out, setOut] = useState<React.ReactNode>(null);
  const convert = async (addr: string) => {
    addr = addr.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setOut(<span className="text-muted">endereço 0x inválido</span>); return; }
    try {
      const r = await api.eavmToE7(addr);
      setOut(<div className="space-y-1"><div>MetaMask (0x): <Mono>{r.eavm}</Mono></div><div>EAV7 (E7): <b><Mono className="!text-[12.5px] text-ok">{r.eav7}</Mono></b></div>
        <div className="text-muted">Mesma conta. <Link className="text-link" to={`/address/${r.eavm}`}>ver no explorer</Link></div></div>);
    } catch (e) { setOut(<span className="text-muted">erro: {String(e)}</span>); }
  };
  const readMine = async () => { const a = await readAccount(); if (a) convert(a); else setOut(<span className="text-muted">nenhuma carteira detectada — cole o 0x</span>); };
  return (
    <Card>
      <CardTitle>Endereço EAV7 (E7) ↔ MetaMask (0x)</CardTitle>
      <p className="text-muted">A MetaMask mostra o <Mono>0x</Mono>; on-chain o saldo vive no <Mono>E7</Mono> — mesma conta.</p>
      <div className="mt-3"><button className="w-full" onClick={readMine}>Ler da minha carteira</button></div>
      <div className="mt-2 flex gap-2">
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="ou cole um 0x…" className="mono min-w-0 flex-1 rounded-xl border border-line bg-[var(--field-bg)] px-3.5 py-3 text-[12.5px] text-ink outline-none focus:border-[rgba(145,101,245,.75)] focus:shadow-[var(--ring)]" />
        <button className="ghost" onClick={() => convert(val)}>Converter</button>
      </div>
      {out && <div className="mt-3 break-all text-[12.5px]">{out}</div>}
    </Card>
  );
}
