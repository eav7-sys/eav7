import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getToken, getTokenHolders, getTokenTransfers, type Tx, type TokenHolder } from "@/lib/api";
import { AddrLink, TxLink, BlockLink } from "@/components/hash-link";
import { TokenLogo } from "@/components/tokens/token-logo";
import { Copy } from "@/components/ui/copy";
import { Ago } from "@/components/ui/ago";
import { IconCheck, IconX, IconSupply, IconWallet, IconCode } from "@/components/icons";
import { fmtToken, num, numCompact, shortHash, when } from "@/lib/format";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

const TABS = ["transfers", "holders", "contract", "analysis"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const token = await getToken(id).catch(() => null);
  const t = await getT();
  return {
    title: token
      ? t("page_token.metaTitle", { symbol: token.symbol, name: token.name })
      : t("page_token.metaTitleFallback"),
  };
}

export default async function TokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "transfers";

  const token = await getToken(id).catch(() => null);
  if (!token) notFound();

  // Holders é buscado SEMPRE: alimenta o painel de distribuição do topo, que fica
  // visível em qualquer aba. Transferências, só na aba delas.
  const [transfersRes, holdersRes] = await Promise.all([
    tab === "transfers" ? getTokenTransfers(id, 50) : Promise.resolve({ txs: [] as Tx[] }),
    getTokenHolders(id, 100),
  ]);
  const transfers = transfersRes.txs;
  const holders = holdersRes?.list ?? [];

  const supply = fmtToken(token.totalSupply, token.decimals);
  const bpsOf = (n: number) => holders.slice(0, n).reduce((a, h) => a + h.shareBps, 0) / 100;
  const pct = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;

  const tabLabel: Record<Tab, string> = {
    transfers: t("page_token.tabTransfers"),
    holders: t("page_token.tabHolders"),
    contract: t("page_token.tabContract"),
    analysis: t("page_token.tabAnalysis"),
  };
  const counts: Partial<Record<Tab, number>> = {
    transfers: tab === "transfers" ? transfers.length : undefined,
    holders: token.holders,
  };

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      {/* Identidade compacta: logo + nome + selos numa linha, endereço logo abaixo.
          Os números saem daqui e vão para os painéis — o cabeçalho só identifica. */}
      <div className="rise mb-5 flex items-start gap-3">
        <span
          className="grid h-12 w-12 flex-none place-items-center rounded-xl text-white"
          style={{
            background: "linear-gradient(140deg, var(--violet), color-mix(in srgb, var(--violet) 45%, #1a1826))",
            boxShadow: "0 8px 22px -8px var(--violet)",
          }}
        >
          <TokenLogo symbol={token.symbol} size={24} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="font-display text-[clamp(20px,3vw,28px)] font-extrabold leading-tight tracking-tight">
              {token.name} <span className="text-muted">({token.symbol})</span>
            </h1>
            <span className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="badge badge-violet">{t("page_token.standard")}</span>
              {token.mintable ? (
                <span className="badge badge-gold">{t("page_token.mintable")}</span>
              ) : (
                <span className="badge badge-teal">{t("page_token.fixedSupply")}</span>
              )}
              {token.paused && <span className="badge badge-red">{t("page_token.paused")}</span>}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 break-all font-mono text-[12px] text-muted">
            <span>{token.id}</span>
            <Copy text={token.id} />
          </div>
        </div>
      </div>

      {/* Três painéis lado a lado, tudo visível de uma vez. As abas abaixo trocam
          apenas a tabela — nenhum dado de identidade fica escondido atrás de clique. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t("page_token.overviewTitle")} icon={<IconSupply size={13} />} chip="chip-violet">
          <PanelRow label={t("page_token.totalSupply")}>
            <span className="tnum" title={`${supply} ${token.symbol}`}>
              {supply} <span className="text-muted">{token.symbol}</span>
            </span>
          </PanelRow>
          <PanelRow label={t("page_token.decimals")}>
            <span className="tnum">{token.decimals}</span>
          </PanelRow>
          <PanelRow label={t("page_token.standardLabel")}>
            <span className="font-mono uppercase">{token.standard}</span>
          </PanelRow>
          <PanelRow label={t("page_token.status")}>
            <span className={`badge ${token.paused ? "badge-gold" : "badge-green"}`}>
              {token.paused ? <IconX size={11} /> : <IconCheck size={11} />}
              {token.paused ? t("page_token.statusPaused") : t("page_token.statusActive")}
            </span>
          </PanelRow>
        </Panel>

        <Panel title={t("page_token.basicInfoTitle")} icon={<IconCode size={13} />} chip="chip-blue">
          <PanelRow label={t("page_token.contract")}>
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono text-[11.5px]">{shortHash(token.id, 8, 6)}</span>
              <Copy text={token.id} icon />
            </span>
          </PanelRow>
          <PanelRow label={t("page_token.creator")}>
            <span className="inline-flex items-center gap-1.5">
              <AddrLink addr={token.creator} len={8} />
              <Copy text={token.creator} icon />
            </span>
          </PanelRow>
          <PanelRow label={t("page_token.owner")}>
            <span className="inline-flex items-center gap-1.5">
              <AddrLink addr={token.owner} len={8} />
              <Copy text={token.owner} icon />
            </span>
          </PanelRow>
          <PanelRow label={t("page_token.createdAt")}>
            <span className="tnum font-mono text-[11.5px]">{when(token.createdAt)}</span>
          </PanelRow>
          <PanelRow label={t("page_token.mintableLabel")}>
            <Yes on={token.mintable} t={t} />
          </PanelRow>
        </Panel>

        <Panel title={t("page_token.activityTitle")} icon={<IconWallet size={13} />} chip="chip-teal">
          <PanelRow label={t("page_token.holders")}>
            <span className="tnum font-semibold">{num(token.holders)}</span>
          </PanelRow>
          <PanelRow label={t("page_token.top1")}>
            <span className="tnum">{pct(bpsOf(1))}</span>
          </PanelRow>
          <PanelRow label={t("page_token.top10")}>
            <span className="tnum">{pct(bpsOf(10))}</span>
          </PanelRow>
          <PanelRow label={t("page_token.top50")}>
            <span className="tnum">{pct(bpsOf(50))}</span>
          </PanelRow>
          <PanelRow label={t("page_token.largestHolderShort")}>
            {holders[0] ? <AddrLink addr={holders[0].address} len={8} /> : <span className="text-faint">—</span>}
          </PanelRow>
        </Panel>
      </div>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label={t("page_token.eyebrow")}>
        {TABS.map((tb) => {
          const active = tb === tab;
          return (
            <a
              key={tb}
              href={`/token/${id}?tab=${tb}`}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
                active
                  ? "bg-violet text-white"
                  : "border border-line bg-[var(--card)] text-muted hover:border-violet/40 hover:text-ink"
              }`}
            >
              {tabLabel[tb]}
              {counts[tb] != null && (
                <span className={`tnum ml-1.5 text-[11px] ${active ? "text-white/70" : "text-faint"}`}>
                  {num(counts[tb]!)}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      {tab === "transfers" && (
        <TransfersTable rows={transfers} symbol={token.symbol} decimals={token.decimals} t={t} />
      )}

      {tab === "holders" && (
        <HoldersTable rows={holders} symbol={token.symbol} decimals={token.decimals} total={token.holders} t={t} />
      )}

      {tab === "contract" && <ContractPanel token={token} t={t} />}

      {tab === "analysis" && (
        <AnalysisPanel rows={holders} total={token.holders} symbol={token.symbol} decimals={token.decimals} t={t} />
      )}
    </div>
  );
}

type T = (k: string, v?: Record<string, string | number>) => string;

function TransfersTable({
  rows,
  symbol,
  decimals,
  t,
}: {
  rows: Tx[];
  symbol: string;
  decimals: number;
  t: T;
}) {
  return (
    <div className="card mt-5 p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <span className="text-[12.5px] text-muted">
          {t("page_token.summaryTransfers", { n: num(rows.length) })
            .split(/(\d[\d.,]*)/)
            .map((part, i) =>
              /^\d/.test(part) ? <b key={i} className="tnum text-ink">{part}</b> : <span key={i}>{part}</span>,
            )}
        </span>
      </div>
      <div className="overflow-x-auto p-5">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left">
              <Th>{t("page_token.colHash")}</Th>
              <Th>{t("page_token.colBlock")}</Th>
              <Th>{t("page_token.colAge")}</Th>
              <Th>{t("page_token.colFrom")}</Th>
              <Th>{t("page_token.colTo")}</Th>
              <Th>{t("page_token.colAmount", { symbol })}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  {t("page_token.noTransfers")}
                </td>
              </tr>
            ) : (
              rows.map((tx) => (
                <tr key={tx.id} className="border-b border-line/40 hover:bg-line/30">
                  <td className="py-2.5">
                    <TxLink id={tx.id} len={8} />
                  </td>
                  <td>{tx.blockHeight != null ? <BlockLink height={tx.blockHeight} /> : <span className="text-faint">—</span>}</td>
                  <td className="whitespace-nowrap text-muted">
                    <Ago ts={tx.timestamp} />
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <AddrLink addr={tx.from} len={6} />
                      <Copy text={tx.from} icon />
                    </span>
                  </td>
                  <td>
                    {tx.to ? (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <AddrLink addr={tx.to} len={6} />
                        <Copy text={tx.to} icon />
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="tnum whitespace-nowrap font-semibold text-ink">
                    {fmtToken(tx.amount, decimals)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HoldersTable({
  rows,
  symbol,
  decimals,
  total,
  t,
}: {
  rows: TokenHolder[];
  symbol: string;
  decimals: number;
  total: number;
  t: T;
}) {
  return (
    <div className="card mt-5 p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <span className="text-[12.5px] text-muted">
          {t("page_token.summaryHolders", { n: num(total), shown: num(rows.length) })}
        </span>
      </div>
      <div className="overflow-x-auto p-5">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left">
              <Th>{t("page_token.colRank")}</Th>
              <Th>{t("page_token.colAddress")}</Th>
              <Th>{t("page_token.colBalance", { symbol })}</Th>
              <Th>{t("page_token.colShare")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted">
                  {t("page_token.noHolders")}
                </td>
              </tr>
            ) : (
              rows.map((h) => {
                const pct = h.shareBps / 100;
                return (
                  <tr key={h.address} className="border-b border-line/40 hover:bg-line/30">
                    <td className="tnum py-2.5 text-muted">{h.rank}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <AddrLink addr={h.address} len={10} />
                        <Copy text={h.address} icon />
                        {h.blacklisted && <span className="badge badge-red">{t("page_token.blacklisted")}</span>}
                      </span>
                    </td>
                    <td className="tnum whitespace-nowrap font-semibold text-ink">
                      {fmtToken(h.balance, decimals)}
                    </td>
                    <td className="min-w-[160px]">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--line-2)" }}>
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.max(pct, 0.4)}%`,
                              background: "linear-gradient(90deg,var(--teal),var(--violet))",
                            }}
                          />
                        </span>
                        <span className="tnum w-[52px] shrink-0 text-right text-[11.5px] text-muted">
                          {pct < 0.01 ? "<0,01" : pct.toFixed(2).replace(".", ",")}%
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Aba "Contrato". Num explorer de EVM esta aba existe para você LER o Solidity e
// descobrir se o dono pode congelar seu saldo. Aqui o token é nativo do protocolo:
// não há código arbitrário, e os mesmos poderes são campos de estado. Então em vez
// de despejar código-fonte, listamos diretamente o que o administrador pode fazer —
// que é a pergunta que a leitura do código tentaria responder.
function ContractPanel({
  token,
  t,
}: {
  token: NonNullable<Awaited<ReturnType<typeof getToken>>>;
  t: T;
}) {
  const blacklisted = Object.keys(token.blacklist ?? {}).filter((a) => token.blacklist![a]);
  const frozen = Object.entries(token.frozen ?? {}).filter(([, f]) => BigInt(f.amount ?? "0") > 0n);

  // Cada poder que o administrador REALMENTE tem sobre o seu saldo. `risk` marca os
  // que podem agir contra o holder — são os que merecem destaque, não os neutros.
  const powers = [
    { label: t("page_token.powerMint"), on: token.mintable, risk: true, note: t("page_token.powerMintNote") },
    { label: t("page_token.powerPause"), on: true, risk: true, note: t("page_token.powerPauseNote"), active: token.paused },
    { label: t("page_token.powerBlacklist"), on: true, risk: true, note: t("page_token.powerBlacklistNote"), count: blacklisted.length },
    { label: t("page_token.powerFreeze"), on: true, risk: true, note: t("page_token.powerFreezeNote"), count: frozen.length },
  ];

  return (
    <>
      <div className="card mt-5 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="icon-chip icon-chip-sm chip-green">
            <IconCheck size={13} />
          </span>
          <span className="font-display text-[15px] font-bold">{t("page_token.nativeTitle")}</span>
          <span className="badge badge-green">{t("page_token.nativeBadge")}</span>
        </div>
        <p className="mt-2 max-w-[86ch] text-[12.5px] leading-relaxed text-muted">
          {t("page_token.nativeNote")}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line/60 p-3">
            <div className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted">
              {t("page_token.implementation")}
            </div>
            <div className="mt-1 text-[13px] font-semibold text-ink">{t("page_token.implementationValue")}</div>
          </div>
          <div className="rounded-lg border border-line/60 p-3">
            <div className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted">
              {t("page_token.sourceOfTruth")}
            </div>
            <div className="mt-1 font-mono text-[13px] font-semibold text-ink">src/token/eav20.js</div>
          </div>
        </div>
      </div>

      <div className="card mt-4 p-0">
        <div className="border-b border-line px-5 py-3.5">
          <span className="font-display text-[13.5px] font-bold text-ink">{t("page_token.powersTitle")}</span>
          <p className="mt-1 max-w-[86ch] text-[12px] leading-relaxed text-faint">{t("page_token.powersNote")}</p>
        </div>
        <div className="px-5 py-1.5">
          {powers.map((p) => (
            <div key={p.label} className="flex items-start justify-between gap-4 border-b border-line/40 py-3 last:border-b-0">
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{p.label}</span>
                <span className="block text-[11.5px] leading-relaxed text-faint">{p.note}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {p.count != null && p.count > 0 && (
                  <span className="tnum badge badge-gold">{num(p.count)}</span>
                )}
                {p.active && <span className="badge badge-red">{t("page_token.powerActiveNow")}</span>}
                <span className={`badge ${p.on ? "badge-gold" : "badge-green"}`}>
                  {p.on ? <IconX size={11} /> : <IconCheck size={11} />}
                  {p.on ? t("page_token.powerYes") : t("page_token.powerNo")}
                </span>
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-line px-5 py-3.5 text-[12.5px]">
          <span className="text-muted">{t("page_token.adminIs")} </span>
          <AddrLink addr={token.owner} len={10} />
          <Copy text={token.owner} icon />
        </div>
      </div>

      {(blacklisted.length > 0 || frozen.length > 0) && (
        <div className="card mt-4 p-5">
          <span className="font-display text-[13.5px] font-bold text-ink">{t("page_token.restrictionsTitle")}</span>
          <div className="mt-3 space-y-2">
            {blacklisted.map((a) => (
              <div key={a} className="flex items-center justify-between gap-3 border-b border-line/40 py-2 last:border-b-0">
                <AddrLink addr={a} len={10} />
                <span className="badge badge-red">{t("page_token.blacklisted")}</span>
              </div>
            ))}
            {frozen.map(([a, f]) => (
              <div key={a} className="flex items-center justify-between gap-3 border-b border-line/40 py-2 last:border-b-0">
                <AddrLink addr={a} len={10} />
                <span className="flex items-center gap-2">
                  <span className="tnum text-[12.5px] text-ink">{fmtToken(f.amount, token.decimals)}</span>
                  <span className="badge badge-gold">{t("page_token.frozenUntil", { when: when(f.unlockAt) })}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function AnalysisPanel({
  rows,
  total,
  symbol,
  decimals,
  t,
}: {
  rows: TokenHolder[];
  total: number;
  symbol: string;
  decimals: number;
  t: T;
}) {
  // Concentração: soma de participação do topo. É a leitura que importa num token —
  // supply grande com 3 donos é um dado diferente de supply grande pulverizado.
  const bpsOf = (n: number) => rows.slice(0, n).reduce((a, h) => a + h.shareBps, 0) / 100;
  const top1 = bpsOf(1);
  const top10 = bpsOf(10);
  const top50 = bpsOf(50);
  const topBalance = rows[0]?.balance ?? "0";

  return (
    <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("page_token.top1")} value={`${top1.toFixed(2).replace(".", ",")}%`} />
        <Stat label={t("page_token.top10")} value={`${top10.toFixed(2).replace(".", ",")}%`} />
        <Stat label={t("page_token.top50")} value={`${top50.toFixed(2).replace(".", ",")}%`} />
        <Stat label={t("page_token.holders")} value={numCompact(total)} />
      </div>

      <div className="card mt-5 p-5">
        <h2 className="font-display text-[15px] font-bold">{t("page_token.concentrationTitle")}</h2>
        <p className="mt-1 max-w-[80ch] text-[12px] leading-relaxed text-faint">
          {t("page_token.concentrationNote")}
        </p>
        <div className="mt-4 space-y-3">
          {[
            { label: t("page_token.top1"), pct: top1 },
            { label: t("page_token.top10"), pct: top10 },
            { label: t("page_token.top50"), pct: top50 },
          ].map((b) => (
            <div key={b.label}>
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="font-mono uppercase tracking-wide text-muted">{b.label}</span>
                <span className="tnum font-semibold text-ink">{b.pct.toFixed(2).replace(".", ",")}%</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--line-2)" }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(b.pct, 100)}%`, background: "linear-gradient(90deg,var(--teal),var(--violet))" }}
                />
              </div>
            </div>
          ))}
        </div>
        {rows[0] && (
          <div className="mt-5 border-t border-line/60 pt-4 text-[12.5px]">
            <span className="text-muted">{t("page_token.largestHolder")} </span>
            <AddrLink addr={rows[0].address} len={10} />
            <span className="tnum ml-2 font-semibold text-ink">
              {fmtToken(topBalance, decimals)} {symbol}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

// Painel do topo: título com selo de ícone e uma pilha de linhas rótulo→valor.
// Os três têm a mesma altura via `h-full`, para a fileira ficar alinhada.
function Panel({
  title,
  icon,
  chip,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  chip: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card h-full p-0">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <span className={`icon-chip icon-chip-sm ${chip}`}>{icon}</span>
        <span className="font-display text-[13.5px] font-bold text-ink">{title}</span>
      </div>
      <div className="px-5 py-1.5">{children}</div>
    </div>
  );
}

function PanelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/40 py-2.5 last:border-b-0">
      <span className="font-mono shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-[12.5px] text-ink">{children}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="tnum mt-1.5 truncate text-[17px] font-bold text-ink">{value}</div>
    </div>
  );
}

function Yes({ on, t, invert = false }: { on: boolean; t: T; invert?: boolean }) {
  // `invert`: em "pausado", o estado bom é FALSO — a cor segue o significado, não o booleano.
  const good = invert ? !on : on;
  return (
    <span className={`badge ${good ? "badge-green" : "badge-gold"}`}>
      {on ? <IconCheck size={11} /> : <IconX size={11} />}
      {on ? t("page_token.yes") : t("page_token.no")}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-mono border-b border-line pb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
      {children}
    </th>
  );
}
