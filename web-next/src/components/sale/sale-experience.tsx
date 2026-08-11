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
import "./sale-experience.css";

const ease = [0.22, 1, 0.36, 1] as const;

function shortAddr(a: string) {
  if (a.length < 16) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function fmtNum(n: number, maxFrac = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFrac }).format(n);
}

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function statusLabel(status: string) {
  if (status === "granted") return "Granted — vesting open";
  if (status === "paid") return "Payment seen — granting…";
  return "Waiting for payment confirmation";
}

export function SaleExperience({ channel = "private" }: { channel?: "private" | "public" }) {
  const reduce = useReducedMotion();
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
      setError(e instanceof Error ? e.message : "Falha ao criar intent");
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
        <motion.div
          className="sale__mark"
          aria-hidden
          initial={reduce ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.1, ease }}
        >
          <span className="sale__mark-glow" />
          <span className="sale__mark-word">EAV7</span>
        </motion.div>

        <div className="sale__hero-copy">
          <motion.p
            className="sale__kicker"
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12, ease }}
          >
            {channel === "public" ? "Public distribution" : "Private sale"}
          </motion.p>
          <motion.h1
            className="sale__title"
            initial={reduce ? false : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.18, ease }}
          >
            {channel === "public" ? (
              <>
                Buy liquid.
                <span>Pool forms itself after the window.</span>
              </>
            ) : (
              <>
                Allocate once.
                <span>Price climbs with demand.</span>
              </>
            )}
          </motion.h1>
          <motion.p
            className="sale__lede"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.28, ease }}
          >
            {channel === "public"
              ? "Public LBP window — pay USDT/USDC/BTC, receive EAV7 liquid via PublicVault. When the window ends, unsold + LP seed finalize into the canonical AMM automatically."
              : "Tiered private sale — every intent locks today's price. When the tier fills, the next buyer pays more. Vesting still opens automatically via SaleVault."}
          </motion.p>
          <motion.div
            className="sale__hero-actions"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.36, ease }}
          >
            <a href="#allocate" className="sale__btn sale__btn--primary">
              Start allocation
            </a>
            <p className="sale__meta">
              {heroPrice} · {channel === "public" ? "liquid at TGE" : "12m cliff · 24m linear"}
            </p>
          </motion.div>
        </div>
      </section>

      <section id="allocate" className="sale__allocate">
        {quote ? <ScarcityBar quote={quote} /> : null}

        <div className="sale__panel">
          <header className="sale__panel-head">
            <p className="sale__panel-kicker">Allocate</p>
            <h2>Choose rail and amount</h2>
          </header>

          <div className="sale__panel-grid">
            <div className="sale__form">
              <p className="sale__label">Payment rail</p>
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
                <span className="sale__label">USD amount</span>
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
                  Your EAVM address <em>(0x… for vesting)</em>
                </span>
                <input
                  type="text"
                  placeholder="0x…"
                  value={beneficiary}
                  disabled={!!intent}
                  onChange={(e) => setBeneficiary(e.target.value.trim())}
                  className="sale__input"
                />
              </label>

              {error ? <p className="sale__error">{error}</p> : null}

              {!intent ? (
                <button
                  type="button"
                  disabled={busy || usdNum < 100 || !addrOk}
                  onClick={() => void onCreate()}
                  className="sale__btn sale__btn--ink"
                >
                  {busy ? "Locking price…" : "Lock price & pay instructions"}
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
                  Start over
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
                      <span>/ EAV7 · {quote?.tierLabel ?? "…"}</span>
                    </p>
                    <p className="sale__out">
                      {fmtNum(eav7Out)}
                      <span>EAV7</span>
                    </p>
                    <p className="sale__out-note">
                      Creating an intent locks this tier price for your payment. Pending intents
                      also fill the tier — so waiting can cost more.
                    </p>
                    <dl className="sale__rows">
                      <Row k="Network" v={CHAIN_LABEL[rail.chain] ?? rail.chain} />
                      <Row k="Asset" v={`${rail.asset} · ${rail.standard}`} />
                      <Row
                        k="Vesting"
                        v={
                          channel === "public"
                            ? "Liquid — no cliff"
                            : "12-month cliff, 24-month linear"
                        }
                      />
                      {quote?.nextPriceUsdPerEav7 != null ? (
                        <Row
                          k="Next tier"
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
                      {intent.status === "granted" ? "Allocation granted" : "Send exactly"}
                    </p>
                    <p className="sale__send-amt">
                      {formatPayDisplay(intent)} <span>{intent.asset}</span>
                    </p>
                    <p className="sale__out-note">
                      Locked at{" "}
                      <span className="sale__mono">
                        ${intent.priceUsdPerEav7 ?? "—"}
                      </span>
                      {intent.tierId ? (
                        <>
                          {" "}
                          · tier <span className="sale__mono">{intent.tierId}</span>
                        </>
                      ) : null}
                      . Intent <span className="sale__mono">{intent.id}</span>
                    </p>

                    <div className="sale__addr">
                      <div className="sale__addr-top">
                        <div>
                          <p className="sale__addr-label">Receive address</p>
                          <p className="sale__addr-value">{intent.receive}</p>
                        </div>
                        <CopyButton text={intent.receive} />
                      </div>
                      <a
                        href={intent.explorer}
                        target="_blank"
                        rel="noreferrer"
                        className="sale__explorer"
                      >
                        Open on explorer →
                      </a>
                    </div>

                    <dl className="sale__rows">
                      <Row
                        k="You receive"
                        v={`${fmtNum(Number(e7ToWhole(intent.e7Amount)))} EAV7${
                          intent.liquid || channel === "public" ? " (liquid)" : " (vested)"
                        }`}
                      />
                      <Row k="Beneficiary" v={shortAddr(intent.beneficiary0x)} />
                      <Row k="Status" v={statusLabel(intent.status)} />
                      {intent.paymentTx ? (
                        <Row k="Payment tx" v={shortAddr(intent.paymentTx)} />
                      ) : null}
                      {intent.grantTx ? (
                        <Row k="Grant" v={shortAddr(intent.grantTx)} />
                      ) : null}
                    </dl>

                    {intent.status === "pending" ? (
                      <div className="sale__manual">
                        <p className="sale__label">
                          After you pay the exact amount, the watcher confirms automatically.
                          Keep this page open — status updates every few seconds.
                        </p>
                      </div>
                    ) : null}

                    <p className="sale__fine">
                      Do not send from an exchange withdraw that cannot hit the exact amount. Your
                      locked price stays even if the public tier moves up.
                    </p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {quote ? <TierLadder quote={quote} /> : null}

        <motion.p
          className="sale__footnote"
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          {channel === "public" ? (
            <>
              Public LBP: intent locks price; PublicVault delivers liquid EAV7. After the window,{" "}
              <span className="sale__mono">finalizeToLp</span> seeds the canonical pool. Private
              sale stays at{" "}
              <a href="/sale" className="sale__explorer">
                /sale
              </a>
              .
            </>
          ) : (
            <>
              Price tiers rise with reserved USD. Intent locks the rate; SaleVault delivers
              vesting. Public LBP:{" "}
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

function ScarcityBar({ quote }: { quote: SaleQuote }) {
  const pct = Math.round(quote.progressInTier * 100);
  const remain =
    quote.remainingInTierUsd == null
      ? "Last call — price stays until sale closes"
      : `${fmtUsd(quote.remainingInTierUsd)} left at $${quote.priceUsdPerEav7} before $${quote.nextPriceUsdPerEav7}`;

  return (
    <div className="sale__scarcity">
      <div className="sale__scarcity-top">
        <p className="sale__scarcity-title">
          {quote.tierLabel} tier · ${quote.priceUsdPerEav7}
        </p>
        <p className="sale__scarcity-raised">{fmtUsd(quote.raisedUsd)} reserved</p>
      </div>
      <div className="sale__scarcity-track" aria-hidden>
        <div className="sale__scarcity-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="sale__scarcity-note">{remain}</p>
    </div>
  );
}

function TierLadder({ quote }: { quote: SaleQuote }) {
  return (
    <div className="sale__ladder" aria-label="Price tiers">
      {quote.tiers.map((t) => (
        <div
          key={t.id}
          className={`sale__ladder-item${t.active ? " is-active" : ""}${t.filled ? " is-filled" : ""}`}
        >
          <span className="sale__ladder-label">{t.label}</span>
          <span className="sale__ladder-price">${t.priceUsdPerEav7}</span>
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

function CopyButton({ text }: { text: string }) {
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
      {ok ? "Copied" : "Copy"}
    </button>
  );
}
