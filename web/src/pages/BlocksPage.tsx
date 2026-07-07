import { useState } from 'react';
import { api } from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import { useSettings } from '../lib/settings';
import { when, ago } from '../lib/format';
import { Card, CardTitle, PageTitle, AddrLink, BlockLink, TableWrap, Th, Td, Spinner, Mono } from '../components/ui';

export function BlocksPage() {
  const { t, locale } = useSettings();
  const { data: status } = usePolling(() => api.status(), 0, []);
  const [start, setStart] = useState<number | null>(null);
  const from = start ?? Math.max(0, (status?.height ?? 25) - 24);
  const { data, loading } = usePolling(() => api.chainPage(from, 25), 0, [from]);
  const blocks = (data?.blocks ?? []).slice().reverse();

  return (
    <div className="fade-in">
      <PageTitle title={t('p_blocks')} />
      <Card topline>
        <CardTitle extra={status ? `altura ${status.height.toLocaleString(locale)}` : ''}>{t('latest_blocks')}</CardTitle>
        {loading && !data ? <Spinner /> : (
          <TableWrap>
            <thead><tr><Th>{t('th_block')}</Th><Th>{t('th_hash')}</Th><Th>{t('th_producer')}</Th><Th>{t('th_txs')}</Th><Th>{t('th_date')}</Th></tr></thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.hash} className="hover:bg-surface2">
                  <Td><BlockLink height={b.height} /></Td>
                  <Td><Mono className="text-link">{b.hash.slice(0, 14)}…</Mono></Td>
                  <Td><AddrLink addr={b.producer} /></Td>
                  <Td>{b.txCount}</Td>
                  <Td className="text-muted">{when(b.timestamp, locale)} <span className="text-faint">({ago(b.timestamp)})</span></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <div className="mt-4 flex gap-2">
          <button className="!bg-transparent glass !text-ink" disabled={from <= 0} onClick={() => setStart(Math.max(0, from - 25))}>← mais antigos</button>
          <button className="glass !bg-transparent !text-ink" disabled={!status || from + 25 > status.height} onClick={() => setStart(from + 25)}>mais recentes →</button>
        </div>
      </Card>
    </div>
  );
}
