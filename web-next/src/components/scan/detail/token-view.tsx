import Link from "next/link";
import type { TokenDetail, TokenHolder, Tx, VerifiedContract } from "@/lib/api";
import { Copy } from "@/components/ui/copy";
import { ago, fmtToken, num, numCompact, shortHash, when, whenUtc } from "@/lib/format";
import { ScanTabs, type TabDef } from "./tabs";
import {
  BackLink,
  DetailPage,
  EmptyRow,
  Empty,
  Glass,
  SideRow,
  TabPanel,
  avatarBg,
  initials,
  type T,
} from "./shell";

export const TOKEN_TABS = ["transfers", "holders", "contract", "analysis"] as const;
export type TokenTab = (typeof TOKEN_TABS)[number];

/**
 * Tela de DETALHE DO TOKEN.
 *
 * Omitido do desenho por falta de dado real: preço, variação 24h, market cap,
 * supply circulante, volume e liquidez — a EAV7 não tem oráculo de preço nem
 * mercado, e todos esses campos seriam inventados. A aba "Mercados" (corretoras,
 * pares, volume) saiu pela mesma razão. Em lugar deles ficam os números que o
 * protocolo REALMENTE publica: supply, detentores, concentração e os poderes
 * administrativos que o dono tem sobre o seu saldo.
 */
