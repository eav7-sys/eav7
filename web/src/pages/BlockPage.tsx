import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import { useSettings } from '../lib/settings';
import { fmt, when, ago, energyCost, ENERGY_COST } from '../lib/format';
import { Card, CardTitle, PageTitle, KV, Badge, AddrLink, TxLink, BlockLink, TableWrap, Th, Td, Spinner, Mono, EmptyRow } from '../components/ui';
import { NotFound } from './NotFound';

export function BlockPage() {
  const { id } = useParams();
  const { t, locale } = useSettings();
  const { data, error, loading } = usePolling(() => api.block(id!), 0, [id]);
  if (loading) return <Spinner label={t('loading')} />;
  if (error || !data) return <NotFound />;
  const b = (data as { block?: typeof data }).block ?? data;
  const txs = b.transactions ?? [];
  const energy = txs.reduce((s, tx) => s + (ENERGY_COST[tx.type] ?? 1), 0);
  const hasEavm = txs.some((tx) => tx.type === 'EAVM_DEPLOY' || tx.type === 'EAVM_CALL');

  return (
    <div className="fade-in">
      <PageTitle title={<>{t('p_block')} #{b.height}</>} sub={b.hash} />
      <Card topline>
        <KV rows={[
          [t('th_block'), b.height],
          [t('th_hash'), <Mono className="break-all">{b.hash}</Mono>],
          ['Hash anterior', <BlockLink height={b.height - 1} />],
          [t('th_producer'), <AddrLink addr={b.producer} len={16} />],
          [t('th_txs'), b.txCount],
          [<>⚡ {t('energy_consumed')}</>, <>{energy} <span className="text-muted">unidades{hasEavm ? ' + gás EAVM' : ''}</span></>],
          ['Merkle root', <Mono className="break-all">{b.txRoot}</Mono>],
          [t('th_date'), <>{when(b.timestamp, locale)} <span className="text-muted">({ago(b.timestamp)})</span></>],
        ]} />
      </Card>
      <Card topline>
        <CardTitle>{t('p_txs')} ({b.txCount})</CardTitle>
        <TableWrap>
          <thead><tr><Th>{t('th_hash')}</Th><Th>{t('th_type')}</Th><Th>{t('th_from')}</Th><Th>{t('th_to')}</Th><Th>{t('th_value')}</Th><Th>⚡</Th><Th>{t('th_fee')}</Th></tr></thead>
          <tbody>
            {txs.length ? txs.map((tx) => (
              <tr key={tx.id} className="hover:bg-surface2">
                <Td><TxLink id={tx.id} /></Td><Td><Badge label={tx.type} kind={tx.type} /></Td>
                <Td><AddrLink addr={tx.from} /></Td><Td>{tx.to ? <AddrLink addr={tx.to} /> : <span className="text-muted">—</span>}</Td>
                <Td className="text-ok">{tx.amount ? `${fmt(tx.amount, locale)}` : '—'}</Td>
                <Td className="text-muted">{energyCost(tx.type)}</Td><Td className="text-muted">{fmt(tx.fee, locale)}</Td>
              </tr>
            )) : <EmptyRow cols={7}>bloco vazio</EmptyRow>}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
