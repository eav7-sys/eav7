import Link from "next/link";
import { DevHero } from "@/components/developers/dev-hero";
import { CodeTabs } from "@/components/developers/code-tabs";
import { DevCtaBand, PathList, PortalIndexGroups } from "@/components/developers/landing-blocks";
import { DEV_NAV } from "@/components/developers/nav-data";
import { Reveal } from "@/components/ui/reveal";
import { getT } from "@/i18n/server";

const STATUS_CURL = `curl -s https://eavscan.com/status \\
  -H 'Accept: application/json'

{
  "chain": "EAV7",
  "height": 1284391,
  "finalizedHeight": 1284389,
  "headHash": "9f2c4a…",
  "supply": "72000000000000",
  "validators": 27,
  "blockReward": "16000000"
}`;

const STATUS_RUST = `// Cargo.toml
// eav7-sdk = { git = "https://github.com/eav7/eav7", package = "eav7-sdk" }

let cliente = eav7_sdk::Eav7Client::novo("https://eavscan.com");
let estado = cliente.status()?;

println!(
    "altura {} · {} validadores",
    estado["height"], estado["validators"],
);`;

function SectionHead({ kicker, title, lede }: { kicker: string; title: string; lede?: string }) {
  return (
    <div className="mb-10 max-w-[64ch]">
      <div className="font-mono flex items-center gap-2.5 text-[10.5px] font-semibold uppercase tracking-[2px] text-teal">
        <span className="h-px w-6 bg-gradient-to-r from-teal to-transparent" />
        {kicker}
      </div>
      <h2 className="font-display mt-4 text-[clamp(26px,3.8vw,38px)] font-extrabold leading-[1.08] tracking-[-0.025em]">
        {title}
      </h2>
      {lede && <p className="mt-4 text-[15px] leading-relaxed text-muted">{lede}</p>}
    </div>
  );
}

export default async function DevelopersPage() {
  const t = await getT();

  const paths = [
    {
      href: "/developers/quickstart",
      title: t("dev.hub.path1Title"),
      desc: t("dev.hub.path1Desc"),
      meta: t("dev.hub.path1Meta"),
    },
    {
      href: "/developers/sdk",
      title: t("dev.hub.path2Title"),
      desc: t("dev.hub.path2Desc"),
      meta: t("dev.hub.path2Meta"),
    },
    {
      href: "/developers/guides",
      title: t("dev.hub.path4Title"),
      desc: t("dev.hub.path4Desc"),
      meta: t("dev.hub.path4Meta"),
    },
    {
      href: "/developers/concepts/accounts",
      title: t("dev.hub.path5Title"),
      desc: t("dev.hub.path5Desc"),
      meta: t("dev.hub.path5Meta"),
    },
    {
      href: "/developers/core",
      title: t("dev.hub.path3Title"),
      desc: t("dev.hub.path3Desc"),
      meta: t("dev.hub.path3Meta"),
    },
  ];

  const surfaces = [
    { title: t("dev.hub.restTitle"), port: ":6070", desc: t("dev.hub.restDesc"), href: "/developers/api" },
    { title: t("dev.hub.eavmTitle"), port: ":7070", desc: t("dev.hub.eavmDesc"), href: "/developers/eavm" },
    { title: t("dev.hub.p2pTitle"), port: "P2P", desc: t("dev.hub.p2pDesc"), href: "/developers/core" },
  ];

  return (
    <>
      <DevHero />

      <div className="mx-auto max-w-[1240px] px-5">
        {/* caminhos de entrada */}
        <section className="py-20 sm:py-24">
          <Reveal>
            <SectionHead
              kicker={t("dev.hub.pathsKicker")}
              title={t("dev.hub.pathsTitle")}
              lede={t("dev.hub.pathsLede")}
            />
          </Reveal>
          <Reveal delay={80}>
            <PathList rows={paths} />
          </Reveal>
        </section>

        {/* primeira chamada */}
        <section className="border-t border-line py-20 sm:py-24">
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <Reveal>
              <div>
                <SectionHead kicker={t("dev.hub.firstCallKicker")} title={t("dev.hub.firstCallTitle")} />
                <p className="max-w-[52ch] text-[15px] leading-relaxed text-muted">
                  {t("dev.hub.firstCallBody1")}
                </p>
                <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-muted">
                  {t("dev.hub.firstCallBody2")}
                </p>
                <Link
                  href="/developers/quickstart"
                  className="font-mono mt-7 inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[1.4px] text-violet transition-colors hover:text-teal"
                >
                  {t("dev.hub.firstCallLink")}
                  <span aria-hidden>→</span>
                </Link>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <CodeTabs
                id="hub-status"
                samples={[
                  { label: "curl", code: STATUS_CURL },
                  { label: "Rust", code: STATUS_RUST },
                ]}
              />
            </Reveal>
          </div>
        </section>

        {/* superfícies */}
        <section className="border-t border-line py-20 sm:py-24">
          <Reveal>
            <SectionHead
              kicker={t("dev.hub.surfacesKicker")}
              title={t("dev.hub.surfacesTitle")}
              lede={t("dev.hub.surfacesLede")}
            />
          </Reveal>
          <Reveal delay={80}>
            <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
              {surfaces.map((surface) => (
                <Link
                  key={surface.title}
                  href={surface.href}
                  className="group flex flex-col gap-2 bg-ground px-6 py-7 transition-colors hover:bg-violet/[0.05]"
                >
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[1.4px] text-teal">
                    {surface.port}
                  </span>
                  <span className="font-display text-[17px] font-bold transition-colors group-hover:text-violet">
                    {surface.title}
                  </span>
                  <span className="text-[13.5px] leading-relaxed text-muted">{surface.desc}</span>
                </Link>
              ))}
            </div>
          </Reveal>
          <Reveal delay={140}>
            <div className="mt-8 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-t border-line pt-6">
              <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[1.6px] text-faint">
                {t("dev.hub.unitsTitle")}
              </span>
              <p className="max-w-[70ch] text-[13.5px] leading-relaxed text-muted">
                {t("dev.hub.unitsBody")}
              </p>
            </div>
          </Reveal>
        </section>

        {/* índice do portal */}
        <section className="border-t border-line py-20 sm:py-24">
          <Reveal>
            <SectionHead
              kicker={t("dev.hub.indexKicker")}
              title={t("dev.hub.indexTitle")}
              lede={t("dev.hub.indexLede")}
            />
          </Reveal>
          <Reveal delay={80}>
            <PortalIndexGroups
              groups={DEV_NAV.map((group) => ({
                title: t(group.key),
                entries: group.routes
                  .filter((route) => route.href !== "/developers")
                  .map((route) => ({
                    href: route.href,
                    title: t(route.key),
                    desc: t(route.descKey),
                  })),
              })).filter((group) => group.entries.length > 0)}
            />
          </Reveal>
        </section>
      </div>

      <DevCtaBand
        title={t("dev.hub.ctaTitle")}
        lede={t("dev.hub.ctaLede")}
        primary={{ href: "/developers/quickstart", label: t("dev.hub.ctaPrimary") }}
        secondary={{ href: "/developers/api", label: t("dev.hub.ctaSecondary") }}
      />
    </>
  );
}
