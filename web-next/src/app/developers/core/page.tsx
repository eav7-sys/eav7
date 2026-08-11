import type { Metadata } from "next";
import { CodeBlock } from "@/components/developers/code-block";
import { DevPager } from "@/components/developers/dev-pager";
import {
  Callout,
  DevPageHead,
  DevSection,
  DevSections,
  DevTable,
  Mono,
  SpecList,
} from "@/components/developers/dev-page";
import { getT } from "@/i18n/server";

const BUILD = `cd rust
cargo build -p eav7-core -p eav7-node --release
# binários em target/release/eav7-core e eav7-node`;

const LISTEN = `eav7-core init --dir ./data/core-dev \\
  --mode listen --port 6072 --allow-private-peers \\
  --peers http://127.0.0.1:6070

eav7-core run    --dir ./data/core-dev
eav7-core status --dir ./data/core-dev
eav7-core health --dir ./data/core-dev`;

const CANDIDATE = `# saldo, stake, unbonding e se já bateu o mínimo
eav7-core account --dir ./data/core-dev

# valores em EAV7 — 1000 é o piso para entrar na eleição
eav7-core stake --dir ./data/core-dev --amount 1000 --wait

# grava o modo e sobe produzindo se for eleito
eav7-core set-mode candidate --dir ./data/core-dev
eav7-core run --dir ./data/core-dev

eav7-core score   --dir ./data/core-dev
eav7-core unstake --dir ./data/core-dev --amount 100 --wait
eav7-core claim   --dir ./data/core-dev --validator E7… --wait`;

const LOCAL_STACK = `bash bin/eav7-dev-up.sh   # ou: npm run dev:local
bash bin/eav7-testnet-up.sh --fresh`;

const MODES = ["listen", "candidate", "validator"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.core.title"), description: t("dev.core.lede") };
}

export default async function CorePage() {
  const t = await getT();

  return (
    <>
      <DevPageHead eyebrow={t("dev.core.eyebrow")} title={t("dev.core.title")} lede={t("dev.core.lede")} />

      <DevSections>
        <DevSection
          id="build"
          kicker={t("dev.core.buildKicker")}
          title={t("dev.core.buildTitle")}
          intro={t("dev.core.buildIntro")}
        >
          <CodeBlock code={BUILD} label="bash" />
          <div className="mt-5">
            <Callout title={t("dev.core.releaseTitle")}>{t("dev.core.releaseBody")}</Callout>
          </div>
        </DevSection>

        <DevSection
          id="modos"
          kicker={t("dev.core.modesKicker")}
          title={t("dev.core.modesTitle")}
          intro={t("dev.core.modesIntro")}
        >
          <DevTable
            columns={[{ label: t("dev.core.colMode"), width: "w-[140px]" }, { label: t("dev.core.colBehaviour") }]}
          >
            {MODES.map((mode) => (
              <tr key={mode} className="border-b border-line/50 transition-colors hover:bg-violet/[0.04]">
                <td className="py-3 pr-6 align-top">
                  <code className="font-mono text-[12.5px] font-semibold text-ink">{mode}</code>
                </td>
                <td className="py-3 align-top text-[13px] leading-relaxed text-muted">
                  {t(`dev.core.mode.${mode}`)}
                </td>
              </tr>
            ))}
          </DevTable>
          <p className="mt-5 text-[13.5px] leading-relaxed text-muted">{t("dev.core.modesShortcut")}</p>
        </DevSection>

        <DevSection
          id="ouvinte"
          kicker={t("dev.core.listenKicker")}
          title={t("dev.core.listenTitle")}
          intro={t("dev.core.listenIntro")}
        >
          <CodeBlock code={LISTEN} label="bash" />
          <p className="mt-5 text-[13.5px] leading-relaxed text-muted">{t("dev.core.listenBody")}</p>
        </DevSection>

        <DevSection
          id="candidatura"
          kicker={t("dev.core.candidateKicker")}
          title={t("dev.core.candidateTitle")}
          intro={t("dev.core.candidateIntro")}
        >
          <CodeBlock code={CANDIDATE} label="bash" />
          <div className="mt-5">
            <Callout tone="ok" title={t("dev.core.candidateCalloutTitle")}>
              {t("dev.core.candidateCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="caminhos"
          kicker={t("dev.core.pathsKicker")}
          title={t("dev.core.pathsTitle")}
          intro={t("dev.core.pathsIntro")}
        >
          <SpecList
            rows={[
              { k: "Linux", v: <Mono>~/.eav7</Mono> },
              { k: "macOS", v: <Mono>~/Library/Application Support/EAV7</Mono> },
              { k: "Windows", v: <Mono>%APPDATA%\\EAV7</Mono> },
              { k: "EAV7_HOME", v: t("dev.core.pathOverride") },
            ]}
          />
        </DevSection>

        <DevSection
          id="chaves"
          kicker={t("dev.core.keysKicker")}
          title={t("dev.core.keysTitle")}
          intro={t("dev.core.keysIntro")}
        >
          <SpecList
            rows={[
              { k: t("dev.core.keyHot"), v: <Mono>validator-wallet.json</Mono>, note: t("dev.core.keyHotNote") },
              { k: t("dev.core.keyTreasury"), v: t("dev.core.keyTreasuryNote") },
              { k: "init --force", v: t("dev.core.keyForceNote") },
            ]}
          />
        </DevSection>

        <DevSection
          id="servico"
          kicker={t("dev.core.serviceKicker")}
          title={t("dev.core.serviceTitle")}
          intro={t("dev.core.serviceIntro")}
        >
          <SpecList
            rows={[
              { k: "Linux · systemd", v: <Mono>systemctl enable --now eav7-core</Mono>, note: t("dev.core.serviceLinux") },
              { k: "macOS · launchd", v: <Mono>launchctl load ~/Library/LaunchAgents/com.eav7.core.plist</Mono>, note: t("dev.core.serviceMac") },
              { k: "Windows", v: <Mono>NSSM · sc.exe</Mono>, note: t("dev.core.serviceWindows") },
            ]}
          />
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.core.serviceCalloutTitle")}>
              {t("dev.core.serviceCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="stack"
          kicker={t("dev.core.stackKicker")}
          title={t("dev.core.stackTitle")}
          intro={t("dev.core.stackIntro")}
        >
          <CodeBlock code={LOCAL_STACK} label="bash" />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: t("dev.core.stackApi"), v: <Mono>http://127.0.0.1:6070</Mono> },
                { k: t("dev.core.stackExplorer"), v: <Mono>http://127.0.0.1:3000</Mono> },
              ]}
            />
          </div>
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
