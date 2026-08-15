import Link from "next/link";
import { getCirculatingSnapshot } from "@/lib/circulating";
import { PUBLIC_MARKET_PLAN } from "@/lib/custody";
import {
  isPublicVaultDeployed,
  loadPublicLbpAddresses,
  loadPublicLbpDelivery,
} from "@/lib/public-lbp";
import { getMarketPrice } from "@/lib/price-market";
import { addrLink, fmt, fmtCompact, fmtUsd } from "@/lib/format";
import { getLocale, getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t("page_market.metaTitle"),
    description: t("page_market.metaDesc"),
  };
}

export default async function MarketPage() {
  const t = await getT();
  const locale = await getLocale();
  const en = locale === "en";

  let snap: Awaited<ReturnType<typeof getCirculatingSnapshot>> | null = null;
  try {
    snap = await getCirculatingSnapshot();
  } catch {
    snap = null;
  }

  const price = getMarketPrice({
    circulatingE7: snap?.freeFloatE7 ?? null,
    circulatingBasis: snap ? "free-float" : null,
  });
  const lbpAddr = loadPublicLbpAddresses();
  const lbpDelivery = loadPublicLbpDelivery();
  const vaultLive = isPublicVaultDeployed(lbpAddr);

  return (
    <main className="scan mx-auto max-w-[960px] px-6 pb-20 pt-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
        {t("page_market.kicker")}
      </p>
      <h1 className="mt-2 font-display text-[28px] font-bold tracking-tight text-ink md:text-[34px]">
        {t("page_market.title")}
      </h1>
      <p className="mt-3 max-w-[62ch] text-[14.5px] leading-relaxed text-muted">
        {t("page_market.lead")}
      </p>

      {!snap ? (
        <p className="mt-10 rounded-xl border border-line bg-[var(--input-bg)] px-4 py-3 text-[13px] text-muted">
          {t("page_market.unavailable")}
        </p>
      ) : (
        <>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t("page_market.height")} value={`#${snap.height.toLocaleString("pt-BR")}`} />
            <Stat
              label={t("page_market.gross")}
              value={fmtCompact(snap.grossE7)}
              hint={`${fmt(snap.grossE7)} EAV7`}
            />
            <Stat
              label={t("page_market.locked")}
              value={fmtCompact(snap.lockedCustodyE7)}
              hint={`${fmt(snap.lockedCustodyE7)} EAV7`}
            />
            <Stat
              label={t("page_market.free")}
              value={fmtCompact(snap.freeFloatE7)}
              hint={
                price.marketCapUsd != null
                  ? `mcap ${fmtUsd(price.marketCapUsd, 0)} · ${price.priceUsdFormatted}`
                  : `${fmt(snap.freeFloatE7)} EAV7`
              }
              accent
            />
          </div>

          <p className="mt-4 font-mono text-[11px] text-faint">
            {t("page_market.formula")}: {snap.formula}
          </p>

          <section className="mt-12">
            <h2 className="font-display text-[20px] font-semibold text-ink">
              {t("page_market.custodyTitle")}
            </h2>
            <p className="mt-1.5 text-[13.5px] text-muted">{t("page_market.custodyLead")}</p>
            <div className="scan-scroll-x mt-5 rounded-xl border border-line">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-b border-line bg-[var(--input-bg)] font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("page_market.share")}</th>
                    <th className="px-4 py-3 font-medium">Address</th>
                    <th className="px-4 py-3 font-medium">{t("page_market.balance")}</th>
                    <th className="px-4 py-3 font-medium">{t("page_market.role")}</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.custody.map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3.5 align-top">
                        <div className="font-medium text-ink">{en ? c.labelEn : c.label}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-faint">{c.sharePct}%</div>
                      </td>
                      <td className="px-4 py-3.5 align-top">
                        <Link
                          href={`/address/${c.address}`}
                          className="font-mono text-[12px] text-[var(--scan-link)] hover:underline"
                          title={c.address}
                        >
                          {addrLink(c.address)}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5 align-top font-mono tabular-nums">
                        <div>{fmtCompact(c.balanceE7)}</div>
                        <div className="mt-0.5 text-[11px] text-faint">{fmt(c.balanceE7)}</div>
                      </td>
                      <td className="px-4 py-3.5 align-top text-muted">
                        {en ? c.roleEn : c.role}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-12">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="font-display text-[20px] font-semibold text-ink">
                {t("page_market.planTitle")}
              </h2>
              <span className="rounded-md border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">
                {t("page_market.planStatus")}
              </span>
            </div>
            <p className="mt-1.5 text-[13.5px] text-muted">{t("page_market.planLead")}</p>
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {PUBLIC_MARKET_PLAN.partition.map((p) => (
                <li
                  key={p.id}
                  className="rounded-xl border border-line bg-[var(--input-bg)] px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-faint">
                      {p.id}
                    </span>
                    <span className="font-mono text-[12px] text-ink">{p.sharePct}%</span>
                  </div>
                  <div className="mt-1 text-[15px] font-semibold tabular-nums text-ink">
                    {p.tokens} EAV7
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted">{p.note}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-12">
            <h2 className="font-display text-[20px] font-semibold text-ink">
              {t("page_market.lbpTitle")}
            </h2>
            <p className="mt-1.5 text-[13.5px] text-muted">{t("page_market.lbpLead")}</p>
            <div className="mt-5 rounded-xl border border-line bg-[var(--input-bg)] px-4 py-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[12px]">
                <span className="text-faint">{t("page_market.lbpStatus")}</span>
                <span className="rounded-md border border-line px-2 py-0.5 uppercase tracking-wider text-ink">
                  {lbpAddr?.status ?? "not-deployed"}
                </span>
                {lbpDelivery?.windowHours ? (
                  <span className="text-faint">
                    {lbpDelivery.windowHours}h · ${lbpDelivery.priceHintUsd?.start}→$
                    {lbpDelivery.priceHintUsd?.end}
                  </span>
                ) : null}
              </div>
              {vaultLive && lbpAddr?.publicVault0x ? (
                <ul className="mt-3 space-y-1.5 font-mono text-[12px]">
                  <li>
                    <span className="text-faint">{t("page_market.lbpVault")}: </span>
                    <Link
                      href={`/address/${lbpAddr.publicVault0x}`}
                      className="text-[var(--scan-link)] hover:underline"
                    >
                      {addrLink(lbpAddr.publicVault0x)}
                    </Link>
                  </li>
                  {lbpAddr.timelockLpSeeder0x ? (
                    <li>
                      <span className="text-faint">{t("page_market.lbpSeeder")}: </span>
                      <span className="text-ink">{addrLink(lbpAddr.timelockLpSeeder0x)}</span>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="mt-3 text-[13px] text-muted">{t("page_market.lbpPending")}</p>
              )}
              <div className="mt-4">
                <Link
                  href="/sale/public"
                  className="inline-flex text-[13px] font-medium text-[var(--scan-link)] hover:underline"
                >
                  {t("page_market.lbpCta")} →
                </Link>
              </div>
            </div>
          </section>

          <section className="mt-12">
            <h2 className="font-display text-[20px] font-semibold text-ink">{t("page_market.apis")}</h2>
            <ul className="mt-3 space-y-2 font-mono text-[12.5px]">
              <li>
                <Link href="/circulating" className="text-[var(--scan-link)] hover:underline">
                  GET /circulating
                </Link>
                <span className="ml-2 text-faint">— {t("page_market.apiCirc")}</span>
              </li>
              <li>
                <Link href="/price" className="text-[var(--scan-link)] hover:underline">
                  GET /price
                </Link>
                <span className="ml-2 text-faint">— {t("page_market.apiPrice")}</span>
              </li>
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="font-display text-[16px] font-semibold text-ink">
              {t("page_market.notesTitle")}
            </h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] text-muted">
              {snap.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-xl border border-violet/35 bg-violet/5 px-4 py-3.5"
          : "rounded-xl border border-line bg-[var(--input-bg)] px-4 py-3.5"
      }
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className="mt-1.5 font-display text-[22px] font-semibold tabular-nums text-ink">{value}</div>
      {hint ? <div className="mt-1 font-mono text-[11px] text-faint">{hint}</div> : null}
    </div>
  );
}
