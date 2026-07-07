import { useEffect, useState } from 'react';
import { createAccount, accountFromPrivate, buildSignedTx, encryptKey, decryptKey, EAVM_STAKE_ADDRESS, EAVM_UNSTAKE_ADDRESS, type Account } from '../lib/eav7-wallet.js';
import { api } from '../lib/api';
import { useSettings } from '../lib/settings';
import { fmt, is0x, isE7 } from '../lib/format';
import { Card, CardTitle, Tile, Mono } from '../components/ui';
import { AddNetworkCard } from '../components/WalletTools';

const STORE = 'eav7-wallet-blob';
const eav7ToWei = (v: string) => BigInt(Math.round(parseFloat(v || '0') * 1e6)) * 10n ** 12n; // 6→18 casas

export function Wallet() {
  const { t } = useSettings();
  const [acct, setAcct] = useState<Account | null>(null);
  const [hasBlob, setHasBlob] = useState(() => !!localStorage.getItem(STORE));

  if (acct) return <Dashboard acct={acct} onLock={() => setAcct(null)} />;
  return <Gate hasBlob={hasBlob} onUnlock={setAcct} onReset={() => { localStorage.removeItem(STORE); setHasBlob(false); }} />;
}

function Gate({ hasBlob, onUnlock, onReset }: { hasBlob: boolean; onUnlock: (a: Account) => void; onReset: () => void }) {
  const [mode, setMode] = useState<'unlock' | 'create' | 'import'>(hasBlob ? 'unlock' : 'create');
  const [pw, setPw] = useState('');
  const [pk, setPk] = useState('');
  const [err, setErr] = useState('');
  const [newKey, setNewKey] = useState<Account | null>(null);

  const unlock = async () => {
    try { const hex = await decryptKey(localStorage.getItem(STORE)!, pw); onUnlock(accountFromPrivate(hex)); }
    catch { setErr('senha incorreta'); }
  };
  const doImport = async () => {
    try {
      const a = accountFromPrivate(pk.trim());
      if (pw) localStorage.setItem(STORE, await encryptKey(a.privateKey, pw));
      onUnlock(a);
    } catch { setErr('chave privada inválida (0x + 64 hex)'); }
  };
  const doCreate = () => setNewKey(createAccount());
  const saveNew = async () => {
    if (!newKey) return;
    if (pw) localStorage.setItem(STORE, await encryptKey(newKey.privateKey, pw));
    onUnlock(newKey);
  };

  return (
    <div className="fade-in mx-auto max-w-[600px]">
      <h1 className="mb-1 text-2xl font-extrabold tracking-tight">Carteira EAV7</h1>
      <p className="mb-5 text-[13px] text-muted">Self-custodial — a chave é gerada e cifrada só no seu navegador.</p>

      <div className="mb-4 flex gap-1.5 rounded-[13px] border border-line bg-surface p-1">
        {hasBlob && <Tab on={mode === 'unlock'} onClick={() => setMode('unlock')}>Desbloquear</Tab>}
        <Tab on={mode === 'create'} onClick={() => { setMode('create'); setNewKey(null); }}>Criar</Tab>
        <Tab on={mode === 'import'} onClick={() => setMode('import')}>Importar</Tab>
      </div>

      <Card>
        {mode === 'unlock' && <>
          <label>Senha</label>
          <input type="password" className="fld" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} />
          <div className="mt-3 flex gap-2"><button className="flex-1" onClick={unlock}>Desbloquear</button><button className="ghost" onClick={onReset}>Esquecer carteira</button></div>
        </>}
        {mode === 'create' && !newKey && <>
          <p className="text-muted">Gera uma nova conta EAV7 (0x + E7). A chave privada aparece uma vez — guarde com segurança.</p>
          <div className="mt-3"><button className="w-full" onClick={doCreate}>Gerar nova carteira</button></div>
        </>}
        {mode === 'create' && newKey && <>
          <div className="rounded-tile border border-[rgba(247,205,99,.4)] bg-[rgba(247,205,99,.08)] p-3 text-[12.5px]">⚠ Anote a chave privada. Sem ela (e sem senha), você perde o acesso.</div>
          <label>Chave privada</label><div className="mono break-all rounded-tile border border-line bg-[var(--field-bg)] p-3 text-[11.5px]">{newKey.privateKey}</div>
          <label>Endereço 0x</label><Mono>{newKey.evm}</Mono>
          <label>Senha para cifrar no navegador (opcional)</label>
          <input type="password" className="fld" value={pw} onChange={(e) => setPw(e.target.value)} />
          <div className="mt-3"><button className="w-full" onClick={saveNew}>Continuar</button></div>
        </>}
        {mode === 'import' && <>
          <label>Chave privada (0x + 64 hex)</label>
          <input className="fld" value={pk} onChange={(e) => setPk(e.target.value)} placeholder="0x…" />
          <label>Senha para cifrar (opcional)</label>
          <input type="password" className="fld" value={pw} onChange={(e) => setPw(e.target.value)} />
          <div className="mt-3"><button className="w-full" onClick={doImport}>Importar</button></div>
        </>}
        {err && <div className="mt-3 text-[12.5px]" style={{ color: 'var(--danger)' }}>{err}</div>}
      </Card>
    </div>
  );
}

