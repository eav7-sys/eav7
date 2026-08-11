"use client";

import Link from "next/link";
import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import { useQuery } from "@tanstack/react-query";
import { getStatus } from "@/lib/api";
import { num } from "@/lib/format";
import { useT } from "@/i18n/provider";
import {
  IconLayers,
  IconTx,
  IconToken,
  IconValidator,
  IconEnergy,
  IconPulse,
  IconNetwork,
  IconReward,
  IconBlock,
  IconBridge,
  IconQuantumKey,
  IconWallet,
  IconCode,
  IconArrowUpRight,
} from "@/components/icons";

interface Item {
  href: string;
  titleKey: string;
  descKey: string;
  icon: React.ReactNode;
  chip: string;
}
interface Column {
  headingKey: string;
  items: Item[];
}

const IS = 19;

const EXPLORAR: Column[] = [
  {
    headingKey: "menu.h.chain",
    items: [
      { href: "/blocks", titleKey: "terms.blocks", descKey: "menu.d.blocks", icon: <IconLayers size={IS} />, chip: "chip-violet" },
      { href: "/txs", titleKey: "terms.txs", descKey: "menu.d.txs", icon: <IconTx size={IS} />, chip: "chip-teal" },
    ],
  },
  {
    headingKey: "menu.h.assets",
    items: [
      { href: "/tokens", titleKey: "terms.tokensEav20", descKey: "menu.d.tokens", icon: <IconToken size={IS} />, chip: "chip-gold" },
      { href: "/nfts", titleKey: "nav_extra.nfts", descKey: "nav_extra.nftsDesc", icon: <IconLayers size={IS} />, chip: "chip-pink" },
      { href: "/names", titleKey: "nav_extra.names", descKey: "nav_extra.namesDesc", icon: <IconWallet size={IS} />, chip: "chip-teal" },
    ],
  },
];

const REDE: Column[] = [
  {
    headingKey: "menu.h.consensus",
    items: [
      { href: "/validators", titleKey: "terms.validators", descKey: "menu.d.validators", icon: <IconValidator size={IS} />, chip: "chip-violet" },
      { href: "/governance", titleKey: "nav_extra.governance", descKey: "nav_extra.governanceDesc", icon: <IconReward size={IS} />, chip: "chip-gold" },
      { href: "/mining", titleKey: "terms.mining", descKey: "menu.d.mining", icon: <IconEnergy size={IS} />, chip: "chip-blue" },
    ],
  },
  {
    headingKey: "menu.h.learn",
    items: [
      { href: "/docs/consenso", titleKey: "terms.consensusDpos", descKey: "menu.d.consensus", icon: <IconNetwork size={IS} />, chip: "chip-teal" },
      { href: "/docs/staking", titleKey: "terms.staking", descKey: "menu.d.staking", icon: <IconReward size={IS} />, chip: "chip-gold" },
    ],
  },
];

const PROTOCOLO: Column[] = [
  {
    headingKey: "menu.h.fundamentals",
    items: [
      { href: "/docs/sobre", titleKey: "terms.aboutProtocol", descKey: "menu.d.about", icon: <IconBlock size={IS} />, chip: "chip-violet" },
      { href: "/docs/token", titleKey: "terms.tokenStandard", descKey: "menu.d.standard", icon: <IconToken size={IS} />, chip: "chip-gold" },
      { href: "/docs/ponte", titleKey: "terms.bridge", descKey: "menu.d.bridge", icon: <IconBridge size={IS} />, chip: "chip-teal" },
    ],
  },
  {
    headingKey: "menu.h.security",
    items: [
      { href: "/docs/seguranca", titleKey: "terms.security24", descKey: "menu.d.security", icon: <IconQuantumKey size={IS} />, chip: "chip-green" },
      { href: "/docs/eavm", titleKey: "terms.eavm", descKey: "menu.d.eavm", icon: <IconWallet size={IS} />, chip: "chip-pink" },
      { href: "/docs/api", titleKey: "terms.apiRest", descKey: "menu.d.api", icon: <IconCode size={IS} />, chip: "chip-blue" },
    ],
  },
];

