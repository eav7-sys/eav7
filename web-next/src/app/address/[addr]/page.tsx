import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAddress, getAddressTxs, getInternal, getAddressAnalysis, type Tx } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { AddrLink, BlockLink, TxLink } from "@/components/hash-link";
import { TxBadge } from "@/components/tx-badge";
import { TxValue } from "@/components/tx-value";
import { HoldingsPanel } from "@/components/address/holdings-panel";
import { Copy } from "@/components/ui/copy";
import { fmt, fmtCompact, fmtToken, when, whenUtc, ago, shortHash, num } from "@/lib/format";
import { IconValidator, IconAi, IconCheck, IconX } from "@/components/icons";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

const TABS = ["transactions", "transfers", "internal", "staking", "contract", "permissions", "analysis"] as const;
type Tab = (typeof TABS)[number];

// Duas listas com naturezas diferentes, como em qualquer explorer:
//   TRANSAÇÕES   → operações da moeda NATIVA (EAV7): transferir, stake, votar, contrato…
//   TRANSFERÊNCIAS → movimentação de ATIVOS emitidos na cadeia (EAV20 e EAV721).
const EAV20_TX = new Set(["TOKEN_TRANSFER", "TOKEN_TRANSFER_FROM", "TOKEN_MINT", "TOKEN_BURN"]);
const EAV721_TX = new Set(["NFT_TRANSFER", "NFT_MINT", "NFT_BURN"]);
const isAssetTx = (type: string) => EAV20_TX.has(type) || EAV721_TX.has(type);

// Operações que uma conta multisig pode executar via MULTISIG_PROPOSE/APPROVE.
// Espelha o despacho em src/core/state.js — manter em sincronia se um tipo for adicionado.
const MULTISIG_OPS = ["TRANSFER", "STAKE", "UNSTAKE", "TOKEN_TRANSFER", "NFT_TRANSFER", "PERMISSION_CHANGE"] as const;

// Linha rótulo/valor do cartão "Informações da conta" (padrão de explorer).
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/40 py-2 last:border-b-0">
      <span className="font-mono shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <span className="min-w-0 text-right text-[13px] text-ink">{children}</span>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ addr: string }>;
}): Promise<Metadata> {
  const { addr } = await params;
  const t = await getT();
  return { title: t("page_address.metaTitle", { addr: addr.slice(0, 12) }) };
}

// Cabeçalho de seção reutilizado por todas as abas.
function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <>
      {title && <h2 className="font-display mb-3 mt-8 text-[16px] font-bold">{title}</h2>}
      {children}
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-mono border-b border-line pb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
      {children}
    </th>
  );
}

function Empty({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="py-6 text-center text-muted">
        {children}
      </td>
    </tr>
  );
}

// Contraparte de uma linha: a PRÓPRIA conta aparece em texto simples (não faz sentido
// linkar para a página em que já se está); a outra ponta vira link. Ambas copiáveis.
function Party({ addr, self }: { addr: string | null; self: string }) {
  if (!addr) return <span className="text-faint">—</span>;
  const isSelf = addr === self;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {isSelf ? (
        <span className="font-mono text-[11.5px] text-muted">{shortHash(addr, 6, 4)}</span>
      ) : (
        <AddrLink addr={addr} len={6} />
      )}
      <Copy text={addr} icon />
    </span>
  );
}

// Destino efetivo de uma transação. Em EAVM_CALL o alvo é o CONTRATO, que viaja em
// `data.to` e não no campo `to` do protocolo — sem isto a coluna ficaria vazia
// justamente nas transações de contrato.
function destOf(tx: Tx): string | null {
  if (tx.to) return tx.to;
  const dataTo = tx.data?.to;
  return typeof dataTo === "string" ? dataTo : null;
}

