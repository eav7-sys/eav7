import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import { useSettings } from '../lib/settings';
import { fmt, fmtCompact, when } from '../lib/format';
import { Card, CardTitle, PageTitle, Tile, Badge, AddrLink, TxLink, BlockLink, TableWrap, Th, Td, Spinner, Mono, EmptyRow } from '../components/ui';
import { NotFound } from './NotFound';

export function AddressPage() {
  const { addr } = useParams();
  const { t, lang, locale } = useSettings();
  const { data, error, loading } = usePolling(() => api.address(addr!), 6000, [addr]);
  const { data: txr } = usePolling(() => api.addressTxs(addr!, 50), 6000, [addr]);
  if (loading) return <Spinner label={t('loading')} />;
  if (error || !data) return <NotFound />;
  const me = data.address;
  const enPct = data.energy.max > 0 ? Math.round((data.energy.available / data.energy.max) * 100) : 0;

  return (
    <div className="fade-in">
      <PageTitle title={t('p_address')} sub={data.address} />
      {data.eavmAddress && (
        <Card><span className="mr-2 inline-block rounded-full bg-surface px-3 py-1 text-[11px] font-semibold text-muted">EAVM · MetaMask</span><Mono>{data.eavmAddress}</Mono> <span className="text-muted">→ mapeado para o E7 acima</span></Card>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Tile label="Saldo" value={<span title={`${fmt(data.balance, locale)} EAV7`}>{fmtCompact(data.balance, lang)} <small className="text-xs font-medium text-muted">EAV7</small></span>} accent="rgba(72,219,166,.32)" />
        <Tile label="Em stake" value={<>{fmt(data.staked, locale)} <small className="text-xs font-medium text-muted">EAV7</small></>} sub={data.feeExempt ? 'isento de taxa' : undefined} />
        <Tile label="⚡ Energia" value={`${data.energy.available} / ${data.energy.max}`} sub={data.feeExempt ? 'validador/oráculo' : `${enPct}% disponível`} accent="rgba(126,224,138,.34)" />
        <Tile label="Nonce" value={data.nonce} sub={data.isValidator ? 'validador' : undefined} />
      </div>
      <Card topline>
        <CardTitle>{t('p_txs')}</CardTitle>
        <TableWrap>
          <thead><tr><Th>{t('th_hash')}</Th><Th>{t('th_block')}</Th><Th>{t('th_type')}</Th><Th>{t('th_from')}</Th><Th>{t('th_to')}</Th><Th>{t('th_value')}</Th><Th>{t('th_date')}</Th></tr></thead>
          <tbody>
            {(txr?.txs ?? []).length ? (txr!.txs).map((tx) => (
              <tr key={tx.id} className="hover:bg-surface2">
                <Td><TxLink id={tx.id} /></Td>
                <Td>{tx._h != null ? <BlockLink height={tx._h} /> : '—'}</Td>
                <Td><Badge label={tx.type} kind={tx.type} /></Td>
                <Td className={tx.from === me ? 'text-muted' : ''}><AddrLink addr={tx.from} /></Td>
                <Td>{tx.to ? <AddrLink addr={tx.to} /> : <span className="text-muted">—</span>}</Td>
                <Td className={tx.to === me ? 'text-ok' : ''}>{tx.amount ? `${tx.from === me ? '−' : '+'}${fmt(tx.amount, locale)}` : '—'}</Td>
                <Td className="text-muted">{when(tx.timestamp, locale)}</Td>
              </tr>
            )) : <EmptyRow cols={7}>sem transações</EmptyRow>}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
