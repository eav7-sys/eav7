"use client";

import { useEffect, useRef, useState } from "react";
import { Copy } from "@/components/ui/copy";
import { IconWallet, IconNetwork, IconQuantumKey } from "@/components/icons";
import { useT } from "@/i18n/provider";
import { EAVM_CHAIN_ID_DEC, EAVM_CHAIN_PARAMS } from "@/lib/eavm-chain";

const CHAIN_PARAMS = { ...EAVM_CHAIN_PARAMS };

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const PARAM_ROWS: { key: string; v: string; copy?: boolean }[] = [
  { key: "networkName", v: EAVM_CHAIN_PARAMS.chainName },
  { key: "rpcUrl", v: EAVM_CHAIN_PARAMS.rpcUrls[0], copy: true },
  { key: "chainId", v: String(EAVM_CHAIN_ID_DEC), copy: true },
  { key: "symbol", v: EAVM_CHAIN_PARAMS.nativeCurrency.symbol },
  { key: "explorer", v: EAVM_CHAIN_PARAMS.blockExplorerUrls[0], copy: true },
  { key: "decimals", v: String(EAVM_CHAIN_PARAMS.nativeCurrency.decimals) },
];

const STEP_KEYS = ["step1", "step2", "step3"] as const;

export function EavmConnect() {
  const t = useT();
  const [state, setState] = useState<"idle" | "loading" | "ok" | "nowallet" | "error">("idle");
  const [msg, setMsg] = useState("");
  // Detecção de celular só no cliente (após montar) — evita hydration mismatch.
  const [isMobile, setIsMobile] = useState(false);
  const autoTried = useRef(false);
  useEffect(() => {
    setIsMobile(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
    // Ao ATERRISSAR no navegador in-app da carteira via deep link (?addNetwork=trust|metamask),
    // o provider já existe: auto-tenta adicionar a rede, sem exigir um 2º toque do usuário.
    const w = new URLSearchParams(window.location.search).get("addNetwork");
    const hasProvider = !!(window as unknown as { ethereum?: unknown }).ethereum;
    if (w && hasProvider && !autoTried.current) {
      autoTried.current = true;
      void addNetwork();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const PARAMS = PARAM_ROWS.map((row) => ({
    k: t(`docs_eavm.params.${row.key}`),
    v: row.v,
    copy: row.copy,
  }));

  // Adiciona a rede EAV7 na MetaMask. Se houver provider injetado (desktop com a
  // extensão OU já dentro do navegador in-app da MetaMask no celular), chama o fluxo
  // wallet_switchEthereumChain → add. No navegador comum do celular NÃO há provider →
  // abre o app da MetaMask via deep link nesta página (onde a rede é auto-adicionada).
  async function addNetwork() {
    const eth = (window as unknown as { ethereum?: EthProvider }).ethereum;
    if (eth) {
      setState("loading");
      try {
        // Padrão canônico EIP-3326/3085: tenta TROCAR para a rede; se ela ainda não
        // existe na carteira (código 4902), aí sim ADICIONA. Algumas carteiras só
        // aceitam a rede por este caminho (switch → 4902 → add).
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_PARAMS.chainId }] });
          setState("ok");
          return;
        } catch (switchErr: unknown) {
          const sc = (switchErr as { code?: number })?.code;
          if (sc === 4001) throw switchErr; // usuário cancelou
          // 4902 (desconhecida) ou -32603 (interno em algumas carteiras) → segue pro add
          if (sc !== 4902 && sc !== -32603 && sc !== undefined) throw switchErr;
        }
        await eth.request({ method: "wallet_addEthereumChain", params: [CHAIN_PARAMS] });
        setState("ok");
      } catch (e: unknown) {
        // 4001 = usuário cancelou; não é falha técnica.
        const code = (e as { code?: number })?.code;
        setState("error");
        setMsg(
          code === 4001
            ? t("docs_eavm.error.userRejected")
            : e instanceof Error && e.message
              ? e.message
              : t("docs_eavm.error.addFailed"),
        );
      }
      return;
    }
    if (isMobile) {
      // Navegador comum do celular: sem provider. Abre o app da MetaMask no navegador
      // in-app apontando pra ESTA página com ?addNetwork=1 — ao carregar lá dentro, o
      // provider existe e a página AUTO-adiciona a rede (sem exigir um 2º toque).
      const url = new URL(window.location.href);
      url.searchParams.set("addNetwork", "1");
      const mmTarget = (url.host + url.pathname + url.search).replace(/^\/+/, "");
      window.location.href = `https://metamask.app.link/dapp/${mmTarget}`;
      return;
    }
    setState("nowallet");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      {/* card conectar */}
      <div className="card card-glow relative overflow-hidden p-6 sm:p-7">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-[90px]"
          style={{ background: "radial-gradient(circle, rgba(245,196,81,.26), transparent 70%)" }}
        />
        <div className="relative flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-gold">
          <IconNetwork size={14} /> {t("docs_eavm.badge.customNetwork")}
        </div>
        <h2 className="font-display relative mt-3 text-[clamp(20px,3vw,26px)] font-extrabold tracking-tight">
          {t("docs_eavm.title")}
        </h2>
        <p className="relative mt-2 max-w-[52ch] text-[14px] leading-relaxed text-muted">
          {t("docs_eavm.description")}
        </p>
        <div className="relative mt-3 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-line-2 bg-panel/50 px-3 py-1 font-semibold text-ink">
            🦊 {t("docs_eavm.wallets.metamask")}
          </span>
          <span className="rounded-full border border-line-2 bg-panel/50 px-3 py-1 font-semibold text-ink">
            🛡️ {t("docs_eavm.wallets.trustWallet")}
          </span>
          <span className="rounded-full border border-line-2 bg-panel/50 px-3 py-1 text-muted">
            {t("docs_eavm.wallets.anyEvm")}
          </span>
        </div>

        {/* parâmetros */}
        <div className="relative mt-5 grid gap-2 sm:grid-cols-2">
          {PARAMS.map((p) => (
            <div
              key={p.k}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel/50 px-3.5 py-2.5"
            >
              <span className="font-mono text-[10.5px] uppercase tracking-wide text-faint">{p.k}</span>
              <span className="flex items-center gap-1.5 truncate font-mono text-[12px] text-ink">
                <span className="truncate">{p.v}</span>
                {p.copy && <Copy text={p.v} />}
              </span>
            </div>
          ))}
        </div>

        <div className="relative mt-5 flex flex-wrap items-center gap-3">
          <button onClick={() => addNetwork()} disabled={state === "loading"} className="btn-primary btn-lg">
            <IconWallet size={17} />
            {state === "loading"
              ? t("docs_eavm.button.adding")
              : isMobile
                ? t("docs_eavm.button.openInMetamask")
                : t("docs_eavm.button.addToMetamask")}
          </button>
          {isMobile && state === "idle" && (
            <span className="w-full text-[11.5px] text-muted">{t("docs_eavm.status.mobileHint")}</span>
          )}
          {/* Outras carteiras (Trust, etc.): adição manual pelos dados acima. */}
          <span className="w-full text-[11.5px] text-faint">{t("docs_eavm.status.otherWallets")}</span>
          {state === "ok" && (
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ok">
              <span className="livedot" style={{ width: 6, height: 6, background: "var(--ok)" }} />{" "}
              {t("docs_eavm.status.added")}
            </span>
          )}
          {state === "nowallet" && (
            <span className="text-[13px] text-muted">{t("docs_eavm.status.noWallet")}</span>
          )}
          {state === "error" && (
            <span className="w-full text-[13px] text-pink">
              {msg}
              <span className="mt-1 block text-[11.5px] text-muted">{t("docs_eavm.status.addManually")}</span>
            </span>
          )}
        </div>
      </div>

      {/* card mapeamento de endereço + passos */}
      <div className="card relative overflow-hidden p-6 sm:p-7">
        <div className="relative flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-teal">
          <IconQuantumKey size={14} /> {t("docs_eavm.mapping.badge")}
        </div>
        <h3 className="font-display relative mt-3 text-[16px] font-bold">{t("docs_eavm.mapping.title")}</h3>

        {/* mapeamento 0x ↔ E7 */}
        <div className="relative mt-4 space-y-2">
          <div className="flex items-center justify-between rounded-xl border border-line bg-panel/50 px-3.5 py-3">
            <span className="font-mono text-[10px] uppercase tracking-wide text-faint">{t("docs_eavm.mapping.labelEavm")}</span>
            <span className="font-mono text-[12.5px] font-semibold text-blue">0x71C7…9f21</span>
          </div>
          <div className="flex items-center justify-center">
            <span className="grid h-7 w-7 place-items-center rounded-full border border-line-2 bg-panel text-teal">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
              </svg>
            </span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-panel/50 px-3.5 py-3">
            <span className="font-mono text-[10px] uppercase tracking-wide text-faint">{t("docs_eavm.mapping.labelNative")}</span>
            <span className="font-mono text-[12.5px] font-semibold text-violet">E7A4B2…9F21</span>
          </div>
        </div>
        <p className="relative mt-3 text-[12px] leading-relaxed text-muted">
          {t("docs_eavm.mapping.desc1")} <span className="font-mono text-ink">0x…</span>
          {t("docs_eavm.mapping.desc2")}{" "}
          <span className="font-mono text-ink">E7…</span> {t("docs_eavm.mapping.desc3")}
        </p>

        {/* passos */}
        <ol className="relative mt-4 space-y-2 border-t border-line/60 pt-4">
          {STEP_KEYS.map((stepKey, i) => (
            <li key={stepKey} className="flex items-start gap-2.5 text-[12.5px] text-muted">
              <span className="font-display mt-px grid h-5 w-5 flex-none place-items-center rounded-full bg-violet/15 text-[11px] font-bold text-violet">
                {i + 1}
              </span>
              {t(`docs_eavm.steps.${stepKey}`)}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