function Dashboard({ acct, onLock }: { acct: Account; onLock: () => void }) {
  const { locale } = useSettings();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.address>> | null>(null);
  const [eavm, setEavm] = useState<{ chainId: number; rpcPort: number; rpcUrl?: string } | undefined>(undefined);
  const [msg, setMsg] = useState<React.ReactNode>(null);
  const refresh = () => api.address(acct.evm).then(setInfo).catch(() => {});
  useEffect(() => { refresh(); api.status().then((s) => setEavm(s.eavm)).catch(() => {}); const i = setInterval(refresh, 5000); return () => clearInterval(i); /* eslint-disable-next-line */ }, [acct.evm]);

  const [to, setTo] = useState(''); const [amt, setAmt] = useState('');
  const send = async () => {
    setMsg('assinando…');
    try {
      const dest = to.trim();
      if (isE7(dest)) throw new Error('informe o 0x do destino (a carteira assina no modelo EAVM)');
      if (!is0x(dest)) throw new Error('destino deve ser 0x…');
      const acc = await api.address(acct.evm);
      const raw = buildSignedTx({ privateKey: acct.privateKey, nonce: acc.nonce, to: dest, valueWei: eav7ToWei(amt), chainId: 72020 });
      const r = await api.postEavmTx(raw);
      setMsg(<span className="text-ok">enviada! confirma no próximo bloco</span>); setAmt(''); setTimeout(refresh, 2500);
    } catch (e) { setMsg(<span style={{ color: 'var(--danger)' }}>{String((e as Error).message)}</span>); }
  };

  const enPct = info && info.energy.max > 0 ? Math.round((info.energy.available / info.energy.max) * 100) : 0;

  return (
    <div className="fade-in mx-auto max-w-[620px]">
      <Card className="card-topline">
        <div className="mb-1 flex items-center justify-between"><span className="inline-block rounded-full bg-surface px-3 py-1 text-[11px] font-semibold text-muted">{info?.isValidator ? 'validador' : 'conta EAV7'}</span>
          <button className="ghost !px-3 !py-1.5 text-[12px]" onClick={onLock}>Bloquear</button></div>
        <div className="text-[clamp(30px,8vw,44px)] font-extrabold leading-none tracking-[-1.5px] tnum">{info ? fmt(info.balance, locale) : '…'} <small className="text-sm text-muted">EAV7</small></div>
        {info && Number(info.staked) > 0 && <div className="mt-1 text-[12.5px] text-muted">em stake: <b>{fmt(info.staked, locale)} EAV7</b>{info.feeExempt && <span className="text-ok"> · sem taxas</span>}</div>}
        {info && <div className="mt-3">
          <div className="mb-1 flex justify-between text-[12px]"><span className="text-muted">⚡ Energia</span><span className="mono">{info.energy.available} / {info.energy.max}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${enPct}%`, background: 'var(--grad-energy, linear-gradient(90deg,#48dba6,#9ee06a))' }} /></div>
        </div>}
        <div className="mt-3 space-y-1.5 text-[12px]">
          <div className="flex items-center gap-2"><span className="text-muted">E7</span><Mono className="break-all">{acct.eav7}</Mono><Copy v={acct.eav7} /></div>
          <div className="flex items-center gap-2"><span className="text-muted">0x</span><Mono className="break-all">{acct.evm}</Mono><Copy v={acct.evm} /></div>
        </div>
      </Card>

      <Card><CardTitle>Enviar EAV7</CardTitle>
        <label>Destino (0x… da conta EAVM/MetaMask)</label>
        <input className="fld" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" />
        <label>Valor (EAV7)</label>
        <input className="fld" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.0" inputMode="decimal" />
        <div className="mt-3"><button className="w-full" onClick={send}>Assinar e enviar</button></div>
        {msg && <div className="mt-3 break-all text-[12.5px]">{msg}</div>}
      </Card>

      <StakeCard acct={acct} onDone={refresh} />
      <AddNetworkCard cfg={{ chainId: 72020, rpcUrl: `${location.protocol}//rpc.${location.hostname.replace(/^www\./, '')}` }} />
    </div>
  );
}

function StakeCard({ acct, onDone }: { acct: Account; onDone: () => void }) {
  const [amt, setAmt] = useState(''); const [msg, setMsg] = useState<React.ReactNode>(null);
  const op = async (sys: string) => {
    setMsg('assinando…');
    try {
      const acc = await api.address(acct.evm);
      const raw = buildSignedTx({ privateKey: acct.privateKey, nonce: acc.nonce, to: sys, valueWei: eav7ToWei(amt), chainId: 72020 });
      await api.postEavmTx(raw); setMsg(<span className="text-ok">enviada!</span>); setAmt(''); setTimeout(onDone, 2500);
    } catch (e) { setMsg(<span style={{ color: 'var(--danger)' }}>{String((e as Error).message)}</span>); }
  };
  return (
    <Card><CardTitle extra="≥100 zera taxas · ≥1.000 minera">Stake</CardTitle>
      <input className="fld" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="ex.: 1000" inputMode="decimal" />
      <div className="mt-3 flex gap-2"><button className="flex-1" onClick={() => op(EAVM_STAKE_ADDRESS)}>Fazer stake</button><button className="ghost flex-1" onClick={() => op(EAVM_UNSTAKE_ADDRESS)}>Remover</button></div>
      {msg && <div className="mt-2 text-[12.5px]">{msg}</div>}
    </Card>
  );
}

const Tab = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className={`flex-1 rounded-[10px] px-2 py-2 text-[12.5px] font-semibold transition ${on ? 'text-white' : '!bg-transparent !shadow-none text-muted hover:text-ink'}`} style={on ? { background: 'var(--grad-accent)' } : undefined}>{children}</button>
);
function Copy({ v }: { v: string }) {
  return <button className="ghost !px-2 !py-0.5 text-[10px]" onClick={() => navigator.clipboard?.writeText(v)}>copiar</button>;
}
