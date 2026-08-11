import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/developers/code-block";
import { CodeTabs } from "@/components/developers/code-tabs";
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

const STATUS_CURL = `curl -s https://eavscan.com/status \\
  -H 'Accept: application/json'`;

const STATUS_RUST = `let cliente = eav7_sdk::Eav7Client::novo("https://eavscan.com");
let estado = cliente.status()?;

println!("altura {}", estado["height"]);`;

const ACCOUNT_CURL = `curl -s https://eavscan.com/address/E7A4B2…9F21 \\
  -H 'Accept: application/json'

{
  "balance": "12500000",
  "staked": "1000000000",
  "nonce": 41,
  "nextNonce": 42,
  "energy": 8000,
  "feeExempt": false,
  "isValidator": false,
  "tokens": []
}`;

const ACCOUNT_RUST = `let conta = cliente.conta("E7A4B2…9F21")?;

println!(
    "{} e7 · stake {} · próximo nonce {}",
    conta.balance, conta.staked, conta.next_nonce,
);`;

const NODE_SHELL = `cd rust
cargo build -p eav7-core -p eav7-node --release

./target/release/eav7-core init --dir ./data/core-dev \\
  --mode listen --port 6072 --allow-private-peers \\
  --peers http://127.0.0.1:6070

./target/release/eav7-core run    --dir ./data/core-dev
./target/release/eav7-core status --dir ./data/core-dev`;

const SEND_RUST = `use eav7_sdk::{Eav7Client, ProductionWallet};
use std::time::Duration;

/// 1 EAV7 = 1 000 000 e7 (CHAIN.UNIT)
const UNIT: u128 = 1_000_000;

let carteira = ProductionWallet::from_file("carteira.json")?;
let cliente = Eav7Client::com_carteira("https://eavscan.com", Box::new(carteira));

// monta, assina localmente (secp256k1 + ML-DSA-44) e envia via POST /tx
let recibo = cliente.transferir("E7DEST…9A02", 5 * UNIT)?;
if !recibo.accepted {
    eprintln!("recusada: {}", recibo.reason.unwrap_or_default());
    return Ok(());
}

let bloco = cliente.aguardar_confirmacao(&recibo.id, Duration::from_secs(30))?;
println!("confirmada no bloco {}", bloco.block_height);`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.quickstart.title"), description: t("dev.quickstart.lede") };
}

export default async function QuickstartPage() {
  const t = await getT();

  return (
    <>
      <DevPageHead
        eyebrow={t("dev.quickstart.eyebrow")}
        title={t("dev.quickstart.title")}
        lede={t("dev.quickstart.lede")}
      />

      <DevSections>
        <DevSection
          id="caminhos"
          kicker={t("dev.quickstart.pathsKicker")}
          title={t("dev.quickstart.pathsTitle")}
          intro={t("dev.quickstart.pathsIntro")}
        >
          <DevSteps
            steps={[
              { title: t("dev.quickstart.pathReadTitle"), body: t("dev.quickstart.pathReadBody") },
              { title: t("dev.quickstart.pathWriteTitle"), body: t("dev.quickstart.pathWriteBody") },
              { title: t("dev.quickstart.pathNodeTitle"), body: t("dev.quickstart.pathNodeBody") },
            ]}
          />
        </DevSection>

        <DevSection
          id="alvo"
          kicker={t("dev.quickstart.step1Kicker")}
          title={t("dev.quickstart.step1Title")}
          intro={t("dev.quickstart.step1Intro")}
        >
          <SpecList
            rows={[
              {
                k: t("dev.quickstart.targetPublic"),
                v: <Mono>https://eavscan.com</Mono>,
                note: t("dev.quickstart.targetPublicNote"),
              },
              {
                k: t("dev.quickstart.targetLocal"),
                v: <Mono>http://127.0.0.1:6070</Mono>,
                note: t("dev.quickstart.targetLocalNote"),
              },
              {
                k: t("dev.quickstart.targetEavm"),
                v: <Mono>https://rpc.eavscan.com</Mono>,
                note: t("dev.quickstart.targetEavmNote"),
              },
            ]}
          />
        </DevSection>

        <DevSection
          id="leitura"
          kicker={t("dev.quickstart.step2Kicker")}
          title={t("dev.quickstart.step2Title")}
          intro={t("dev.quickstart.step2Intro")}
        >
          <CodeTabs
            id="qs-status"
            samples={[
              { label: "curl", code: STATUS_CURL },
              { label: "Rust", code: STATUS_RUST },
            ]}
          />
          <div className="mt-5">
            <Callout title={t("dev.quickstart.step2CalloutTitle")}>
              {t("dev.quickstart.step2CalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="conta"
          kicker={t("dev.quickstart.step3Kicker")}
          title={t("dev.quickstart.step3Title")}
          intro={t("dev.quickstart.step3Intro")}
        >
          <CodeTabs
            id="qs-account"
            samples={[
              { label: "curl", code: ACCOUNT_CURL },
              { label: "Rust", code: ACCOUNT_RUST },
            ]}
          />
          <div className="mt-5">
            <Callout tone="ok" title={t("dev.quickstart.step3CalloutTitle")}>
              {t("dev.quickstart.step3CalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="no"
          kicker={t("dev.quickstart.step4Kicker")}
          title={t("dev.quickstart.step4Title")}
          intro={t("dev.quickstart.step4Intro")}
        >
          <CodeBlock code={NODE_SHELL} label="bash" />
          <p className="mt-5 text-[13.5px] leading-relaxed text-muted">
            {t("dev.quickstart.step4Body")}{" "}
            <Link href="/developers/core" className="text-violet transition-colors hover:text-teal">
              {t("dev.nav.core")}
            </Link>
            .
          </p>
        </DevSection>

        <DevSection
          id="escrita"
          kicker={t("dev.quickstart.step5Kicker")}
          title={t("dev.quickstart.step5Title")}
          intro={t("dev.quickstart.step5Intro")}
        >
          <CodeBlock code={SEND_RUST} label="Rust · eav7-sdk" />
          <div className="mt-5 space-y-3">
            <Callout tone="warn" title={t("dev.quickstart.step5CalloutTitle")}>
              {t("dev.quickstart.step5CalloutBody")}
            </Callout>
            <Callout title={t("dev.quickstart.step5FeeTitle")}>{t("dev.quickstart.step5FeeBody")}</Callout>
          </div>
        </DevSection>

        <DevSection
          id="depois"
          kicker={t("dev.quickstart.nextKicker")}
          title={t("dev.quickstart.nextTitle")}
        >
          <DevLinkList
            items={[
              {
                href: "/developers/guides/sign-broadcast",
                label: t("dev.nav.signBroadcast"),
                desc: t("dev.nav.signBroadcastDesc"),
              },
              { href: "/developers/guides", label: t("dev.nav.guides"), desc: t("dev.nav.guidesDesc") },
              { href: "/developers/networks", label: t("dev.nav.networks"), desc: t("dev.nav.networksDesc") },
              { href: "/developers/sdk", label: t("dev.nav.sdk"), desc: t("dev.nav.sdkDesc") },
              { href: "/developers/api", label: t("dev.nav.api"), desc: t("dev.nav.apiDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