// Grupo de filtros como links — o estado vive na URL, então a tabela continua
// renderizada no servidor e o filtro é compartilhável e navegável pelo histórico.
function Chips({
  addr,
  tab = "transfers",
  param,
  current,
  options,
  keep,
}: {
  addr: string;
  tab?: string;
  param: string;
  current: string;
  options: { v: string; label: string }[];
  keep: Record<string, string>;
}) {
  return (
    <div className="flex overflow-hidden rounded-full border border-line">
      {options.map((o) => {
        const qs = new URLSearchParams({ tab, ...keep, [param]: o.v });
        const active = current === o.v;
        return (
          <a
            key={o.v}
            href={`/address/${addr}?${qs}`}
            aria-current={active ? "true" : undefined}
            className={`px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
              active ? "bg-violet text-white" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </a>
        );
      })}
    </div>
  );
}

// Tabela de transações no formato de explorer: resumo no topo do card, depois
// Hash · Bloco · Idade · Tipo · De · Para · Valor · Resultado.
function TxTable({
  rows,
  self,
  summary,
  variant,
  filters,
  t,
}: {
  rows: Tx[];
  self: string;
  summary: string;
  /** `native` mostra Tipo e Resultado; `asset` mostra o Token e o valor com sinal. */
  variant: "native" | "asset";
  filters?: React.ReactNode;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const isAsset = variant === "asset";
  const cols = isAsset ? 7 : 8;
  return (
    <div className="card mt-5 p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <span className="text-[13px] text-muted">
          {/* Destaca o número sem injetar HTML: divide a frase traduzida no próprio
              número, preservando a ordem das palavras de cada idioma. */}
          {summary.split(/(\d[\d.,]*)/).map((part, i) =>
            /^\d/.test(part) ? (
              <b key={i} className="tnum text-ink">
                {part}
              </b>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </span>
        {filters}
      </div>
      <div className="overflow-x-auto p-5">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left">
              <Th>{t("page_address.colHash")}</Th>
              <Th>{t("page_address.colBlock")}</Th>
              <Th>{t("page_address.colAge")}</Th>
              {!isAsset && <Th>{t("page_address.colType")}</Th>}
              <Th>{t("page_address.colFrom")}</Th>
              <Th>{t("page_address.colTo")}</Th>
              <Th>{t("page_address.colValue")}</Th>
              {isAsset ? <Th>{t("page_address.colToken")}</Th> : <Th>{t("page_address.colResult")}</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((tx) => {
              const out = tx.from === self;
              // Ausência de recibo = tx não-EAVM, que por definição aplicou-se com sucesso.
              const ok = tx.receipt ? tx.receipt.success : true;
              return (
                <tr key={tx.id} className="border-b border-line/40 hover:bg-line/30">
                  <td className="py-2.5">
                    <TxLink id={tx.id} />
                  </td>
                  <td>
                    <BlockLink height={tx.blockHeight} />
                  </td>
                  <td className="whitespace-nowrap text-muted" title={when(tx.timestamp)}>
                    {ago(tx.timestamp)}
                  </td>
                  {!isAsset && (
                    <td>
                      <TxBadge type={tx.type} />
                    </td>
                  )}
                  <td>
                    <Party addr={tx.from} self={self} />
                  </td>
                  <td>
                    <Party addr={destOf(tx)} self={self} />
                  </td>
                  <td className={`tnum whitespace-nowrap font-semibold ${out ? "text-gold" : "text-green"}`}>
                    {isAsset ? (
                      // Valor com SINAL, na casa decimal do próprio ativo.
                      <>
                        {out ? "−" : "+"}
                        {tx.asset?.kind === "EAV721"
                          ? `#${tx.asset.tokenId}`
                          : fmtToken(tx.amount, tx.asset?.decimals ?? 0)}
                      </>
                    ) : (
                      <TxValue tx={tx} />
                    )}
                  </td>
                  {isAsset ? (
                    <td>
                      {tx.asset ? (
                        <a href={`/address/${tx.asset.id}`} className="inline-flex items-center gap-2">
                          <span className="font-mono rounded bg-violet/15 px-1.5 py-0.5 text-[10.5px] font-bold text-violet">
                            {tx.asset.symbol ?? tx.asset.kind}
                          </span>
                          <span className="font-mono text-[11px] text-muted">{shortHash(tx.asset.id, 6, 4)}</span>
                        </a>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  ) : (
                    <td>
                      <span className={`badge ${ok ? "badge-green" : "badge-gold"}`}>
                        {ok ? <IconCheck size={11} /> : <IconX size={11} />}
                        {ok ? t("page_address.resultOk") : t("page_address.resultRevert")}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && <Empty cols={cols}>{t("page_address.noTxs")}</Empty>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Par rótulo/valor das abas de dados.
function Stat({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="card p-4">
      <div className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1.5 text-[17px] font-bold text-ink ${mono ? "tnum" : ""}`}>{value}</div>
    </div>
  );
}

export default async function AddressPage({
  params,
  searchParams,
}: {
  params: Promise<{ addr: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = await getT();
  const { addr } = await params;
  const sp = await searchParams;
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "transactions";

  const info = await getAddress(addr).catch(() => null);
  if (!info || info.error || !info.address) notFound();

  const self = info.address;

  // Cada aba busca só o que precisa — nada de carregar 1000 txs para ver permissões.
  const [txr, internalRes, analysis] = await Promise.all([
    tab === "transactions" || tab === "transfers" || tab === "contract"
      ? getAddressTxs(addr, 1000).catch(() => ({ txs: [] }))
      : Promise.resolve({ txs: [] }),
    tab === "internal" ? getInternal({ address: self, limit: 500 }) : Promise.resolve({ internal: [] }),
    tab === "analysis" ? getAddressAnalysis(addr) : Promise.resolve(null),
  ]);

  const txs = txr.txs ?? [];
  const internal = internalRes.internal ?? [];
  const votes = BigInt(info.votes ?? "0");
  // Filtros das abas, via URL (server-rendered, sem JS no cliente).
  const dir = (Array.isArray(sp.dir) ? sp.dir[0] : sp.dir) ?? "all";
  const std = (Array.isArray(sp.std) ? sp.std[0] : sp.std) ?? "all";
  const st = (Array.isArray(sp.st) ? sp.st[0] : sp.st) ?? "staked";

  const transactions = txs.filter((x) => !isAssetTx(x.type));
  const allTransfers = txs.filter((x) => isAssetTx(x.type));
  const transfers = allTransfers
    .filter((x) => (std === "all" ? true : std === "eav20" ? EAV20_TX.has(x.type) : EAV721_TX.has(x.type)))
    .filter((x) => (dir === "all" ? true : dir === "out" ? x.from === self : x.to === self));
  const act = info.activity;

  // --- Staking: cada sub-visão vem de uma parte diferente do estado da conta.
  // Um único stake concede energia E banda ao mesmo tempo (ver `stakeNote`), então
  // as duas linhas de recurso são lastreadas pelo MESMO valor em stake.
  const stakedRows =
    BigInt(info.staked ?? "0") > 0n
      ? [
          { label: t("page_address.energy"), available: info.energy.available, max: info.energy.max },
          ...(info.bandwidth
            ? [{ label: t("page_address.bandwidth"), available: info.bandwidth.available, max: info.bandwidth.max }]
            : []),
        ]
      : [];
  const unbondingRows = info.unbonding ?? [];
  const delegations = info.resources?.delegations ?? [];
  const delegOut = delegations.filter((d) => d.from === self);
  const delegIn = delegations.filter((d) => d.to === self);

  // Contratos PUBLICADOS por esta conta: deploys bem-sucedidos, cujo endereço vem
  // do recibo de execução (é derivado na VM, não existe na transação assinada).
  const published = txs
    .filter((x) => x.type === "EAVM_DEPLOY" && x.receipt?.contract)
    .map((x) => ({ address: x.receipt!.contract as string, createdAt: x.timestamp }));
  // Tipo de conta: contrato e multisig têm precedência (dizem mais sobre a conta).
  const role = info.contract
    ? t("page_address.roleContract")
    : info.permissions
      ? t("page_address.roleMultisig")
      : info.isValidator
        ? t("page_address.roleValidator")
        : info.oracle
          ? t("page_address.roleOracle")
          : t("page_address.roleAccount");

  // Contadores nas abas — só quando conhecidos nesta requisição (a aba busca seu dado).
  const loadedTxs = tab === "transactions" || tab === "transfers" || tab === "contract";
  const counts: Partial<Record<Tab, number>> = {
    transactions: loadedTxs ? transactions.length : act?.txCount,
    transfers: loadedTxs ? allTransfers.length : undefined,
    internal: tab === "internal" ? internal.length : undefined,
  };

  const tabLabel: Record<Tab, string> = {
    transactions: t("page_address.tabTransactions"),
    transfers: t("page_address.tabTransfers"),
    internal: t("page_address.tabInternal"),
    staking: t("page_address.tabStaking"),
    contract: t("page_address.tabContract"),
    permissions: t("page_address.tabPermissions"),
    analysis: t("page_address.tabAnalysis"),
  };

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <PageHeader
        eyebrow={t("page_address.eyebrow")}
        title={t("page_address.title")}
        sub={info.address}
        copySub={info.address}
        badges={
          <>
            <span className="badge badge-violet">
              {info.isValidator ? <IconValidator size={12} /> : info.oracle ? <IconAi size={12} /> : null}
              {role}
            </span>
            {info.feeExempt && <span className="badge badge-green">{t("page_address.feeExempt")}</span>}
            {info.commission != null && (
              <span className="badge">
                {t("page_address.commissionLabel")} <span className="ml-1 text-ink">{info.commission}%</span>
              </span>
            )}
          </>
        }
        aside={
          <div className="flex gap-8">
            {[
              { label: t("page_address.lastSeen"), value: whenUtc(act?.lastSeen) },
              { label: t("page_address.createdAt"), value: whenUtc(act?.firstSeen) },
            ].map((c) => (
              <div key={c.label} className="text-right">
                <div className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted">
                  {c.label} <span className="text-faint">(UTC)</span>
                </div>
                <div className="tnum font-mono mt-0.5 text-[12.5px] text-ink">{c.value}</div>
              </div>
            ))}
          </div>
        }
      />

      {/* Bloco de topo no padrão de explorer: painel de Ativos | painel de participações */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---- Ativos: resumo da conta em linhas rótulo/valor ---- */}
        <div className="card card-glow p-6">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="font-display text-[17px] font-bold">{t("page_address.assets")}</span>
            <span className="tnum font-display text-[22px] font-extrabold" title={`${fmt(info.balance)} EAV7`}>
              {fmtCompact(info.balance)} <span className="text-[13px] font-semibold text-muted">EAV7</span>
            </span>
          </div>

          <Row label={t("page_address.available")}>
            <span className="tnum">{fmt(info.balance)} EAV7</span>
          </Row>
          <Row label={t("page_address.staked")}>
            <span className="tnum">{fmt(info.staked)} EAV7</span>
          </Row>
          <Row label={t("page_address.totalTxs")}>
            <span className="tnum">
              {num(act?.txCount ?? 0)}
              {act?.truncated ? "+" : ""}
            </span>
          </Row>
          <Row label={t("page_address.transfersRow")}>
            <span className="tnum inline-flex items-baseline gap-2">
              {num(act?.transfers ?? 0)}
              <span className="text-[12px] text-faint">
                (<span className="text-green">↓ {num(act?.transfersIn ?? 0)}</span>
                {" · "}
                <span className="text-gold">↑ {num(act?.transfersOut ?? 0)}</span>)
              </span>
            </span>
          </Row>
          <Row label={t("page_address.energy")}>
            <span className="tnum">
              {t("page_address.available")}: {num(info.energy.available)} / {num(info.energy.max)}
            </span>
          </Row>
          {info.bandwidth && (
            <Row label={t("page_address.bandwidth")}>
              <span className="tnum">
                {t("page_address.available")}: {num(info.bandwidth.available)} / {num(info.bandwidth.max)}
              </span>
            </Row>
          )}
          <Row label={t("page_address.votesRow")}>
            <span className="tnum">
              {fmtCompact((info.votedTotal ?? "0").toString())} / {fmtCompact(votes.toString())}
            </span>
          </Row>
          <Row label={t("page_address.claimable")}>
            <span className="tnum">{fmt(info.claimableVoterReward ?? "0")} EAV7</span>
          </Row>

          {info.eavmAddress && (
            <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-3">
              <span className="font-mono text-[11px] text-faint">0x</span>
              <span className="font-mono break-all text-[11px] text-ink">{info.eavmAddress}</span>
              <Copy text={info.eavmAddress} />
            </div>
          )}
        </div>

        {/* ---- Participações: abas próprias + busca (filtro instantâneo no cliente) ---- */}
        <HoldingsPanel info={info} />
      </div>

      {/* Abas — navegação por URL (renderizadas no servidor, sem JS no cliente) */}
      <nav className="mt-8 flex flex-wrap gap-2" aria-label={t("page_address.title")}>
        {TABS.map((tb) => {
          const active = tb === tab;
          return (
            <a
              key={tb}
              href={`/address/${addr}?tab=${tb}`}
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

      {/* ---------- VISÃO GERAL: participações (tokens, NFTs, nomes) ---------- */}
      {/* ---------- TRANSAÇÕES (moeda nativa EAV7) ---------- */}
      {tab === "transactions" && (
        <TxTable
          rows={transactions}
          self={self}
          variant="native"
          summary={t("page_address.summaryTx", { n: num(transactions.length) })}
          t={t}
        />
      )}

      {/* ---------- TRANSFERÊNCIAS (ativos emitidos: EAV20 / EAV721) ---------- */}
      {tab === "transfers" && (
        <TxTable
          rows={transfers}
          self={self}
          variant="asset"
          summary={t("page_address.summaryTokenTx", { n: num(transfers.length) })}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              <Chips
                addr={addr}
                param="dir"
                current={dir}
                options={[
                  { v: "all", label: t("page_address.filterAll") },
                  { v: "in", label: `↓ ${t("page_address.filterIn")}` },
                  { v: "out", label: `↑ ${t("page_address.filterOut")}` },
                ]}
                keep={{ std }}
              />
              <Chips
                addr={addr}
                param="std"
                current={std}
                options={[
                  { v: "all", label: t("page_address.filterAll") },
                  { v: "eav20", label: "EAV20" },
                  { v: "eav721", label: "EAV721" },
                ]}
                keep={{ dir }}
              />
            </div>
          }
          t={t}
        />
      )}

      {/* ---------- TRANSFERÊNCIAS INTERNAS ---------- */}
      {tab === "internal" && (
        <div className="card mt-5 p-0">
          <div className="border-b border-line px-5 py-3.5">
            <span className="text-[13px] text-muted">
              {t("page_address.summaryInternal", { n: num(internal.length) })
                .split(/(\d[\d.,]*)/)
                .map((p, i) => (/^\d/.test(p) ? <b key={i} className="tnum text-ink">{p}</b> : <span key={i}>{p}</span>))}
            </span>
            <p className="mt-1 max-w-[80ch] text-[12px] leading-relaxed text-faint">
              {t("page_address.internalNote")}
            </p>
          </div>
          <div className="overflow-x-auto p-5">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left">
                  <Th>{t("page_address.colParentHash")}</Th>
                  <Th>{t("page_address.colBlock")}</Th>
                  <Th>{t("page_address.colAge")}</Th>
                  <Th>{t("page_address.colType")}</Th>
                  <Th>{t("page_address.colFrom")}</Th>
                  <Th>{t("page_address.colTo")}</Th>
                  <Th>{t("page_address.colValue")}</Th>
                  <Th>{t("page_address.colResult")}</Th>
                </tr>
              </thead>
              <tbody>
                {internal.map((x, i) => {
                  const out = x.fromE7 === self;
                  return (
                    <tr key={`${x.txId}-${i}`} className="border-b border-line/40 hover:bg-line/30">
                      <td className="py-2.5">
                        <TxLink id={x.txId} />
                      </td>
                      <td>
                        <BlockLink height={x.blockHeight} />
                      </td>
                      <td className="whitespace-nowrap text-muted" title={x.blockTime ? when(x.blockTime) : undefined}>
                        {x.blockTime ? ago(x.blockTime) : "—"}
                      </td>
                      <td>
                        <span className="font-mono rounded bg-teal/15 px-1.5 py-0.5 text-[10.5px] font-bold text-teal">
                          {x.kind}
                        </span>
                      </td>
                      <td>
                        <Party addr={x.fromE7} self={self} />
                      </td>
                      <td>
                        <Party addr={x.toE7} self={self} />
                      </td>
                      <td className={`tnum whitespace-nowrap font-semibold ${out ? "text-gold" : "text-green"}`}>
                        {out ? "−" : "+"}
                        {fmt(x.amount)} EAV7
                      </td>
                      <td>
                        {/* Só execução BEM-SUCEDIDA emite transferência interna — uma
                            chamada revertida não deixa registro (ver testes 2.3). */}
                        <span className="badge badge-green">
                          <IconCheck size={11} />
                          {t("page_address.resultOk")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {internal.length === 0 && <Empty cols={8}>{t("page_address.internalEmpty")}</Empty>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- STAKING E RECURSOS ---------- */}
      {tab === "staking" && (
        <div className="card mt-5 p-0">
          <div className="flex flex-wrap items-center justify-end gap-2 border-b border-line px-5 py-3.5">
            <Chips
              addr={addr}
              tab="staking"
              param="st"
              current={st}
              options={[
                { v: "staked", label: `${t("page_address.staked")} (${stakedRows.length})` },
                { v: "unbonding", label: `${t("page_address.unbondingTitle")} (${unbondingRows.length})` },
                { v: "delegout", label: `${t("page_address.delegatedOut")} (${delegOut.length})` },
                { v: "delegin", label: `${t("page_address.delegatedIn")} (${delegIn.length})` },
              ]}
              keep={{}}
            />
          </div>
          <div className="overflow-x-auto p-5">
            {st === "staked" && (
              <>
                <p className="mb-3 max-w-[80ch] text-[12px] leading-relaxed text-faint">
                  {t("page_address.stakeNote")}
                </p>
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left">
                      <Th>{t("page_address.colType")}</Th>
                      <Th>{t("page_address.colResourceAmount")}</Th>
                      <Th>{t("page_address.colStakedAmount")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {stakedRows.map((r) => (
                      <tr key={r.label} className="border-b border-line/40">
                        <td className="py-2.5 font-semibold text-ink">{r.label}</td>
                        <td className="tnum">
                          {num(r.available)} / {num(r.max)}
                        </td>
                        <td className="tnum">{fmt(info.staked)} EAV7</td>
                      </tr>
                    ))}
                    {stakedRows.length === 0 && <Empty cols={3}>{t("page_address.noHoldings")}</Empty>}
                  </tbody>
                </table>
              </>
            )}

            {st === "unbonding" && (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left">
                    <Th>{t("page_address.colValue")}</Th>
                    <Th>{t("page_address.colBlock")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {unbondingRows.map((u, i) => (
                    <tr key={i} className="border-b border-line/40">
                      <td className="tnum py-2.5 font-semibold text-ink">{fmt(u.amount)} EAV7</td>
                      <td className="text-muted">{t("page_address.matureIn", { n: num(u.blocksLeft) })}</td>
                    </tr>
                  ))}
                  {unbondingRows.length === 0 && <Empty cols={2}>{t("page_address.noHoldings")}</Empty>}
                </tbody>
              </table>
            )}

            {(st === "delegout" || st === "delegin") && (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left">
                    <Th>{st === "delegout" ? t("page_address.colTo") : t("page_address.colFrom")}</Th>
                    <Th>{t("page_address.colValue")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {(st === "delegout" ? delegOut : delegIn).map((d, i) => (
                    <tr key={i} className="border-b border-line/40">
                      <td className="py-2.5">
                        <Party addr={st === "delegout" ? d.to : d.from} self={self} />
                      </td>
                      <td className="tnum">{fmt(d.amount)} EAV7</td>
                    </tr>
                  ))}
                  {(st === "delegout" ? delegOut : delegIn).length === 0 && (
                    <Empty cols={2}>{t("page_address.noHoldings")}</Empty>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ---------- CONTRATOS PUBLICADOS ---------- */}
      {tab === "contract" && (
        <div className="card mt-5 p-0">
          <div className="border-b border-line px-5 py-3.5 text-[13px] text-muted">
            {t("page_address.summaryContracts", { n: num(published.length) })
              .split(/(\d[\d.,]*)/)
              .map((p, i) => (/^\d/.test(p) ? <b key={i} className="tnum text-ink">{p}</b> : <span key={i}>{p}</span>))}
          </div>
          <div className="overflow-x-auto p-5">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left">
                  <Th>{t("page_address.colHash")}</Th>
                  <Th>{t("page_address.createdAt")}</Th>
                  <Th>{t("page_address.colResult")}</Th>
                  <Th>{t("page_address.colBalance")}</Th>
                </tr>
              </thead>
              <tbody>
                {published.map((c) => (
                  <tr key={c.address} className="border-b border-line/40 hover:bg-line/30">
                    <td className="py-2.5">
                      <Party addr={c.address} self={self} />
                    </td>
                    <td className="tnum whitespace-nowrap text-muted">{whenUtc(c.createdAt)}</td>
                    <td>
                      <span className="badge badge-green">
                        <IconCheck size={11} />
                        {t("page_address.resultOk")}
                      </span>
                    </td>
                    <td className="tnum text-muted">
                      <a href={`/address/${c.address}`} className="text-violet">
                        {t("page_address.tabContract")}
                      </a>
                    </td>
                  </tr>
                ))}
                {published.length === 0 && <Empty cols={4}>{t("page_address.contractNone")}</Empty>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- PERMISSÕES ---------- */}
      {tab === "permissions" && (
        <div className="card mt-5 p-6">
          {info.permissions ? (
            <>
              <div className="mb-1 flex items-center gap-2">
                <h3 className="font-display text-[15px] font-bold">{t("page_address.tabPermissions")}</h3>
                {info.permissions.default && (
                  <span className="badge">{t("page_address.permsDefault")}</span>
                )}
              </div>
              <p className="mb-4 max-w-[80ch] text-[12px] leading-relaxed text-faint">
                {info.permissions.default ? t("page_address.permsDefaultNote") : t("page_address.permsNote")}
              </p>
              {!info.permissions.default && (
              <Row label={t("page_address.permsOperations")}>
                <span className="flex flex-wrap justify-end gap-1.5">
                  {MULTISIG_OPS.map((op) => (
                    <span key={op} className="badge">
                      {op}
                    </span>
                  ))}
                </span>
              </Row>
              )}
              <Row label={t("page_address.permsThreshold")}>
                <span className="tnum">{num(info.permissions.threshold ?? 0)}</span>
              </Row>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left">
                      <Th>{t("page_address.colKey")}</Th>
                      <Th>{t("page_address.colWeight")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(info.permissions.keys ?? []).map((k) => (
                      <tr key={k.address} className="border-b border-line/40">
                        <td className="py-2.5">
                          <span className="inline-flex items-center gap-2">
                            <Party addr={k.address} self={self} />
                            {k.address === self && (
                              <span className="text-[11px] text-faint">({t("page_address.thisAccount")})</span>
                            )}
                          </span>
                        </td>
                        <td className="tnum">{k.weight}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="py-6 text-center text-[13px] text-muted">{t("page_address.permsNone")}</p>
          )}
        </div>
      )}


      {/* ---------- ANÁLISE ---------- */}
      {tab === "analysis" && (
        <Section>
          {analysis ? (
            <>
              <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label={t("page_address.txCount")} value={num(analysis.txCount)} />
                <Stat label={t("page_address.sent")} value={`${fmtCompact(analysis.sent)} EAV7`} />
                <Stat label={t("page_address.received")} value={`${fmtCompact(analysis.received)} EAV7`} />
                <Stat label={t("page_address.feesPaid")} value={`${fmt(analysis.feesPaid)} EAV7`} />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Stat label={t("page_address.firstSeen")} value={analysis.firstSeen ? when(analysis.firstSeen) : "—"} />
                <Stat label={t("page_address.lastSeen")} value={analysis.lastSeen ? when(analysis.lastSeen) : "—"} />
              </div>

              <Section title={t("page_address.byType")}>
                <div className="card p-5">
                  <div className="flex flex-col gap-2">
                    {Object.entries(analysis.byType)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => {
                        const max = Math.max(...Object.values(analysis.byType), 1);
                        return (
                          <div key={type} className="flex items-center gap-3">
                            <div className="w-[190px] shrink-0">
                              <TxBadge type={type as never} />
                            </div>
                            <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--line-2)" }}>
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${(count / max) * 100}%`, background: "linear-gradient(90deg,var(--teal),var(--violet))" }}
                              />
                            </div>
                            <span className="tnum w-12 shrink-0 text-right text-[12px] text-muted">{num(count)}</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </Section>

              {analysis.topCounterparties.length > 0 && (
                <Section title={t("page_address.topCounterparties")}>
                  <div className="card overflow-x-auto p-5">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-left">
                          <Th>{t("page_address.colCounterparty")}</Th>
                          <Th>{t("page_address.txCount")}</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.topCounterparties.map((c) => (
                          <tr key={c.address} className="border-b border-line/40">
                            <td className="py-2.5">
                              <AddrLink addr={c.address} len={10} />
                            </td>
                            <td className="tnum">{num(c.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {analysis.truncated && (
                <p className="mt-3 font-mono text-[11px] text-faint">{t("page_address.truncatedNote")}</p>
              )}
            </>
          ) : (
            <p className="mt-8 text-center text-[13px] text-muted">{t("page_address.noData")}</p>
          )}
        </Section>
      )}
    </div>
  );
}
