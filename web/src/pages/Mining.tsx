import { api } from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import { useSettings } from '../lib/settings';
import { fmt, ago } from '../lib/format';
import { Card, CardTitle, Tile, AddrLink, BlockLink, TableWrap, Th, Td, Spinner, Mono } from '../components/ui';
import { AddNetworkCard, ConverterCard } from '../components/WalletTools';

export function Mining() {
  const { t, lang, locale } = useSettings();
  const { data: status } = usePolling(() => api.status(), 3000, []);
  const { data: blocks } = usePolling(() => api.blocks(12), 3000, []);
  const { data: vals } = usePolling(() => api.validators(), 8000, []);
  if (!status) return <Spinner label={t('loading')} />;

  return (
    <div className="fade-in">
      <div className="mb-6">
        <h1 className="text-[26px] font-extrabold tracking-[-.5px]">Plataforma de mineração</h1>
        <p className="mt-1 max-w-[560px] text-[13px] text-muted">Segurança pós-quântica <b>eav7-hybrid-1</b> · vigilância 24h por IA · DPoS com blocos de 1s. Crie sua carteira e faça stake para minerar.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label={t('t_height')} value={status.height.toLocaleString(lang)} />
        <Tile label={t('t_reward')} value={<>{fmt(status.blockReward, locale)} <small className="text-xs text-muted">EAV7</small></>} />
        <Tile label={t('t_blocktime')} value={`${status.blockTimeMs / 1000}s`} sub="Tron: 3s" />
        <Tile label={t('t_validators')} value={status.validators} />
        <Tile label={t('t_mempool')} value={status.mempool} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <Card topline>
            <CardTitle extra="hashes E7">{t('latest_blocks')}</CardTitle>
            <TableWrap>
              <thead><tr><Th>#</Th><Th>Minerador</Th><Th>Txs</Th><Th>Hora</Th></tr></thead>
              <tbody>{(blocks ?? []).map((b) => (
                <tr key={b.hash} className="hover:bg-surface2"><Td><BlockLink height={b.height} /></Td><Td><AddrLink addr={b.producer} /></Td><Td>{b.txCount}</Td><Td className="text-muted">{ago(b.timestamp)}</Td></tr>
              ))}</tbody>
            </TableWrap>
          </Card>
          <Card>
            <CardTitle extra="stake mín. 1.000">Mineradores / validadores</CardTitle>
            <TableWrap>
              <thead><tr><Th>Endereço</Th><Th>Stake</Th></tr></thead>
              <tbody>{(vals?.current ?? []).map((v) => (
                <tr key={v.address} className="hover:bg-surface2"><Td><AddrLink addr={v.address} len={18} /></Td><Td>{fmt(v.staked, locale)} EAV7</Td></tr>
              ))}</tbody>
            </TableWrap>
          </Card>
        </div>
        <div>
          <Card><CardTitle>Carteira</CardTitle>
            <p className="text-muted">Crie sua carteira E7 self-custodial (chave só no seu navegador) na carteira web, ou pela CLI <Mono>eav7 wallet new</Mono>.</p>
            <div className="mt-3"><a className="btn w-full" href="/wallet">Abrir carteira</a></div>
          </Card>
          <AddNetworkCard cfg={status.eavm} />
          <ConverterCard />
          <Card><CardTitle>Como minerar</CardTitle>
            <pre className="overflow-x-auto rounded-tile border border-line bg-[var(--field-bg)] p-3.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--violet)' }}>{`# 1. rode seu nó minerador
node bin/eav7.js mine --port 6071 --peers https://eavscan.com

# 2. tenha EAV7 e faça stake
node bin/eav7.js stake --wallet w.json --amount 1000
# ≥ 100 zera taxas · ≥ 1000 = minerador (16 EAV7/bloco)`}</pre>
          </Card>
        </div>
      </div>
    </div>
  );
}
