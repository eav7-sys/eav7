import type { Metadata } from "next";
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
  Prereqs,
  SpecList,
} from "@/components/developers/dev-page";
import { getT } from "@/i18n/server";

const CARGO = `[dependencies]
eav7-sdk = { path = "../eav7/rust/sdk" }`;

const CODE = `use eav7_sdk::{Eav7Client, ProductionWallet};
use std::time::Duration;

const UNIT: u128 = 1_000_000;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let carteira = ProductionWallet::from_file("carteira.json")?;
    let cliente = Eav7Client::com_carteira("https://eavscan.com", Box::new(carteira));

    // transferir() resolve o nonce, monta, assina e envia — uma chamada
    let recibo = cliente.transferir("E7DEST…9A02", 5 * UNIT)?;
    if !recibo.accepted {
        eprintln!("recusada: {}", recibo.reason.unwrap_or_default());
        return Ok(());
    }

    let bloco = cliente.aguardar_confirmacao(&recibo.id, Duration::from_secs(30))?;
    println!("confirmada no bloco {}", bloco.block_height);
    Ok(())
}`;

const EXAMPLE = `cargo run -p eav7-sdk --example enviar -- \\
  https://eavscan.com carteira.json E7DEST…9A02 5000000`;

const CHECK_CURL = `curl -s https://eavscan.com/tx/0x8c1f… -H 'Accept: application/json'

{
  "id": "0x8c1f…",
  "type": "TRANSFER",
  "from": "E7A4B2…9F21",
  "to": "E7DEST…9A02",
  "amount": "5000000",
  "fee": "10000",
  "blockHeight": 1284391
}`;

const CHECK_RUST = `let destino = cliente.conta("E7DEST…9A02")?;
println!("saldo do destino: {} e7", destino.balance);`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.gTransfer.title"), description: t("dev.gTransfer.lede") };
}

export default async function TransferGuidePage() {
  const t = await getT();

  return (
    <>
      <DevPageHead
        eyebrow={t("dev.gTransfer.eyebrow")}
        title={t("dev.gTransfer.title")}
        lede={t("dev.gTransfer.lede")}
      />

      <DevSections>
        <DevSection
          id="requisitos"
          kicker={t("dev.common.prereqKicker")}
          title={t("dev.common.prereqTitle")}
          intro={t("dev.gTransfer.prereqIntro")}
        >
          <Prereqs
            title={t("dev.common.prereqLabel")}
            items={[t("dev.gTransfer.prereq1"), t("dev.gTransfer.prereq2"), t("dev.gTransfer.prereq3")]}
          />
        </DevSection>

        <DevSection
          id="passos"
          kicker={t("dev.gTransfer.stepsKicker")}
          title={t("dev.gTransfer.stepsTitle")}
          intro={t("dev.gTransfer.stepsIntro")}
        >
          <DevSteps
            steps={[
              {
                title: t("dev.gTransfer.s1Title"),
                body: t("dev.gTransfer.s1Body"),
                children: <CodeBlock code={CARGO} label="Cargo.toml" />,
              },
              {
                title: t("dev.gTransfer.s2Title"),
                body: t("dev.gTransfer.s2Body"),
                children: <CodeBlock code={CODE} label="Rust · eav7-sdk" />,
              },
              {
                title: t("dev.gTransfer.s3Title"),
                body: t("dev.gTransfer.s3Body"),
                children: (
                  <CodeTabs
                    id="transfer-check"
                    samples={[
                      { label: "curl", code: CHECK_CURL },
                      { label: "Rust", code: CHECK_RUST },
                    ]}
                  />
                ),
              },
            ]}
          />
        </DevSection>

        <DevSection
          id="custo"
          kicker={t("dev.gTransfer.costKicker")}
          title={t("dev.gTransfer.costTitle")}
          intro={t("dev.gTransfer.costIntro")}
        >
          <SpecList
            rows={[
              { k: t("dev.gTransfer.costAmount"), v: <Mono>5 EAV7 = 5 000 000 e7</Mono>, note: t("dev.gTransfer.costAmountNote") },
              { k: "CHAIN.FEES.TRANSFER", v: <Mono>10 000 e7</Mono>, note: t("dev.gTransfer.costFeeNote") },
              { k: t("dev.gTransfer.costEnergy"), v: <Mono>1</Mono>, note: t("dev.gTransfer.costEnergyNote") },
            ]}
          />
          <div className="mt-5">
            <Callout tone="ok" title={t("dev.gTransfer.costCalloutTitle")}>
              {t("dev.gTransfer.costCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="exemplo"
          kicker={t("dev.gTransfer.exampleKicker")}
          title={t("dev.gTransfer.exampleTitle")}
          intro={t("dev.gTransfer.exampleIntro")}
        >
          <CodeBlock code={EXAMPLE} label="bash" />
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/guides/sign-broadcast", label: t("dev.nav.signBroadcast"), desc: t("dev.nav.signBroadcastDesc") },
              { href: "/developers/guides/token-eav20", label: t("dev.nav.tokenGuide"), desc: t("dev.nav.tokenGuideDesc") },
              { href: "/developers/troubleshooting", label: t("dev.nav.troubleshooting"), desc: t("dev.nav.troubleshootingDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
