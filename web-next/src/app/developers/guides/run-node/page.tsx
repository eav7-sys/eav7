import type { Metadata } from "next";
import { CodeBlock } from "@/components/developers/code-block";
import { DevPager } from "@/components/developers/dev-pager";
import {
  Callout,
  DevLinkList,
  DevPageHead,
  DevRows,
  DevSection,
  DevSections,
  DevSteps,
  DevTable,
  Mono,
  Prereqs,
  SpecList,
} from "@/components/developers/dev-page";
import { getT } from "@/i18n/server";

const BUILD = `cd rust
cargo build -p eav7-core -p eav7-node --release
# binários em target/release/eav7-core e eav7-node`;

const INIT = `eav7-core init --dir ./data/core-dev \\
  --mode listen --port 6072 --allow-private-peers \\
  --peers http://127.0.0.1:6070`;

const RUN = `eav7-core run    --dir ./data/core-dev
eav7-core status --dir ./data/core-dev
eav7-core health --dir ./data/core-dev`;

const FUND = `# saldo, stake, unbonding e se já bateu o mínimo da eleição
eav7-core account --dir ./data/core-dev

# valores em EAV7 — 1000 é o piso para entrar no top-27
eav7-core stake --dir ./data/core-dev --amount 1000 --wait`;

const CANDIDATE = `eav7-core set-mode candidate --dir ./data/core-dev
eav7-core run --dir ./data/core-dev

# desempenho da lista, com a sua carteira marcada
eav7-core score --dir ./data/core-dev`;

const SERVICE = `# Linux (systemd)
sudo cp deploy/eav7-core.service.example /etc/systemd/system/eav7-core.service
sudo systemctl enable --now eav7-core

# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.eav7.core.plist`;

const MODES = ["listen", "candidate", "validator"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.gNode.title"), description: t("dev.gNode.lede") };
}

export default async function RunNodeGuidePage() {
  const t = await getT();

  return (
    <>
      <DevPageHead eyebrow={t("dev.gNode.eyebrow")} title={t("dev.gNode.title")} lede={t("dev.gNode.lede")} />

      <DevSections>
        <DevSection
          id="requisitos"
          kicker={t("dev.common.prereqKicker")}
          title={t("dev.common.prereqTitle")}
          intro={t("dev.gNode.prereqIntro")}
        >
          <Prereqs
            title={t("dev.common.prereqLabel")}
            items={[t("dev.gNode.prereq1"), t("dev.gNode.prereq2"), t("dev.gNode.prereq3")]}
          />
        </DevSection>

        <DevSection
          id="modos"
          kicker={t("dev.gNode.modesKicker")}
          title={t("dev.gNode.modesTitle")}
          intro={t("dev.gNode.modesIntro")}
        >
          <DevTable
            columns={[{ label: t("dev.gNode.colMode"), width: "w-[150px]" }, { label: t("dev.gNode.colBehaviour") }]}
          >
            <DevRows rows={MODES.map((mode) => ({ k: mode, cells: [mode, t(`dev.core.mode.${mode}`)] }))} />
          </DevTable>
        </DevSection>

        <DevSection
          id="passos"
          kicker={t("dev.gNode.stepsKicker")}
          title={t("dev.gNode.stepsTitle")}
          intro={t("dev.gNode.stepsIntro")}
        >
          <DevSteps
            steps={[
              {
                title: t("dev.gNode.s1Title"),
                body: t("dev.gNode.s1Body"),
                children: <CodeBlock code={BUILD} label="bash" />,
              },
              {
                title: t("dev.gNode.s2Title"),
                body: t("dev.gNode.s2Body"),
                children: <CodeBlock code={INIT} label="bash" />,
              },
              {
                title: t("dev.gNode.s3Title"),
                body: t("dev.gNode.s3Body"),
                children: <CodeBlock code={RUN} label="bash" />,
              },
              {
                title: t("dev.gNode.s4Title"),
                body: t("dev.gNode.s4Body"),
                children: <CodeBlock code={FUND} label="bash" />,
              },
              {
                title: t("dev.gNode.s5Title"),
                body: t("dev.gNode.s5Body"),
                children: <CodeBlock code={CANDIDATE} label="bash" />,
              },
            ]}
          />
        </DevSection>

        <DevSection
          id="servico"
          kicker={t("dev.gNode.serviceKicker")}
          title={t("dev.gNode.serviceTitle")}
          intro={t("dev.gNode.serviceIntro")}
        >
          <CodeBlock code={SERVICE} label="bash" />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: "Linux", v: <Mono>~/.eav7</Mono>, note: t("dev.gNode.pathLinux") },
                { k: "macOS", v: <Mono>~/Library/Application Support/EAV7</Mono> },
                { k: "Windows", v: <Mono>%APPDATA%\\EAV7</Mono>, note: t("dev.gNode.pathWindows") },
                { k: "EAV7_HOME", v: t("dev.gNode.pathOverride") },
              ]}
            />
          </div>
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.gNode.keysTitle")}>{t("dev.gNode.keysBody")}</Callout>
          </div>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/core", label: t("dev.nav.core"), desc: t("dev.nav.coreDesc") },
              { href: "/developers/guides/stake-vote", label: t("dev.nav.stakeVote"), desc: t("dev.nav.stakeVoteDesc") },
              { href: "/developers/troubleshooting", label: t("dev.nav.troubleshooting"), desc: t("dev.nav.troubleshootingDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
