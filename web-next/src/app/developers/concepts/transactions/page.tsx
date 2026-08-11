import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/developers/code-block";
import { DevPager } from "@/components/developers/dev-pager";
import {
  Callout,
  DevLinkList,
  DevPageHead,
  DevSection,
  DevSections,
  DevSteps,
  Mono,
  SpecList,
} from "@/components/developers/dev-page";
import { getT } from "@/i18n/server";

const BUILD = `let spec = TxSpec::nova("TRANSFER", 5 * UNIT, nonce, agora_ms())
    .para("E7DEST…9A02");

// monta + assina + verifica LOCALMENTE (mesmo caminho que o nó aplicaria)
let tx = cliente.montar(spec)?;`;

const SUBMIT = `curl -s -X POST https://eavscan.com/tx \\
  -H 'Content-Type: application/json' \\
  --data @tx.json

{ "accepted": true, "id": "0x8c1f…" }`;

const CONFIRM = `let bloco = cliente.aguardar_confirmacao(&id, Duration::from_secs(30))?;
println!("bloco {} · {}", bloco.block_height, bloco.block_hash);`;

const FINALIZE = `let estado = cliente.status()?;
let finalizada = estado["finalizedHeight"].as_i64().unwrap_or(-1);

if finalizada >= bloco.block_height as i64 {
    // irreversível por BFT: nenhum reorg pode desfazer daqui para trás
}`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.lifecycle.title"), description: t("dev.lifecycle.lede") };
}

export default async function LifecyclePage() {
  const t = await getT();

  return (
    <>
      <DevPageHead
        eyebrow={t("dev.lifecycle.eyebrow")}
        title={t("dev.lifecycle.title")}
        lede={t("dev.lifecycle.lede")}
      />

      <DevSections>
        <DevSection
          id="ciclo"
          kicker={t("dev.lifecycle.cycleKicker")}
          title={t("dev.lifecycle.cycleTitle")}
          intro={t("dev.lifecycle.cycleIntro")}
        >
          <DevSteps
            steps={[
              {
                title: t("dev.lifecycle.step1Title"),
                body: t("dev.lifecycle.step1Body"),
                children: <CodeBlock code={BUILD} label="Rust · eav7-sdk" />,
              },
              { title: t("dev.lifecycle.step2Title"), body: t("dev.lifecycle.step2Body") },
              {
                title: t("dev.lifecycle.step3Title"),
                body: t("dev.lifecycle.step3Body"),
                children: <CodeBlock code={SUBMIT} label="bash" />,
              },
              { title: t("dev.lifecycle.step4Title"), body: t("dev.lifecycle.step4Body") },
              {
                title: t("dev.lifecycle.step5Title"),
                body: t("dev.lifecycle.step5Body"),
                children: <CodeBlock code={CONFIRM} label="Rust" />,
              },
              {
                title: t("dev.lifecycle.step6Title"),
                body: t("dev.lifecycle.step6Body"),
                children: <CodeBlock code={FINALIZE} label="Rust" />,
              },
            ]}
          />
        </DevSection>

        <DevSection
          id="aceito"
          kicker={t("dev.lifecycle.acceptedKicker")}
          title={t("dev.lifecycle.acceptedTitle")}
          intro={t("dev.lifecycle.acceptedIntro")}
        >
          <SpecList
            rows={[
              { k: "accepted: true", v: t("dev.lifecycle.stateAccepted") },
              { k: "blockHeight", v: t("dev.lifecycle.stateIncluded") },
              { k: "finalizedHeight", v: t("dev.lifecycle.stateFinal") },
            ]}
          />
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.lifecycle.acceptedCalloutTitle")}>
              {t("dev.lifecycle.acceptedCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="mempool"
          kicker={t("dev.lifecycle.mempoolKicker")}
          title={t("dev.lifecycle.mempoolTitle")}
          intro={t("dev.lifecycle.mempoolIntro")}
        >
          <SpecList
            rows={[
              { k: "MAX_MEMPOOL", v: <Mono>5 000</Mono>, note: t("dev.lifecycle.memMax") },
              { k: "MEMPOOL_TTL_MS", v: <Mono>21 600 000 · 6 h</Mono>, note: t("dev.lifecycle.memTtl") },
              { k: "MAX_TXS_PER_BLOCK", v: <Mono>500</Mono>, note: t("dev.lifecycle.memBlock") },
              { k: t("dev.lifecycle.memOrder"), v: <Mono>(nonce, timestamp)</Mono>, note: t("dev.lifecycle.memOrderNote") },
            ]}
          />
        </DevSection>

        <DevSection
          id="envelope"
          kicker={t("dev.lifecycle.envelopeKicker")}
          title={t("dev.lifecycle.envelopeTitle")}
          intro={t("dev.lifecycle.envelopeIntro")}
        >
          <p className="text-[13.5px] leading-relaxed text-muted">
            {t("dev.lifecycle.envelopeBody")}{" "}
            <Link href="/developers/transactions" className="text-violet transition-colors hover:text-teal">
              {t("dev.nav.transactions")}
            </Link>
            .
          </p>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/guides/sign-broadcast", label: t("dev.nav.signBroadcast"), desc: t("dev.nav.signBroadcastDesc") },
              { href: "/developers/concepts/finality", label: t("dev.nav.finality"), desc: t("dev.nav.finalityDesc") },
              { href: "/developers/errors", label: t("dev.nav.errors"), desc: t("dev.nav.errorsDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
