import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import { useSettings } from '../lib/settings';
import { fmt, fmtCompact, ago, short } from '../lib/format';
import { Card, CardTitle, Tile, Badge, AddrLink, TxLink, BlockLink, TableWrap, Th, Td, Spinner, EmptyRow } from '../components/ui';
import { BarSpark, Donut } from '../components/Charts';

export function Home() {
  const { t, lang } = useSettings();
  const { data: status } = usePolling(() => api.status(), 3000, []);
  const { data: blocks } = usePolling(() => api.blocks(16), 3000, []);
  const { data: txr } = usePolling(() => api.recentTxs(10), 4000, []);

  const recentTxs = txr?.txs ?? [];
  const txSeries = useMemo(() => [...(blocks ?? [])].reverse().map((b) => b.txCount), [blocks]);
  const producers = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of blocks ?? []) c[b.producer] = (c[b.producer] ?? 0) + 1;
    return Object.entries(c).map(([name, value]) => ({ name: short(name, 8), value })).sort((a, b) => b.value - a.value);
  }, [blocks]);

  if (!status) return <Spinner label={t('loading')} />;
  const energyPct = 100;

  return (
    <div className="fade-in">
      {/* tiles */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label={t('t_height')} value={status.height.toLocaleString(lang)} />
        <Tile label={t('t_supply')} value={<>{fmtCompact(status.supply, lang)} <small className="text-xs font-medium text-muted">EAV7</small></>} sub={`${fmtCompact(status.circulating, lang)} ${t('supply_circ')}`} accent="rgba(72,219,166,.32)" />
        <Tile label={t('t_burned')} value={<>{fmtCompact(status.burned, lang)} <small className="text-xs font-medium text-muted">EAV7</small></>} accent="rgba(255,135,144,.3)" />
        <Tile label={t('t_reward')} value={<>{fmt(status.blockReward, lang)} <small className="text-xs font-medium text-muted">EAV7</small></>} />
        <Tile label={t('t_blocktime')} value={<>{(status.blockTimeMs / 1000)}s</>} sub="Tron: 3s" />
        <Tile label={t('t_validators')} value={status.validators} />
        <Tile label={t('t_mempool')} value={status.mempool} />
        <Tile label={t('t_aioracles')} value={status.ai?.oracles ?? 0} sub={`${status.ai?.pendingTasks ?? 0} tarefas`} accent="rgba(183,149,255,.34)" />
      </div>

      {/* charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card topline className="!mb-0">
          <div className="text-[12px] font-bold uppercase tracking-[.8px] text-muted">{t('chart_txs')}</div>
          <div className="mt-1 text-[27px] font-extrabold tracking-[-.6px] tnum">{txSeries.reduce((a, b) => a + b, 0)} <small className="text-xs font-semibold text-muted">nos últimos {txSeries.length} blocos</small></div>
          <BarSpark values={txSeries.length ? txSeries : [0]} />
        </Card>
        <Card className="!mb-0">
          <CardTitle>{t('chart_producers')}</CardTitle>
          {producers.length ? <Donut data={producers} /> : <div className="text-sm text-muted">—</div>}
        </Card>
      </div>

      {/* blocks + txs */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card topline>
          <CardTitle extra={<Link to="/blocks" className="text-link">ver todos →</Link>}>{t('latest_blocks')}</CardTitle>
          <TableWrap>
            <thead><tr><Th>{t('th_block')}</Th><Th>{t('th_producer')}</Th><Th>{t('th_txs')}</Th><Th>{t('th_age')}</Th></tr></thead>
            <tbody>
              {(blocks ?? []).slice(0, 12).map((b) => (
                <tr key={b.hash} className="transition-colors hover:bg-surface2">
                  <Td><BlockLink height={b.height} /></Td>
                  <Td><AddrLink addr={b.producer} /></Td>
                  <Td>{b.txCount}</Td>
                  <Td className="text-muted">{ago(b.timestamp)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
        <Card topline>
          <CardTitle>{t('latest_txs')}</CardTitle>
          <TableWrap>
            <thead><tr><Th>{t('th_hash')}</Th><Th>{t('th_type')}</Th><Th>{t('th_from')}</Th><Th>{t('th_to')}</Th></tr></thead>
            <tbody>
              {recentTxs.length ? recentTxs.map((tx) => (
                <tr key={tx.id} className="transition-colors hover:bg-surface2">
                  <Td><TxLink id={tx.id} /></Td>
                  <Td><Badge label={tx.type} kind={tx.type} /></Td>
                  <Td><AddrLink addr={tx.from} /></Td>
                  <Td>{tx.to ? <AddrLink addr={tx.to} /> : <span className="text-muted">—</span>}</Td>
                </tr>
              )) : <EmptyRow cols={4}>{t('no_txs')}</EmptyRow>}
            </tbody>
          </TableWrap>
        </Card>
      </div>
    </div>
  );
}
