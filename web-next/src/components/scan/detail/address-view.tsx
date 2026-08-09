import Link from "next/link";
import type { AddressAnalysis, AddressInfo, InternalTransfer, Tx, VerifiedContract } from "@/lib/api";
import { Copy } from "@/components/ui/copy";
import { TxBadge } from "@/components/tx-badge";
import { ago, fmt, fmtCompact, fmtToken, num, shortHash, when, whenUtc } from "@/lib/format";
import { ScanTabs, type TabDef } from "./tabs";
import { AddressHoldings, type HoldingGroup } from "./address-holdings";
import { CsvButton } from "./csv-button";
import {
  Amount,
  destOf,
  DetailPage,
  EmptyRow,
  Empty,
  Glass,
  ResultBadge,
  SideRow,
  TabPanel,
  avatarBg,
  initials,
  txOk,
  type T,
} from "./shell";

export const ADDRESS_TABS = [
  "txs",
  "transfers",
  "internal",
  "stake",
  "contracts",
  "perm",
  "analysis",
] as const;
export type AddressTab = (typeof ADDRESS_TABS)[number];

// Duas naturezas distintas, como em qualquer explorador:
//   TRANSAÇÕES     → operações da moeda NATIVA (transferir, stake, votar, chamar…)
//   TRANSFERÊNCIAS → movimentação de ATIVOS emitidos na cadeia (EAV20 / EAV721)
const EAV20_TX = new Set(["TOKEN_TRANSFER", "TOKEN_TRANSFER_FROM", "TOKEN_MINT", "TOKEN_BURN"]);
const EAV721_TX = new Set(["NFT_TRANSFER", "NFT_MINT", "NFT_BURN"]);
const ehAtivo = (tipo: string) => EAV20_TX.has(tipo) || EAV721_TX.has(tipo);

/** Selo ENTRA/SAI da linha, relativo à conta que está sendo vista. */
function Direcao({ saiu, t }: { saiu: boolean; t: T }) {
  return (
    <span className={`badge ${saiu ? "badge-gold" : "badge-green"}`}>
      {saiu ? `↑ ${t("scan_detail.dirOut")}` : `↓ ${t("scan_detail.dirIn")}`}
    </span>
  );
}

/** A própria conta em texto simples (linkar para onde já se está não ajuda ninguém). */
function Parte({ addr, self }: { addr: string | null; self: string }) {
  if (!addr) return <span className="text-faint">—</span>;
  if (addr === self) return <span className="font-mono text-muted">{shortHash(addr, 6, 4)}</span>;
  return (
    <Link href={`/address/${addr}`} className="font-mono text-violet hover:underline">
      {shortHash(addr, 6, 4)}
    </Link>
  );
}

/** Grupo de filtros como LINKS: o estado mora na URL, então continua renderizado
 *  no servidor, é compartilhável e o histórico do navegador funciona. */