function MenuItem({ href, titleKey, descKey, icon, chip }: Item) {
  const t = useT();
  return (
    <NavigationMenu.Link asChild>
      <Link href={href} className="mm-item group">
        <span className={`mm-ico ${chip}`}>{icon}</span>
        <span className="min-w-0">
          <span className="font-display flex items-center gap-1 text-[13.5px] font-bold text-ink">
            {t(titleKey)}
            <IconArrowUpRight size={13} className="-translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-70" />
          </span>
          <span className="block text-[12px] leading-snug text-muted">{t(descKey)}</span>
        </span>
      </Link>
    </NavigationMenu.Link>
  );
}

function Columns({ columns }: { columns: Column[] }) {
  const t = useT();
  return (
    <>
      {columns.map((col) => (
        <div key={col.headingKey}>
          <div className="font-mono px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[1.2px] text-faint">
            {t(col.headingKey)}
          </div>
          <div className="flex flex-col gap-0.5">
            {col.items.map((it) => (
              <MenuItem key={it.href} {...it} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function LiveCard() {
  const t = useT();
  const { data } = useQuery({ queryKey: ["status"], queryFn: getStatus, refetchInterval: 3000 });
  return (
    <Link
      href="/#painel"
      className="flex h-full flex-col justify-between rounded-xl border border-line-2 bg-panel-2 p-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="livedot" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">
            {t("live.network")}
          </span>
        </div>
        <div className="font-display tnum mt-3 text-[28px] font-extrabold leading-none">
          {data ? num(data.height) : "—"}
        </div>
        <div className="font-mono mt-1 text-[11px] text-faint">{t("live.blockHeight")}</div>
      </div>
      <div className="mt-4 flex items-center gap-3 text-[11.5px] text-muted">
        <span className="flex items-center gap-1">
          <IconValidator size={13} /> {data ? data.validators : "—"} {t("live.valShort")}
        </span>
        <span className="flex items-center gap-1">
          <IconPulse size={13} /> {data ? `${data.blockTimeMs / 1000}s` : "—"}
        </span>
      </div>
    </Link>
  );
}

function Footer({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-2 border-t border-line pt-2">
      <NavigationMenu.Link asChild>
        <Link
          href={href}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-violet transition hover:text-teal"
        >
          {label} <IconArrowUpRight size={14} />
        </Link>
      </NavigationMenu.Link>
    </div>
  );
}

function Trigger({ label }: { label: string }) {
  return (
    <NavigationMenu.Trigger className="mm-trigger flex select-none items-center gap-1 rounded-full px-3 py-1.5 text-[13.5px] font-medium text-muted outline-none transition hover:bg-line/60 hover:text-ink data-[state=open]:bg-line/60 data-[state=open]:text-ink">
      {label}
      <svg className="mm-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </NavigationMenu.Trigger>
  );
}

export function MegaMenu() {
  const t = useT();
  return (
    <NavigationMenu.Root className="relative hidden lg:flex" delayDuration={70} skipDelayDuration={300}>
      <NavigationMenu.List className="flex items-center gap-0.5">
        <NavigationMenu.Item>
          <Trigger label={t("menu.explore")} />
          <NavigationMenu.Content className="mm-content">
            <div className="mm-panel w-[660px] p-3">
              <div className="grid grid-cols-[1fr_1fr_0.95fr] gap-3">
                <Columns columns={EXPLORAR} />
                <LiveCard />
              </div>
              <Footer href="/#painel" label={t("actions.viewLivePanel")} />
            </div>
          </NavigationMenu.Content>
        </NavigationMenu.Item>

        <NavigationMenu.Item>
          <Trigger label={t("menu.network")} />
          <NavigationMenu.Content className="mm-content">
            <div className="mm-panel w-[660px] p-3">
              <div className="grid grid-cols-[1fr_1fr_0.95fr] gap-3">
                <Columns columns={REDE} />
                <LiveCard />
              </div>
              <Footer href="/docs/consenso" label={t("actions.runNode")} />
            </div>
          </NavigationMenu.Content>
        </NavigationMenu.Item>

        <NavigationMenu.Item>
          <Trigger label={t("menu.protocol")} />
          <NavigationMenu.Content className="mm-content">
            <div className="mm-panel w-[600px] p-3">
              <div className="grid grid-cols-2 gap-3">
                <Columns columns={PROTOCOLO} />
              </div>
              <Footer href="/docs/sobre" label={t("actions.startOverview")} />
            </div>
          </NavigationMenu.Content>
        </NavigationMenu.Item>
      </NavigationMenu.List>
    </NavigationMenu.Root>
  );
}