export function TokenView({
  token,
  holders,
  transfers,
  contract,
  tab,
  t,
}: {
  token: TokenDetail;
  holders: TokenHolder[];
  transfers: Tx[];
  contract: VerifiedContract | null;
  tab: TokenTab;
  t: T;
}) {
  const supply = fmtToken(token.totalSupply, token.decimals);
  const bloqueados = Object.keys(token.blacklist ?? {}).filter((a) => token.blacklist![a]);
  const congelados = Object.entries(token.frozen ?? {}).filter(([, f]) => {
    try {
      return BigInt(f.amount ?? "0") > 0n;
    } catch {
      return false;
    }
  });

  // Concentração: soma de participação do topo, em pontos-base (o nó calcula sem
  // float, então dividir por 100 aqui não perde precisão).
  const topo = (n: number) => holders.slice(0, n).reduce((a, h) => a + h.shareBps, 0) / 100;
  const pct = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;

  const url = (id: string) => `/token/${encodeURIComponent(token.id)}?tab=${id}`;
  const abas: TabDef[] = [
    { id: "transfers", label: t("scan_detail.tabTransfers"), href: url("transfers"), count: tab === "transfers" ? transfers.length : undefined },
    { id: "holders", label: t("scan_detail.tabHolders"), href: url("holders"), count: token.holders },
    { id: "contract", label: t("scan_detail.tabContract"), href: url("contract") },
    { id: "analysis", label: t("scan_detail.tabAnalysis"), href: url("analysis") },
  ];
  const painel = "token-panel";

  return (
    <DetailPage wide>
      <BackLink href="/tokens" label={t("scanLists.titleTokens")} />

      <div className="mb-5 flex items-center gap-3.5">
        <span
          aria-hidden
          className="grid size-[46px] shrink-0 place-items-center rounded-full text-[14px] font-bold text-white"
          style={{ background: avatarBg(token.symbol) }}
        >
          {initials(token.symbol)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[23px] font-extrabold tracking-tight text-ink">
              {token.name} <span className="text-[15px] font-semibold text-muted">({token.symbol})</span>
            </h1>
            <span className="badge badge-violet">{(token.standard ?? "eav20").toUpperCase()}</span>
            {token.mintable ? (
              <span className="badge badge-gold">{t("scan_detail.mintable")}</span>
            ) : (
              <span className="badge badge-teal">{t("scan_detail.fixedSupply")}</span>
            )}
            {token.paused ? <span className="badge badge-red">{t("scan_detail.paused")}</span> : null}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[12.5px] text-muted">
            <span className="font-mono truncate" title={token.id}>
              {token.id}
            </span>
            <Copy text={token.id} icon />
          </div>
        </div>
      </div>

      {/* Três painéis, tudo visível de uma vez — nenhum dado de identidade fica
          escondido atrás de clique. */}
      <div className="grid gap-3.5 lg:grid-cols-3">
        <Glass className="px-6 py-4">
          <div className="pb-2 text-[14px] font-extrabold text-ink">{t("scan_detail.tkOverview")}</div>
          <div className="tnum pb-2 text-[25px] font-extrabold text-ink" title={`${supply} ${token.symbol}`}>
            {supply} <span className="text-[13px] font-semibold text-muted">{token.symbol}</span>
          </div>
          <SideRow label={t("scan_detail.totalSupply")}>
            <span className="tnum">{supply}</span>
          </SideRow>
          <SideRow label={t("scan_detail.decimals")}>
            <span className="tnum">{num(token.decimals)}</span>
          </SideRow>
          <SideRow label={t("scan_detail.colHolders")}>
            <span className="tnum">{num(token.holders)}</span>
          </SideRow>
          <SideRow label={t("scan_detail.colStatus")}>
            <span className={`badge ${token.paused ? "badge-gold" : "badge-green"}`}>
              {token.paused ? t("scan_detail.statusPaused") : t("scan_detail.statusActive")}
            </span>
          </SideRow>
        </Glass>

        <Glass className="px-6 py-4">
          <div className="pb-2 text-[14px] font-extrabold text-ink">{t("scan_detail.basicInfo")}</div>
          <SideRow label={t("scan_detail.tabContract")}>
            <span className="inline-flex items-center gap-2">
              <span className="font-mono">{shortHash(token.id, 10, 7)}</span>
              <Copy text={token.id} icon />
            </span>
          </SideRow>
          <SideRow label={t("scan_detail.issuer")}>
            <Link href={`/address/${token.creator}`} className="font-mono text-violet hover:underline">
              {shortHash(token.creator, 10, 7)}
            </Link>
          </SideRow>
          <SideRow label={t("scan_detail.owner")}>
            <Link href={`/address/${token.owner}`} className="font-mono text-violet hover:underline">
              {shortHash(token.owner, 10, 7)}
            </Link>
          </SideRow>
          <SideRow label={t("scan_detail.issuingTime")}>
            <span className="tnum">{when(token.createdAt)}</span>
          </SideRow>
          <SideRow label={t("scan_detail.mintableLabel")}>
            <span className={`badge ${token.mintable ? "badge-gold" : "badge-green"}`}>
              {token.mintable ? t("scan_detail.yes") : t("scan_detail.no")}
            </span>
          </SideRow>
        </Glass>

        <Glass className="px-6 py-4">
          <div className="pb-2 text-[14px] font-extrabold text-ink">{t("scan_detail.tkMore")}</div>
          <SideRow label={t("scan_detail.top1")}>
            <span className="tnum">{pct(topo(1))}</span>
          </SideRow>
          <SideRow label={t("scan_detail.top10")}>
            <span className="tnum">{pct(topo(10))}</span>
          </SideRow>
          <SideRow label={t("scan_detail.top50")}>
            <span className="tnum">{pct(topo(50))}</span>
          </SideRow>
          <SideRow label={t("scan_detail.blacklisted")}>
            <span className="tnum">{num(bloqueados.length)}</span>
          </SideRow>
          <SideRow label={t("scan_detail.frozenAccounts")}>
            <span className="tnum">{num(congelados.length)}</span>
          </SideRow>
        </Glass>
      </div>

      <ScanTabs tabs={abas} current={tab} label={token.symbol} panelId={painel} />

      <TabPanel id={painel} labelledBy={`${painel}-tab-${tab}`}>
        {/* ---------- TRANSFERÊNCIAS ---------- */}
        {tab === "transfers" ? (
          <Glass className="overflow-hidden">
            <div className="scan-scroll">
              <table className="scan-table">
                <thead>
                  <tr>
                    <th>{t("scan_detail.colHash")}</th>
                    <th>{t("scan_detail.colBlock")}</th>
                    <th>{t("scan_detail.colAge")}</th>
                    <th>{t("scan_detail.colFrom")}</th>
                    <th>{t("scan_detail.colTo")}</th>
                    <th className="!text-right">
                      {t("scan_detail.colAmount")} ({token.symbol})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((x) => (
                    <tr key={x.id}>
                      <td className="max-w-[220px]">
                        <Link href={`/tx/${x.id}`} className="font-mono text-violet hover:underline">
                          {shortHash(x.id, 12, 6)}
                        </Link>
                      </td>
                      <td>
                        {x.blockHeight != null ? (
                          <Link href={`/block/${x.blockHeight}`} className="text-violet hover:underline">
                            {num(x.blockHeight)}
                          </Link>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-muted" title={when(x.timestamp)}>
                        {ago(x.timestamp)}
                      </td>
                      <td>
                        <Link href={`/address/${x.from}`} className="font-mono text-violet hover:underline">
                          {shortHash(x.from, 6, 4)}
                        </Link>
                      </td>
                      <td>
                        {x.to ? (
                          <Link href={`/address/${x.to}`} className="font-mono text-violet hover:underline">
                            {shortHash(x.to, 6, 4)}
                          </Link>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="tnum whitespace-nowrap text-right font-semibold text-ink">
                        {fmtToken(x.amount, token.decimals)}
                      </td>
                    </tr>
                  ))}
                  {transfers.length === 0 ? <EmptyRow cols={6}>{t("scan_detail.noTransfers")}</EmptyRow> : null}
                </tbody>
              </table>
            </div>
          </Glass>
        ) : null}

        {/* ---------- DETENTORES ---------- */}
        {tab === "holders" ? (
          <Glass className="overflow-hidden">
            <div className="scan-scroll">
              <table className="scan-table">
                <thead>
                  <tr>
                    <th>{t("scan_detail.colRank")}</th>
                    <th>{t("scan_detail.colAddress")}</th>
                    <th>{t("scan_detail.holderShare")}</th>
                    <th className="!text-right">{t("scan_detail.colAmount")}</th>
                    <th className="!text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {holders.map((h) => {
                    const p = h.shareBps / 100;
                    return (
                      <tr key={h.address}>
                        <td className="tnum text-faint">{h.rank}</td>
                        <td>
                          <span className="inline-flex items-center gap-2">
                            <Link href={`/address/${h.address}`} className="font-mono text-violet hover:underline">
                              {shortHash(h.address, 12, 8)}
                            </Link>
                            {h.blacklisted ? <span className="badge badge-red">{t("scan_detail.blacklisted")}</span> : null}
                          </span>
                        </td>
                        <td className="min-w-[140px] pr-6">
                          <span className="scan-bar">
                            <span style={{ width: `${Math.max(p, 0.4)}%` }} />
                          </span>
                        </td>
                        <td className="tnum whitespace-nowrap text-right">{fmtToken(h.balance, token.decimals)}</td>
                        <td className="tnum text-right font-semibold">
                          {p < 0.01 ? "<0,01" : p.toFixed(2).replace(".", ",")}%
                        </td>
                      </tr>
                    );
                  })}
                  {holders.length === 0 ? <EmptyRow cols={5}>{t("scan_detail.noHolders")}</EmptyRow> : null}
                </tbody>
              </table>
            </div>
          </Glass>
        ) : null}

        {/* ---------- CONTRATO ---------- */}
        {tab === "contract" ? <Contrato token={token} contract={contract} bloqueados={bloqueados} congelados={congelados} t={t} /> : null}

        {/* ---------- ANÁLISE ---------- */}
        {tab === "analysis" ? (
          <Glass className="px-6 py-5">
            <h3 className="text-[14px] font-bold text-ink">{t("scan_detail.concentration")}</h3>
            <p className="mt-1 max-w-[80ch] text-[12px] leading-relaxed text-faint">
              {t("scan_detail.concentrationNote")}
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {[
                { l: t("scan_detail.top1"), v: topo(1) },
                { l: t("scan_detail.top10"), v: topo(10) },
                { l: t("scan_detail.top50"), v: topo(50) },
              ].map((b) => (
                <div key={b.l}>
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="font-mono uppercase tracking-wide text-muted">{b.l}</span>
                    <span className="tnum font-semibold text-ink">{pct(b.v)}</span>
                  </div>
                  <span className="scan-bar mt-1.5 block">
                    <span style={{ width: `${Math.min(b.v, 100)}%` }} />
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--scan-border-soft)] px-4 py-3">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-faint">
                  {t("scan_detail.colHolders")}
                </div>
                <div className="tnum mt-1 text-[16px] font-bold text-ink">{numCompact(token.holders)}</div>
              </div>
              <div className="rounded-xl border border-[var(--scan-border-soft)] px-4 py-3">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-faint">
                  {t("scan_detail.largestHolder")}
                </div>
                <div className="mt-1 text-[13px] font-bold">
                  {holders[0] ? (
                    <Link href={`/address/${holders[0].address}`} className="font-mono text-violet hover:underline">
                      {shortHash(holders[0].address, 12, 8)}
                    </Link>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </div>
              </div>
            </div>
          </Glass>
        ) : null}
      </TabPanel>
    </DetailPage>
  );
}

/**
 * Aba "Contrato".
 *
 * Num explorador de EVM esta aba existe para você LER o código e descobrir se o
 * dono pode congelar o seu saldo. Um EAV20 é NATIVO do protocolo: não há código
 * arbitrário, e os mesmos poderes são campos de estado. Então listamos direto o que
 * o administrador pode fazer — que é a pergunta que a leitura do código responderia.
 * Se o token também for um contrato EAVM verificado, o código verificado aparece.
 */
function Contrato({
  token,
  contract,
  bloqueados,
  congelados,
  t,
}: {
  token: TokenDetail;
  contract: VerifiedContract | null;
  bloqueados: string[];
  congelados: [string, { amount: string; unlockAt: number }][];
  t: T;
}) {
  const poderes = [
    { label: t("scan_detail.powerMint"), on: token.mintable, note: t("scan_detail.powerMintNote") },
    { label: t("scan_detail.powerPause"), on: true, note: t("scan_detail.powerPauseNote"), ativo: token.paused },
    { label: t("scan_detail.powerBlacklist"), on: true, note: t("scan_detail.powerBlacklistNote"), n: bloqueados.length },
    { label: t("scan_detail.powerFreeze"), on: true, note: t("scan_detail.powerFreezeNote"), n: congelados.length },
  ];

  return (
    <>
      {contract?.verified ? (
        <Glass className="mb-4 px-6 py-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="badge badge-green">✓ {t("scan_detail.verified")}</span>
            <span className="badge badge-violet">{contract.compiler}</span>
            <span className="font-mono text-[12px] text-muted">{shortHash(contract.address, 14, 8)}</span>
            <span className="text-[12px] text-faint">{whenUtc(contract.verifiedAt)} UTC</span>
            <Copy text={contract.address} icon />
          </div>
          <pre className="scan-input font-mono mt-3.5 overflow-x-auto p-4 text-[11.5px] leading-[1.8] text-muted">
            {contract.source}
          </pre>
        </Glass>
      ) : null}

      <Glass className="overflow-hidden">
        <div className="border-b border-[var(--scan-border-soft)] px-5 py-3.5">
          <span className="font-display text-[13.5px] font-bold text-ink">{t("scan_detail.powersTitle")}</span>
          <p className="mt-1 max-w-[86ch] text-[12px] leading-relaxed text-faint">{t("scan_detail.powersNote")}</p>
        </div>
        <div className="px-5 py-1">
          {poderes.map((p) => (
            <div
              key={p.label}
              className="flex items-start justify-between gap-4 border-b border-[var(--scan-border-soft)] py-3 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{p.label}</span>
                <span className="block text-[11.5px] leading-relaxed text-faint">{p.note}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {p.n ? <span className="tnum badge badge-gold">{num(p.n)}</span> : null}
                {p.ativo ? <span className="badge badge-red">{t("scan_detail.powerActiveNow")}</span> : null}
                <span className={`badge ${p.on ? "badge-gold" : "badge-green"}`}>
                  {p.on ? t("scan_detail.yes") : t("scan_detail.no")}
                </span>
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-[var(--scan-border-soft)] px-5 py-3.5 text-[12.5px]">
          <span className="text-muted">{t("scan_detail.adminIs")} </span>
          <Link href={`/address/${token.owner}`} className="font-mono text-violet hover:underline">
            {shortHash(token.owner, 12, 8)}
          </Link>
        </div>
      </Glass>

      {bloqueados.length > 0 || congelados.length > 0 ? (
        <Glass className="mt-4 px-6 py-5">
          <span className="font-display text-[13.5px] font-bold text-ink">{t("scan_detail.restrictions")}</span>
          <div className="mt-2.5">
            {bloqueados.map((a) => (
              <div
                key={a}
                className="flex items-center justify-between gap-3 border-b border-[var(--scan-border-soft)] py-2.5 last:border-b-0"
              >
                <Link href={`/address/${a}`} className="font-mono text-[12.5px] text-violet hover:underline">
                  {shortHash(a, 12, 8)}
                </Link>
                <span className="badge badge-red">{t("scan_detail.blacklisted")}</span>
              </div>
            ))}
            {congelados.map(([a, f]) => (
              <div
                key={a}
                className="flex items-center justify-between gap-3 border-b border-[var(--scan-border-soft)] py-2.5 last:border-b-0"
              >
                <Link href={`/address/${a}`} className="font-mono text-[12.5px] text-violet hover:underline">
                  {shortHash(a, 12, 8)}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="tnum text-[12.5px] text-ink">{fmtToken(f.amount, token.decimals)}</span>
                  <span className="badge badge-gold">{t("scan_detail.frozenUntil", { when: when(f.unlockAt) })}</span>
                </span>
              </div>
            ))}
          </div>
        </Glass>
      ) : (
        <Glass className="mt-4">
          <Empty>{t("scan_detail.noRestrictions")}</Empty>
        </Glass>
      )}
    </>
  );
}