function Filtros({
  atual,
  opcoes,
  rotulo,
}: {
  atual: string;
  opcoes: { v: string; label: string; href: string }[];
  rotulo: string;
}) {
  return (
    <div className="scan-input flex gap-0.5 p-[3px]" role="group" aria-label={rotulo}>
      {opcoes.map((o) => {
        const ativo = o.v === atual;
        return (
          <Link
            key={o.v}
            href={o.href}
            scroll={false}
            aria-current={ativo ? "true" : undefined}
            className={`rounded-lg px-3 py-1 text-[12px] font-semibold ${
              ativo ? "bg-[var(--scan-chip)] text-violet" : "text-faint hover:text-ink"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

function Cartao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Glass className="px-6 py-5">
      <div className="font-mono mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{titulo}</div>
      {children}
    </Glass>
  );
}

/**
 * Tela de ENDEREÇO — a maior das quatro, com sete abas.
 *
 * Omitido do desenho por falta de dado real: o total em dólar e os valores em USD
 * da carteira (a EAV7 não publica preço), o botão "acompanhar" (o explorador não
 * tem contas), a aba "DeFi", o padrão "EAV1155" (não existe no protocolo) e o APR
 * do validador votado. Cada um deles seria um número plausível e falso.
 */
export function AddressView({
  info,
  txs,
  internal,
  analysis,
  contract,
  tab,
  dir,
  std,
  t,
}: {
  info: AddressInfo;
  txs: Tx[];
  internal: InternalTransfer[];
  analysis: AddressAnalysis | null;
  contract: VerifiedContract | null;
  tab: AddressTab;
  dir: string;
  std: string;
  t: T;
}) {
  const self = info.address;
  const at = info.activity;

  const transacoes = txs.filter((x) => !ehAtivo(x.type));
  const todasTransferencias = txs.filter((x) => ehAtivo(x.type));
  const transferencias = todasTransferencias
    .filter((x) => (std === "all" ? true : std === "eav20" ? EAV20_TX.has(x.type) : EAV721_TX.has(x.type)))
    .filter((x) => (dir === "all" ? true : dir === "out" ? x.from === self : x.to === self));

  // Contratos publicados por esta conta: o endereço nasce na VM e só existe no
  // recibo — não está na transação assinada.
  const publicados = txs
    .filter((x) => x.type === "EAVM_DEPLOY" && x.receipt?.contract)
    .map((x) => ({ address: x.receipt!.contract as string, createdAt: x.timestamp }));

  const carregouTxs = tab === "txs" || tab === "transfers" || tab === "contracts";
  const url = (id: string) => `/address/${encodeURIComponent(self)}?tab=${id}`;
  const abas: TabDef[] = [
    { id: "txs", label: t("scan_detail.tabTxs"), href: url("txs"), count: carregouTxs ? transacoes.length : at?.txCount },
    { id: "transfers", label: t("scan_detail.tabTransfers"), href: url("transfers"), count: carregouTxs ? todasTransferencias.length : at?.transfers },
    { id: "internal", label: t("scan_detail.tabInternal"), href: url("internal"), count: tab === "internal" ? internal.length : undefined },
    { id: "stake", label: t("scan_detail.tabStake"), href: url("stake") },
    { id: "contracts", label: t("scan_detail.tabContracts"), href: url("contracts") },
    { id: "perm", label: t("scan_detail.tabPerm"), href: url("perm") },
    { id: "analysis", label: t("scan_detail.tabAnalysis"), href: url("analysis") },
  ];

  // Participações do cartão da direita, todas com a casa decimal do próprio ativo.
  const grupos: HoldingGroup[] = [
    {
      id: "tokens",
      label: t("scan_detail.tokens"),
      items: Object.entries(info.tokens ?? {}).map(([id, tk]) => ({
        key: id,
        name: tk.name ?? tk.symbol ?? shortHash(id, 8, 4),
        sub: tk.symbol ?? shortHash(id, 8, 4),
        amount: fmtToken(tk.balance ?? "0", tk.decimals ?? 0),
        href: `/token/${id}`,
      })),
    },
    {
      id: "nfts",
      label: "NFTs",
      items: (info.nfts ?? []).map((n) => ({
        key: `${n.collection}-${n.tokenId}`,
        name: `${n.symbol} #${n.tokenId}`,
        sub: shortHash(n.collection, 10, 6),
        amount: "1",
        href: `/address/${n.collection}`,
      })),
    },
    {
      id: "approvals",
      label: t("scan_detail.approvals"),
      items: (info.approvals ?? []).map((a, i) => ({
        key: `${a.token}-${a.spender}-${i}`,
        name: a.symbol ?? shortHash(a.token, 8, 4),
        sub: `→ ${shortHash(a.spender, 8, 6)}`,
        amount: a.amount,
        href: `/token/${a.token}`,
      })),
    },
    {
      id: "names",
      label: t("scan_detail.names"),
      items: (info.names ?? []).map((n) => ({
        key: n.name,
        name: n.name,
        sub: shortHash(n.target, 10, 6),
        amount: "—",
      })),
    },
  ];

  const nome = info.names?.[0]?.name;
  const painel = "addr-panel";

  return (
    <DetailPage wide>
      {/* ---- Identidade ---- */}
      <div className="mb-6 flex items-center gap-4">
        <span
          aria-hidden
          className="size-[52px] shrink-0 rounded-2xl"
          style={{ background: avatarBg(self) }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[20px] font-extrabold tracking-tight text-ink">
              {t("scan_detail.adTitle")}
            </h1>
            {nome ? <span className="badge badge-violet">{nome}</span> : null}
            {info.isValidator ? <span className="badge badge-blue">{t("scan_detail.roleValidator")}</span> : null}
            {info.contract ? <span className="badge badge-teal">{t("scan_detail.roleContract")}</span> : null}
            {info.oracle ? <span className="badge badge-violet">{t("scan_detail.roleOracle")}</span> : null}
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-2.5">
            <span className="font-mono truncate text-[13px] text-muted" title={self}>
              {self}
            </span>
            <Copy text={self} icon />
          </div>
          {info.eavmAddress ? (
            <div className="font-mono mt-1 flex min-w-0 items-center gap-2 text-[11.5px] text-faint">
              <span className="truncate">{info.eavmAddress}</span>
              <Copy text={info.eavmAddress} icon />
            </div>
          ) : null}
        </div>
      </div>

      {/* ---- Ativos | Participações ---- */}
      <div className="scan-split">
        <Glass className="px-6 py-4">
          <div className="flex items-baseline justify-between gap-3 pb-3">
            <span className="font-display text-[15px] font-extrabold text-ink">{t("scan_detail.assets")}</span>
            {/* O desenho traz o total em dólar; a EAV7 não publica preço, então o
                número grande é o SALDO real em EAV7. */}
            <span className="tnum font-display text-[22px] font-extrabold text-ink" title={`${fmt(info.balance)} EAV7`}>
              {fmtCompact(info.balance)} <span className="text-[13px] text-muted">EAV7</span>
            </span>
          </div>
          <SideRow label={t("scan_detail.available")}>
            <span className="tnum">{fmt(info.balance)} EAV7</span>
          </SideRow>
          <SideRow label={t("scan_detail.staked")}>
            <span className="tnum">{fmt(info.staked)} EAV7</span>
          </SideRow>
          <SideRow label={t("scan_detail.txCount")}>
            <span className="tnum">
              {num(at?.txCount ?? 0)}
              {at?.truncated ? "+" : ""}
            </span>
          </SideRow>
          <SideRow label={t("scan_detail.transfersRow")}>
            <span className="tnum">
              {num(at?.transfers ?? 0)}{" "}
              <span className="text-[12px] font-normal text-faint">
                (<span className="text-ok">↓ {num(at?.transfersIn ?? 0)}</span> ·{" "}
                <span className="text-gold">↑ {num(at?.transfersOut ?? 0)}</span>)
              </span>
            </span>
          </SideRow>
          <SideRow label={`⚡ ${t("scan_detail.energy")}`}>
            <span className="tnum">
              <span className="font-normal text-faint">{t("scan_detail.availCap")}:</span> {num(info.energy.available)} /{" "}
              {num(info.energy.max)}
            </span>
          </SideRow>
          {info.bandwidth ? (
            <SideRow label={`↔ ${t("scan_detail.bandwidth")}`}>
              <span className="tnum">
                <span className="font-normal text-faint">{t("scan_detail.availCap")}:</span>{" "}
                {num(info.bandwidth.available)} / {num(info.bandwidth.max)}
              </span>
            </SideRow>
          ) : null}
          <SideRow label={t("scan_detail.votes")}>
            <span className="tnum">
              {fmtCompact(info.votedTotal ?? "0")} / {fmtCompact(info.votes ?? "0")}
            </span>
          </SideRow>
          <SideRow label={t("scan_detail.rewards")}>
            <span className="tnum">{fmt(info.claimableVoterReward ?? "0")} EAV7</span>
          </SideRow>
        </Glass>

        <AddressHoldings
          groups={grupos}
          title={t("scan_detail.holdingsTitle")}
          searchPh={t("scan_detail.searchTokenPh")}
          emptyLabel={t("scan_detail.empty")}
          noMatchLabel={t("scan_detail.noMatch")}
        />
      </div>

      <ScanTabs tabs={abas} current={tab} label={t("scan_detail.adTitle")} panelId={painel} />

      <TabPanel id={painel} labelledBy={`${painel}-tab-${tab}`}>
        {/* ---------- TRANSAÇÕES (moeda nativa) ---------- */}
        {tab === "txs" ? (
          <Glass className="overflow-hidden">
            <div className="scan-scroll">
              <table className="scan-table">
                <thead>
                  <tr>
                    <th>{t("scan_detail.colHash")}</th>
                    <th>{t("scan_detail.colBlock")}</th>
                    <th>{t("scan_detail.colAge")}</th>
                    <th>{t("scan_detail.colType")}</th>
                    <th>{t("scan_detail.colFrom")}</th>
                    <th />
                    <th>{t("scan_detail.colTo")}</th>
                    <th className="!text-right">{t("scan_detail.colAmount")}</th>
                    <th className="!text-right">{t("scan_detail.colResult")}</th>
                  </tr>
                </thead>
                <tbody>
                  {transacoes.map((x) => (
                    <tr key={x.id}>
                      <td className="max-w-[200px]">
                        <Link href={`/tx/${x.id}`} className="font-mono text-violet hover:underline">
                          {shortHash(x.id, 10, 6)}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/block/${x.blockHeight}`} className="text-violet hover:underline">
                          {num(x.blockHeight)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-muted" title={when(x.timestamp)}>
                        {ago(x.timestamp)}
                      </td>
                      <td>
                        <TxBadge type={x.type} />
                      </td>
                      <td>
                        <Parte addr={x.from} self={self} />
                      </td>
                      <td>
                        <Direcao saiu={x.from === self} t={t} />
                      </td>
                      <td>
                        <Parte addr={destOf(x)} self={self} />
                      </td>
                      <td className="text-right font-semibold">
                        <Amount tx={x} />
                      </td>
                      <td className="text-right">
                        <ResultBadge ok={txOk(x)} t={t} />
                      </td>
                    </tr>
                  ))}
                  {transacoes.length === 0 ? <EmptyRow cols={9}>{t("scan_detail.empty")}</EmptyRow> : null}
                </tbody>
              </table>
            </div>
          </Glass>
        ) : null}

        {/* ---------- TRANSFERÊNCIAS (ativos EAV20 / EAV721) ---------- */}
        {tab === "transfers" ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] text-muted">
                {t("scan_detail.trfSummary", { n: num(transferencias.length) })}
              </span>
              <div className="flex flex-wrap items-center gap-2.5">
                <Filtros
                  atual={dir}
                  rotulo={t("scan_detail.filterDir")}
                  opcoes={[
                    { v: "all", label: t("scan_detail.filterAll"), href: `${url("transfers")}&std=${std}&dir=all` },
                    { v: "in", label: `↓ ${t("scan_detail.dirIn")}`, href: `${url("transfers")}&std=${std}&dir=in` },
                    { v: "out", label: `↑ ${t("scan_detail.dirOut")}`, href: `${url("transfers")}&std=${std}&dir=out` },
                  ]}
                />
                <Filtros
                  atual={std}
                  rotulo={t("scan_detail.filterStd")}
                  opcoes={[
                    { v: "all", label: t("scan_detail.filterAll"), href: `${url("transfers")}&dir=${dir}&std=all` },
                    { v: "eav20", label: "EAV20", href: `${url("transfers")}&dir=${dir}&std=eav20` },
                    { v: "eav721", label: "EAV721", href: `${url("transfers")}&dir=${dir}&std=eav721` },
                  ]}
                />
              </div>
            </div>

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
                      <th className="!text-right">{t("scan_detail.colAmount")}</th>
                      <th>{t("scan_detail.colToken")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transferencias.map((x) => {
                      const entrou = x.to === self;
                      return (
                        <tr key={x.id}>
                          <td className="max-w-[200px]">
                            <Link href={`/tx/${x.id}`} className="font-mono text-violet hover:underline">
                              {shortHash(x.id, 10, 6)}
                            </Link>
                          </td>
                          <td>
                            <Link href={`/block/${x.blockHeight}`} className="text-violet hover:underline">
                              {num(x.blockHeight)}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap text-muted" title={when(x.timestamp)}>
                            {ago(x.timestamp)}
                          </td>
                          <td>
                            <Parte addr={x.from} self={self} />
                          </td>
                          <td>
                            <Parte addr={destOf(x)} self={self} />
                          </td>
                          <td className={`tnum whitespace-nowrap text-right font-bold ${entrou ? "text-ok" : "text-gold"}`}>
                            {entrou ? "+" : "−"}
                            {x.asset?.kind === "EAV721"
                              ? `#${x.asset.tokenId}`
                              : fmtToken(x.amount, x.asset?.decimals ?? 0)}
                          </td>
                          <td>
                            {x.asset ? (
                              <Link href={`/token/${x.asset.id}`} className="flex min-w-0 items-center gap-2.5">
                                <span
                                  aria-hidden
                                  className="grid size-6 shrink-0 place-items-center rounded-full text-[8.5px] font-bold text-white"
                                  style={{ background: avatarBg(x.asset.symbol ?? x.asset.id) }}
                                >
                                  {initials(x.asset.symbol ?? x.asset.kind)}
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-[12px] font-semibold text-violet">
                                    {x.asset.name ?? x.asset.symbol ?? x.asset.kind}
                                  </span>
                                  <span className="font-mono block text-[10.5px] text-faint">
                                    {shortHash(x.asset.id, 6, 4)}
                                  </span>
                                </span>
                              </Link>
                            ) : (
                              <span className="text-faint">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {transferencias.length === 0 ? <EmptyRow cols={7}>{t("scan_detail.empty")}</EmptyRow> : null}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-[var(--scan-border-soft)] px-5 py-3">
                <CsvButton
                  label={t("scan_detail.downloadCsv")}
                  filename={`eav7-transfers-${self.slice(0, 10)}.csv`}
                  headers={["hash", "block", "timestamp", "from", "to", "amount", "token"]}
                  rows={transferencias.map((x) => [
                    x.id,
                    x.blockHeight,
                    new Date(x.timestamp).toISOString(),
                    x.from,
                    destOf(x) ?? "",
                    x.asset?.kind === "EAV721" ? (x.asset.tokenId ?? "") : fmtToken(x.amount, x.asset?.decimals ?? 0),
                    x.asset?.symbol ?? x.asset?.id ?? "EAV7",
                  ])}
                />
              </div>
            </Glass>
          </>
        ) : null}

        {/* ---------- TRANSFERÊNCIAS INTERNAS ---------- */}
        {tab === "internal" ? (
          <Glass className="overflow-hidden">
            <p className="border-b border-[var(--scan-border-soft)] px-5 py-3 text-[12px] leading-relaxed text-faint">
              {t("scan_detail.internalNote")}
            </p>
            <div className="scan-scroll">
              <table className="scan-table">
                <thead>
                  <tr>
                    <th>{t("scan_detail.colParentHash")}</th>
                    <th>{t("scan_detail.colBlock")}</th>
                    <th>{t("scan_detail.colAge")}</th>
                    <th>{t("scan_detail.colType")}</th>
                    <th>{t("scan_detail.colFrom")}</th>
                    <th />
                    <th>{t("scan_detail.colTo")}</th>
                    <th className="!text-right">{t("scan_detail.colAmount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {internal.map((x, i) => {
                    const saiu = x.fromE7 === self;
                    return (
                      <tr key={`${x.txId}-${i}`}>
                        <td className="max-w-[200px]">
                          <Link href={`/tx/${x.txId}`} className="font-mono text-violet hover:underline">
                            {shortHash(x.txId, 10, 6)}
                          </Link>
                        </td>
                        <td>
                          <Link href={`/block/${x.blockHeight}`} className="text-violet hover:underline">
                            {num(x.blockHeight)}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap text-muted">{x.blockTime ? ago(x.blockTime) : "—"}</td>
                        <td>
                          <span className="badge badge-teal">{x.kind}</span>
                        </td>
                        <td>
                          <Parte addr={x.fromE7} self={self} />
                        </td>
                        <td>
                          <Direcao saiu={saiu} t={t} />
                        </td>
                        <td>
                          <Parte addr={x.toE7} self={self} />
                        </td>
                        <td className={`tnum whitespace-nowrap text-right font-semibold ${saiu ? "text-gold" : "text-ok"}`}>
                          {saiu ? "−" : "+"}
                          {fmt(x.amount)} EAV7
                        </td>
                      </tr>
                    );
                  })}
                  {internal.length === 0 ? <EmptyRow cols={8}>{t("scan_detail.empty")}</EmptyRow> : null}
                </tbody>
              </table>
            </div>
          </Glass>
        ) : null}

        {/* ---------- STAKE E RECURSOS ---------- */}
        {tab === "stake" ? (
          <div className="flex flex-col gap-4">
            <div className="scan-split">
              <Cartao titulo={t("scan_detail.staked")}>
                <div className="tnum text-[22px] font-bold text-ink">{fmt(info.staked)} EAV7</div>
                <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">{t("scan_detail.stakeNote")}</p>
              </Cartao>
              <Cartao titulo={t("scan_detail.votingFor")}>
                {(info.votesCast ?? []).length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-2">
                    {info.votesCast!.map((v) => (
                      <li key={v.to} className="flex items-center justify-between gap-3 text-[13px]">
                        <Link href={`/address/${v.to}`} className="font-mono text-violet hover:underline">
                          {shortHash(v.to, 10, 6)}
                        </Link>
                        <span className="tnum font-semibold">{fmt(v.amount)} EAV7</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[13px] text-faint">{t("scan_detail.noVotes")}</p>
                )}
              </Cartao>
            </div>

            <Glass className="px-6 py-4">
              <SideRow label={t("scan_detail.energy")}>
                <span className="tnum">
                  {num(info.energy.available)} / {num(info.energy.max)}
                </span>
              </SideRow>
              {info.bandwidth ? (
                <SideRow label={t("scan_detail.bandwidth")}>
                  <span className="tnum">
                    {num(info.bandwidth.available)} / {num(info.bandwidth.max)}
                  </span>
                </SideRow>
              ) : null}
              {info.resources ? (
                <>
                  <SideRow label={t("scan_detail.delegatedOut")}>
                    <span className="tnum">{fmt(info.resources.delegatedOut)} EAV7</span>
                  </SideRow>
                  <SideRow label={t("scan_detail.delegatedIn")}>
                    <span className="tnum">{fmt(info.resources.delegatedIn)} EAV7</span>
                  </SideRow>
                </>
              ) : null}
              {(info.unbonding ?? []).map((u, i) => (
                <SideRow key={i} label={t("scan_detail.unbonding")}>
                  <span className="tnum">
                    {fmt(u.amount)} EAV7{" "}
                    <span className="font-normal text-faint">
                      ({t("scan_detail.matureIn", { n: num(u.blocksLeft) })})
                    </span>
                  </span>
                </SideRow>
              ))}
            </Glass>
          </div>
        ) : null}

        {/* ---------- CONTRATOS ---------- */}
        {tab === "contracts" ? (
          <Glass className="overflow-hidden">
            {info.contract ? (
              <div className="border-b border-[var(--scan-border-soft)] px-5 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`badge ${contract?.verified ? "badge-green" : "badge-gold"}`}>
                    {contract?.verified ? `✓ ${t("scan_detail.verified")}` : t("scan_detail.unverified")}
                  </span>
                  <span className="font-mono text-[12px] text-muted">{shortHash(info.contract.address, 14, 8)}</span>
                  {contract ? (
                    <>
                      <span className="badge badge-violet">{contract.compiler}</span>
                      <span className="text-[12px] text-faint">{whenUtc(contract.verifiedAt)} UTC</span>
                    </>
                  ) : null}
                  <span className="tnum text-[12px] text-faint">
                    {t("scan_detail.codeSize", { n: num(info.contract.codeSize) })}
                  </span>
                </div>
                {contract?.source ? (
                  <pre className="scan-input font-mono mt-3.5 overflow-x-auto p-4 text-[11.5px] leading-[1.8] text-muted">
                    {contract.source}
                  </pre>
                ) : null}
              </div>
            ) : null}

            <div className="scan-scroll">
              <table className="scan-table">
                <thead>
                  <tr>
                    <th>{t("scan_detail.publishedContracts")}</th>
                    <th>{t("scan_detail.createdAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {publicados.map((c) => (
                    <tr key={c.address}>
                      <td>
                        <Link href={`/address/${c.address}`} className="font-mono text-violet hover:underline">
                          {shortHash(c.address, 14, 8)}
                        </Link>
                      </td>
                      <td className="tnum whitespace-nowrap text-muted">{whenUtc(c.createdAt)} UTC</td>
                    </tr>
                  ))}
                  {publicados.length === 0 && !info.contract ? (
                    <EmptyRow cols={2}>{t("scan_detail.contractNone")}</EmptyRow>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Glass>
        ) : null}

        {/* ---------- PERMISSÕES ---------- */}
        {tab === "perm" ? <Permissoes info={info} t={t} /> : null}

        {/* ---------- ANÁLISE ---------- */}
        {tab === "analysis" ? <Analise analysis={analysis} t={t} /> : null}
      </TabPanel>
    </DetailPage>
  );
}

/**
 * Permissões: chave por papel, com peso e limiar. A EAV7 tem `owner` e uma lista de
 * `actives` (multisig v2); quando a conta não configurou nada, o nó devolve a
 * autorização SINTETIZADA com `default: true` — e dizê-lo é importante, senão
 * parece que alguém configurou.
 */
function Permissoes({ info, t }: { info: AddressInfo; t: T }) {
  const p = info.permissions;
  if (!p) {
    return (
      <Glass>
        <Empty>{t("scan_detail.permsNone")}</Empty>
      </Glass>
    );
  }

  const linhas: { role: string; addr: string; weight: string }[] = [];
  const owner = p.owner ?? (p.keys ? { threshold: p.threshold ?? 1, keys: p.keys } : null);
  if (owner) {
    for (const k of owner.keys) {
      linhas.push({ role: t("scan_detail.permOwner"), addr: k.address, weight: `${k.weight} / ${owner.threshold}` });
    }
  }
  for (const a of p.actives ?? []) {
    for (const k of a.keys) {
      linhas.push({
        role: a.name ?? `${t("scan_detail.permActive")} #${a.id}`,
        addr: k.address,
        weight: `${k.weight} / ${a.threshold}`,
      });
    }
  }

  return (
    <Glass className="overflow-hidden">
      {p.default ? (
        <p className="border-b border-[var(--scan-border-soft)] px-5 py-3 text-[12px] leading-relaxed text-faint">
          {t("scan_detail.permsDefaultNote")}
        </p>
      ) : null}
      <div className="scan-scroll">
        <table className="scan-table">
          <thead>
            <tr>
              <th>{t("scan_detail.permRole")}</th>
              <th>{t("scan_detail.colAddress")}</th>
              <th className="!text-right">{t("scan_detail.permWeight")}</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={`${l.role}-${l.addr}-${i}`}>
                <td>
                  <span className="badge badge-violet">{l.role}</span>
                </td>
                <td>
                  <Link href={`/address/${l.addr}`} className="font-mono text-violet hover:underline">
                    {shortHash(l.addr, 14, 10)}
                  </Link>
                </td>
                <td className="tnum text-right font-semibold">{l.weight}</td>
              </tr>
            ))}
            {linhas.length === 0 ? <EmptyRow cols={3}>{t("scan_detail.permsNone")}</EmptyRow> : null}
          </tbody>
        </table>
      </div>
    </Glass>
  );
}

/**
 * Análise: as barras do desenho, mas com a série REAL de `daily` (contagem de
 * transações por dia). Sem `analysis` o nó não indexou o endereço — dizemos isso
 * em vez de desenhar barras sintéticas.
 */
function Analise({ analysis, t }: { analysis: AddressAnalysis | null; t: T }) {
  if (!analysis) {
    return (
      <Glass>
        <Empty>{t("scan_detail.noData")}</Empty>
      </Glass>
    );
  }

  const dias = analysis.daily.slice(-30);
  const maior = Math.max(1, ...dias.map((d) => d.count));
  const passo = 600 / Math.max(dias.length, 1);
  const largura = Math.max(3, passo * 0.72);

  return (
    <Glass className="px-6 py-5">
      <h3 className="text-[14px] font-bold text-ink">{t("scan_detail.activity30")}</h3>
      {dias.length > 0 ? (
        <svg
          viewBox="0 0 600 140"
          preserveAspectRatio="none"
          role="img"
          aria-label={t("scan_detail.activity30")}
          className="mt-3.5 block h-[130px] w-full"
        >
          {dias.map((d, i) => {
            const h = Math.max(2, (d.count / maior) * 128);
            return (
              <rect
                key={d.date}
                x={i * passo + (passo - largura) / 2}
                y={138 - h}
                width={largura}
                height={h}
                rx={3}
                fill="var(--violet)"
                opacity={0.8}
              >
                <title>{`${d.date}: ${num(d.count)}`}</title>
              </rect>
            );
          })}
        </svg>
      ) : (
        <p className="mt-3 text-[12.5px] text-faint">{t("scan_detail.noData")}</p>
      )}

      <div className="mt-4 grid gap-3.5 sm:grid-cols-3">
        {[
          { l: t("scan_detail.totalIn"), v: `${fmtCompact(analysis.received)} EAV7`, c: "text-ok" },
          { l: t("scan_detail.totalOut"), v: `${fmtCompact(analysis.sent)} EAV7`, c: "text-gold" },
          { l: t("scan_detail.feesPaid"), v: `${fmt(analysis.feesPaid)} EAV7`, c: "text-ink" },
        ].map((c) => (
          <div key={c.l} className="rounded-xl border border-[var(--scan-border-soft)] px-4 py-3">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-faint">{c.l}</div>
            <div className={`tnum mt-1 text-[16px] font-bold ${c.c}`}>{c.v}</div>
          </div>
        ))}
      </div>

      {analysis.topCounterparties.length > 0 ? (
        <>
          <h3 className="mt-6 text-[14px] font-bold text-ink">{t("scan_detail.topCounterparties")}</h3>
          <div className="mt-2.5">
            {analysis.topCounterparties.slice(0, 10).map((c) => (
              <div
                key={c.address}
                className="flex items-center justify-between gap-3 border-t border-[var(--scan-border-soft)] py-2.5 text-[12.5px]"
              >
                <Link href={`/address/${c.address}`} className="font-mono text-violet hover:underline">
                  {shortHash(c.address, 14, 8)}
                </Link>
                <span className="tnum text-muted">{num(c.count)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {analysis.truncated ? (
        <p className="font-mono mt-3 text-[11px] text-faint">{t("scan_detail.truncatedNote")}</p>
      ) : null}
    </Glass>
  );
}
