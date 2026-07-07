import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import { useSettings } from '../lib/settings';
import { fmt, when, energyCost } from '../lib/format';
import { Card, PageTitle, KV, Badge, AddrLink, BlockLink, Spinner, Mono } from '../components/ui';
import { NotFound } from './NotFound';

export function TxPage() {
  const { id } = useParams();
  const { t, locale } = useSettings();
  const { data, error, loading } = usePolling(() => api.tx(id!), 0, [id]);
  if (loading) return <Spinner label={t('loading')} />;
  if (error || !data?.tx) return <NotFound />;
  const { tx, status, blockHeight } = data;
  const hasEavm = tx.type === 'EAVM_DEPLOY' || tx.type === 'EAVM_CALL';

  return (
    <div className="fade-in">
      <PageTitle title={t('p_tx')} sub={tx.id} />
      <Card topline>
        <KV rows={[
          ['Status', <Badge label={status} kind={status} />],
          [t('th_type'), <Badge label={tx.type} kind={tx.type} />],
          ...(blockHeight != null ? [[t('th_block'), <BlockLink height={blockHeight} />] as [React.ReactNode, React.ReactNode]] : []),
          [t('th_from'), <AddrLink addr={tx.from} len={20} />],
          [t('th_to'), tx.to ? <AddrLink addr={tx.to} len={20} /> : <span className="text-muted">—</span>],
          [t('th_value'), <span className="text-ok">{fmt(tx.amount, locale)} EAV7</span>],
          [<>⚡ {t('energy_consumed')}</>, <>{energyCost(tx.type)} <span className="text-muted">unidades{hasEavm ? ' (+ gás EAVM)' : ''}</span></>],
          [<>{t('th_fee')} <span className="text-muted">(queimada se faltar energia)</span></>, `${fmt(tx.fee, locale)} EAV7`],
          ['Nonce', tx.nonce],
          [t('th_date'), when(tx.timestamp, locale)],
        ]} />
      </Card>
      {tx.data && Object.keys(tx.data).length > 0 && (
        <Card><div className="mb-2 text-[13.5px] font-bold">data</div>
          <pre className="overflow-x-auto rounded-tile border border-line bg-[var(--field-bg)] p-4 text-[11.5px] leading-relaxed" style={{ color: 'var(--violet)' }}><Mono>{JSON.stringify(tx.data, null, 2)}</Mono></pre></Card>
      )}
    </div>
  );
}
