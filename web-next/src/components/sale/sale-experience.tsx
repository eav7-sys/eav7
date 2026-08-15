"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useEffect, useState, useEffectEvent, useTransition } from "react";
import { CHAIN_LABEL, SALE_PRICE_USD_PER_EAV7, SALE_RAILS, type SaleRail } from "@/lib/sale-rails";
import {
  createSaleIntent,
  e7ToWhole,
  formatPayDisplay,
  getSaleIntent,
  getSaleQuote,
  type SaleIntent,
  type SaleQuote,
} from "@/lib/sale-api";
import { useI18n, type TFunc } from "@/i18n/provider";
import { Eav7SeloCoin } from "@/components/brand/eav7-selo-coin";
import "./sale-experience.css";

const ease = [0.22, 1, 0.36, 1] as const;

function shortAddr(a: string) {
  if (a.length < 16) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function statusLabel(t: TFunc, status: string, liquid: boolean) {
  if (status === "granted") {
    return liquid ? t("sale_experience.statusGrantedLiquid") : t("sale_experience.statusGrantedVesting");
  }
  if (status === "paid") return t("sale_experience.statusPaid");
  return t("sale_experience.statusPending");
}

export function SaleExperience({
  channel = "private",
  allocateEnabled = true,
  gateMessage = null,
}: {
  channel?: "private" | "public";
  /** When false, show banner and disable create-intent (vault not open yet). */
  allocateEnabled?: boolean;
  gateMessage?: string | null;
}) {
  const reduce = useReducedMotion();
  const { t, locale } = useI18n();
  const [railId, setRailId] = useState("eth-usdt");
  const [usd, setUsd] = useState("1000");
  const [beneficiary, setBeneficiary] = useState("");
  const [intent, setIntent] = useState<SaleIntent | null>(null);
  const [quote, setQuote] = useState<SaleQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const rail = SALE_RAILS.find((r) => r.id === railId) ?? SALE_RAILS[0];
  const usdNum = Math.max(0, Number(usd) || 0);
  const livePrice = quote?.priceUsdPerEav7 ?? SALE_PRICE_USD_PER_EAV7;
  const eav7Out = usdNum / livePrice;
  const addrOk = /^0x[0-9a-fA-F]{40}$/.test(beneficiary);
  const step = intent ? "pay" : "pick";
  const isPublic = channel === "public";

  // Intl no idioma da interface (não fixo em en-US).
  const fmtNum = (n: number, maxFrac = 0) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: maxFrac }).format(n);
  const fmtUsd = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);

  const refreshQuote = useEffectEvent(async () => {
    try {
      const q = await getSaleQuote(channel);
      setQuote(q);
    } catch {
      /* keep last */
    }
  });

  useEffect(() => {
    void refreshQuote();
    const id = window.setInterval(() => void refreshQuote(), 8000);
    return () => window.clearInterval(id);
  }, [channel]);

  const onCreate = useEffectEvent(async () => {
    setError(null);
    setBusy(true);
    try {
      const created = await createSaleIntent(
        {
          beneficiary0x: beneficiary,
          rail: railId,
          usdAmount: usdNum,
        },
        channel,
      );
      startTransition(() => setIntent(created));
      await refreshQuote();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sale_experience.intentCreateFail"));
    } finally {
      setBusy(false);
    }
  });

  useEffect(() => {
    if (!intent || intent.status === "granted") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await getSaleIntent(intent.id, channel);
        if (!cancelled) setIntent(next);
      } catch {
        /* keep last known */
      }
    };
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intent?.id, intent?.status]);

  const heroPrice =
    quote != null
      ? `$${quote.priceUsdPerEav7} · ${quote.tierLabel}`
      : `$${SALE_PRICE_USD_PER_EAV7}`;

  return (
    <div className="sale">
      <div className="sale__sky" aria-hidden>
        <div className="sale__beam sale__beam--a" />
        <div className="sale__beam sale__beam--b" />
        <div className="sale__grain" />
        <div className="sale__mesh" />
      </div>

      <section className="sale__hero">
        <div className="sale__hero-copy">
          <motion.p
            className="sale__kicker"
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12, ease }}
          >
            <span className="sale__kicker-dot" aria-hidden />
            EAV7 · {isPublic ? t("sale_experience.kickerPublic") : t("sale_experience.kickerPrivate")}
          </motion.p>
          <motion.h1
            className="sale__title"
            initial={reduce ? false : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.18, ease }}
          >
            {isPublic ? (
              <>
                {t("sale_experience.titlePublicA")}
                <span>{t("sale_experience.titlePublicB")}</span>
              </>
            ) : (
              <>
                {t("sale_experience.titlePrivateA")}
                <span>{t("sale_experience.titlePrivateB")}</span>
              </>
            )}
          </motion.h1>
          <motion.p
            className="sale__lede"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.28, ease }}
          >
            {isPublic ? t("sale_experience.ledePublic") : t("sale_experience.ledePrivate")}
          </motion.p>
          <motion.div
            className="sale__hero-actions"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.36, ease }}
          >
            <a href="#allocate" className="sale__btn sale__btn--primary">
              {t("sale_experience.startAllocation")}
            </a>
            <a href="/whitepaper" className="sale__btn sale__btn--ghost">
              {t("sale_experience.whitepaper")}
            </a>
            <p className="sale__meta">
              {heroPrice} · {isPublic ? t("sale_experience.metaLiquidTge") : t("sale_experience.metaVesting")}
            </p>
          </motion.div>
        </div>

        <motion.div
          className="sale__hero-visual"
          aria-hidden
          initial={reduce ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.2, ease }}
        >
          <Eav7SeloCoin size={320} />
        </motion.div>
      </section>

      <section id="allocate" className="sale__allocate">
        {gateMessage ? (
          <p className="sale__footnote" style={{ marginBottom: "1.25rem" }}>
            {gateMessage}{" "}
            <a href="/market" className="sale__explorer">
              /market
            </a>
          </p>
        ) : null}
        {quote ? <ScarcityBar quote={quote} t={t} fmtUsd={fmtUsd} /> : null}

        <div className="sale__panel">
          <header className="sale__panel-head">
            <p className="sale__panel-kicker">{t("sale_experience.panelKicker")}</p>
            <h2>{t("sale_experience.panelTitle")}</h2>
          </header>

          <div className="sale__panel-grid">
            <div className="sale__form">
              <p className="sale__label">{t("sale_experience.paymentRail")}</p>
              <div className="sale__rails">
                {SALE_RAILS.map((r) => (
                  <RailChip
                    key={r.id}
                    rail={r}
                    active={r.id === railId}
                    onSelect={() => {
                      startTransition(() => {
                        setRailId(r.id);
                        setIntent(null);
                        setError(null);
                      });
                    }}
                  />
                ))}
              </div>

              <label className="sale__field">
                <span className="sale__label">{t("sale_experience.usdAmount")}</span>
                <input
                  type="number"
                  min={100}
                  step={50}
                  value={usd}
                  disabled={!!intent}
                  onChange={(e) => setUsd(e.target.value)}
                  className="sale__input sale__input--lg"
                />
              </label>

              <label className="sale__field">
                <span className="sale__label">
                  {t("sale_experience.yourAddress")}{" "}
                  <em>{isPublic ? t("sale_experience.addrHintPublic") : t("sale_experience.addrHintPrivate")}</em>
                </span>
                <input
                  type="text"
                  placeholder="0x…"
                  value={beneficiary}
                  disabled={!!intent || !allocateEnabled}
                  onChange={(e) => setBeneficiary(e.target.value.trim())}
                  className="sale__input"
                />
              </label>

              {error ? <p className="sale__error">{error}</p> : null}

              {!intent ? (
                <button
                  type="button"
                  disabled={busy || !allocateEnabled || usdNum < 100 || !addrOk}
                  onClick={() => void onCreate()}
                  className="sale__btn sale__btn--ink"
                >
                  {busy
                    ? t("sale_experience.lockingPrice")
                    : !allocateEnabled
                      ? t("sale_experience.lbpNotOpen")
                      : t("sale_experience.lockAndPay")}
                </button>
              ) : (
                <button
                  type="button"
                  className="sale__btn sale__btn--ghost"
                  onClick={() => {
                    setIntent(null);
                    setError(null);
                    void refreshQuote();
                  }}
                >
                  {t("sale_experience.startOver")}
                </button>
              )}
            </div>

            <div className="sale__summary">
              <AnimatePresence mode="wait">
                {step === "pick" ? (
                  <motion.div
                    key="idle"
                    className="sale__summary-inner"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <p className="sale__price-now">
                      ${livePrice}
                      <span>
                        {t("sale_experience.perEav7")} · {quote?.tierLabel ?? "…"}
                      </span>
                    </p>
                    <p className="sale__out">
                      {fmtNum(eav7Out)}
                      <span>EAV7</span>
                    </p>
                    <p className="sale__out-note">{t("sale_experience.outNote")}</p>
                    <dl className="sale__rows">
                      <Row k={t("sale_experience.rowNetwork")} v={CHAIN_LABEL[rail.chain] ?? rail.chain} />
                      <Row k={t("sale_experience.rowAsset")} v={`${rail.asset} · ${rail.standard}`} />
                      <Row
                        k={t("sale_experience.rowVesting")}
                        v={isPublic ? t("sale_experience.vestingPublic") : t("sale_experience.vestingPrivate")}
                      />
                      {quote?.nextPriceUsdPerEav7 != null ? (
                        <Row
                          k={t("sale_experience.rowNextTier")}
                          v={`$${quote.nextPriceUsdPerEav7} · ${quote.nextTierLabel}`}
                        />
                      ) : null}
                    </dl>
                  </motion.div>
                ) : intent ? (
                  <motion.div
                    key={intent.id}
                    className="sale__summary-inner"
                    initial={reduce ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4, ease }}
                  >
                    <p
                      className={`sale__send-label${
                        intent.status === "granted" ? " is-ok" : ""
                      }`}
                    >
                      {intent.status === "granted"
                        ? t("sale_experience.allocationGranted")
                        : t("sale_experience.sendExactly")}
                    </p>
                    <p className="sale__send-amt">
                      {formatPayDisplay(intent)} <span>{intent.asset}</span>
                    </p>
                    <p className="sale__out-note">
                      {t("sale_experience.lockedAt")}{" "}
                      <span className="sale__mono">
                        ${intent.priceUsdPerEav7 ?? "—"}
                      </span>
                      {intent.tierId ? (
                        <>
                          {" "}
                          · {t("sale_experience.tierWord")}{" "}
                          <span className="sale__mono">{intent.tierId}</span>
                        </>
                      ) : null}
                      . {t("sale_experience.intentWord")}{" "}
                      <span className="sale__mono">{intent.id}</span>
                    </p>

                    <div className="sale__addr">
                      <div className="sale__addr-top">
                        <div>
                          <p className="sale__addr-label">{t("sale_experience.receiveAddress")}</p>
                          <p className="sale__addr-value">{intent.receive}</p>
                        </div>
                        <CopyButton text={intent.receive} t={t} />
                      </div>
                      <a
                        href={intent.explorer}
                        target="_blank"
                        rel="noreferrer"
                        className="sale__explorer"
                      >
                        {t("sale_experience.openOnExplorer")}
                      </a>
                    </div>

                    <dl className="sale__rows">
                      <Row
                        k={t("sale_experience.rowYouReceive")}
                        v={`${fmtNum(Number(e7ToWhole(intent.e7Amount)))} EAV7 ${
                          intent.liquid || isPublic
                            ? t("sale_experience.liquidTag")
                            : t("sale_experience.vestedTag")
                        }`}
                      />
                      <Row k={t("sale_experience.rowBeneficiary")} v={shortAddr(intent.beneficiary0x)} />
                      <Row
                        k={t("sale_experience.rowStatus")}
                        v={statusLabel(t, intent.status, intent.liquid || isPublic)}
                      />
                      {intent.paymentTx ? (
                        <Row k={t("sale_experience.rowPaymentTx")} v={shortAddr(intent.paymentTx)} />
                      ) : null}
                      {intent.grantTx ? (
                        <Row k={t("sale_experience.rowGrant")} v={shortAddr(intent.grantTx)} />
                      ) : null}
                    </dl>

                    {intent.status === "pending" ? (
                      <div className="sale__manual">
                        <p className="sale__label">{t("sale_experience.manualNote")}</p>
                      </div>
                    ) : null}

                    <p className="sale__fine">{t("sale_experience.finePrint")}</p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {quote ? <TierLadder quote={quote} ariaLabel={t("sale_experience.ladderAria")} /> : null}

        <motion.p
          className="sale__footnote"
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          {isPublic ? (
            <>
              {t("sale_experience.footnotePublicA")}{" "}
              <span className="sale__mono">finalizeToLp</span> {t("sale_experience.footnotePublicB")}{" "}
              <a href="/sale" className="sale__explorer">
                /sale
              </a>
              .
            </>
          ) : (
            <>
              {t("sale_experience.footnotePrivateA")}{" "}
              <a href="/sale/public" className="sale__explorer">
                /sale/public
              </a>
              .
            </>
          )}
        </motion.p>
      </section>
    </div>
  );
}

