import type { Metadata } from "next";
import { DevPager } from "@/components/developers/dev-pager";
import { DevPageHead, DevSection, DevSections } from "@/components/developers/dev-page";
import { PortalIndex } from "@/components/developers/landing-blocks";
import { devGroup } from "@/components/developers/nav-data";
import { getT } from "@/i18n/server";

/** Trilhas de leitura: a mesma lista de guias, agrupada por intenção. */
const TRACKS: { key: string; hrefs: string[] }[] = [
  {
    key: "wallet",
    hrefs: [
      "/developers/guides/sign-broadcast",
      "/developers/guides/transfer",
      "/developers/guides/light-client",
    ],
  },
  {
    key: "asset",
    hrefs: ["/developers/guides/token-eav20", "/developers/guides/metamask"],
  },
  {
    key: "network",
    hrefs: ["/developers/guides/stake-vote", "/developers/guides/run-node"],
  },
];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.guides.title"), description: t("dev.guides.lede") };
}

export default async function GuidesIndexPage() {
  const t = await getT();
  const routes = devGroup("dev.nav.groupGuides");

  return (
    <>
      <DevPageHead
        eyebrow={t("dev.guides.eyebrow")}
        title={t("dev.guides.title")}
        lede={t("dev.guides.lede")}
      />

      <DevSections>
        {TRACKS.map((track) => (
          <DevSection
            key={track.key}
            id={track.key}
            kicker={t(`dev.guides.track.${track.key}Kicker`)}
            title={t(`dev.guides.track.${track.key}Title`)}
            intro={t(`dev.guides.track.${track.key}Intro`)}
          >
            <PortalIndex
              entries={track.hrefs.map((href) => {
                const route = routes.find((r) => r.href === href);
                return {
                  href,
                  title: route ? t(route.key) : href,
                  desc: route ? t(route.descKey) : "",
                };
              })}
            />
          </DevSection>
        ))}

        <DevSection
          id="anatomia"
          kicker={t("dev.guides.shapeKicker")}
          title={t("dev.guides.shapeTitle")}
          intro={t("dev.guides.shapeIntro")}
        >
          <ol className="divide-y divide-line/60 border-y border-line">
            {["prereq", "steps", "cost", "next"].map((step, i) => (
              <li key={step} className="flex gap-5 py-3.5">
                <span className="font-mono w-6 flex-none text-[11px] font-semibold tracking-[1.4px] text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[13.5px] leading-relaxed text-muted">
                  {t(`dev.guides.shape.${step}`)}
                </span>
              </li>
            ))}
          </ol>
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