function ScarcityBar({
  quote,
  t,
  fmtUsd,
}: {
  quote: SaleQuote;
  t: TFunc;
  fmtUsd: (n: number) => string;
}) {
  const pct = Math.round(quote.progressInTier * 100);
  const remain =
    quote.remainingInTierUsd == null
      ? t("sale_experience.scarcityLastCall")
      : t("sale_experience.scarcityLeft", {
          remaining: fmtUsd(quote.remainingInTierUsd),
          price: quote.priceUsdPerEav7,
          next: String(quote.nextPriceUsdPerEav7 ?? ""),
        });

  return (
    <div className="sale__scarcity">
      <div className="sale__scarcity-top">
        <p className="sale__scarcity-title">
          {quote.tierLabel} {t("sale_experience.scarcityTier")} · ${quote.priceUsdPerEav7}
        </p>
        <p className="sale__scarcity-raised">
          {fmtUsd(quote.raisedUsd)} {t("sale_experience.scarcityReserved")}
        </p>
      </div>
      <div className="sale__scarcity-track" aria-hidden>
        <div className="sale__scarcity-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="sale__scarcity-note">{remain}</p>
    </div>
  );
}

function TierLadder({ quote, ariaLabel }: { quote: SaleQuote; ariaLabel: string }) {
  return (
    <div className="sale__ladder" aria-label={ariaLabel}>
      {quote.tiers.map((tier) => (
        <div
          key={tier.id}
          className={`sale__ladder-item${tier.active ? " is-active" : ""}${tier.filled ? " is-filled" : ""}`}
        >
          <span className="sale__ladder-label">{tier.label}</span>
          <span className="sale__ladder-price">${tier.priceUsdPerEav7}</span>
        </div>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="sale__row">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function RailChip({
  rail,
  active,
  onSelect,
}: {
  rail: SaleRail;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`sale__rail${active ? " is-active" : ""}`}
    >
      <span className="sale__rail-chain">{CHAIN_LABEL[rail.chain]}</span>
      <span className="sale__rail-asset">{rail.asset}</span>
    </button>
  );
}

function CopyButton({ text, t }: { text: string; t: TFunc }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="sale__copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1600);
      }}
    >
      {ok ? t("sale_experience.copied") : t("sale_experience.copy")}
    </button>
  );
}
