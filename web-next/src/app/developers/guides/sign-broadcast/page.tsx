import type { Metadata } from "next";
import { CodeBlock } from "@/components/developers/code-block";
import { CodeTabs } from "@/components/developers/code-tabs";
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

const WALLET = `use eav7_sdk::{Eav7Client, ProductionWallet};
use eav7::transaction::TxSpec;
use std::time::Duration;

const UNIT: u128 = 1_000_000; // 1 EAV7 = 1 000 000 e7

let carteira = ProductionWallet::from_file("carteira.json")?;
let cliente = Eav7Client::com_carteira("https://eavscan.com", Box::new(carteira));

// o endereço NÃO é informado: sai das duas chaves públicas
let de = cliente.endereco().expect("cliente com carteira");`;

const NONCE = `// nextNonce já considera o que este remetente tem no mempool
let nonce = cliente.proximo_nonce(&de)?;`;

const BUILD = `let spec = TxSpec::nova("TRANSFER", 5 * UNIT, nonce, agora_ms())
    .para("E7DEST…9A02");

// monta, assina (secp256k1 + ML-DSA-44) e VERIFICA localmente.
// Um erro aqui é o mesmo erro que o nó daria — sem gastar uma ida à rede.
let tx = cliente.montar(spec)?;`;

const ENVELOPE = `{
  "protocol": "eav20",
  "scheme": "eav7-hybrid-1",
  "type": "TRANSFER",
  "from": "E7A4B2…9F21",
  "to": "E7DEST…9A02",
  "amount": "5000000",
  "fee": "10000",
  "nonce": 42,
  "timestamp": 1770000000000,
  "data": null,

  "publicKey": "-----BEGIN PUBLIC KEY-----…",
  "pqPublicKey": "-----BEGIN PUBLIC KEY-----…",
  "signature": "MEQCIF…",
  "pqSignature": "hQ8xR2…",
  "id": "0x8c1f…"
}`;

const SEND_RUST = `let recibo = cliente.enviar(&tx)?;

if !recibo.accepted {
    eprintln!("recusada: {}", recibo.reason.unwrap_or_default());
    return Ok(());
}
println!("no mempool: {}", recibo.id);`;

const SEND_CURL = `curl -s -X POST https://eavscan.com/tx \\
  -H 'Content-Type: application/json' \\
  --data @tx.json

{ "accepted": true, "id": "0x8c1f…" }`;

const CONFIRM = `let bloco = cliente.aguardar_confirmacao(&recibo.id, Duration::from_secs(30))?;
println!("confirmada no bloco {}", bloco.block_height);

// TempoEsgotado NÃO é veredito: a transação pode entrar depois do prazo.
// Reconsulte /tx/{id} antes de reenviar — reenviar cria um segundo nonce.`;

const OFFLINE = `// MÁQUINA FRIA — a carteira vive aqui, e montar() não toca a rede.
// O nonce precisa ter sido lido antes, na máquina conectada.
let tx = cliente.montar(
    TxSpec::nova("TRANSFER", 5 * UNIT, nonce, agora_ms()).para("E7DEST…9A02"),
)?;
// A transação assinada é um valor comum: leve-a por arquivo, QR ou fila.

// MÁQUINA QUENTE — cliente SEM carteira, só transporte.
let publicador = Eav7Client::novo("https://eavscan.com");
let recibo = publicador.enviar(&tx)?;`;

const BATCH = `// Duas escritas seguidas: a segunda leria o MESMO nextNonce se
// perguntasse ao nó antes de a primeira entrar no mempool.
let mut remetente = cliente.remetente()?;

let a = remetente.stake(1_000 * UNIT)?;
let b = remetente.votar(vec![("E7VAL…77A1".into(), 500 * UNIT)])?;

for tx in [a, b] {
    let id = tx.id.expect("assinada");
    cliente.aguardar_confirmacao(&id, Duration::from_secs(30))?;
}`;

const RESPONSES = ["accepted", "rejected", "known", "http400", "http429"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.gSign.title"), description: t("dev.gSign.lede") };
}

export default async function SignBroadcastPage() {
  const t = await getT();

  return (
    <>
      <DevPageHead eyebrow={t("dev.gSign.eyebrow")} title={t("dev.gSign.title")} lede={t("dev.gSign.lede")} />

      <DevSections>
        <DevSection
          id="requisitos"
          kicker={t("dev.common.prereqKicker")}
          title={t("dev.common.prereqTitle")}
          intro={t("dev.gSign.prereqIntro")}
        >
          <Prereqs
            title={t("dev.common.prereqLabel")}
            items={[
              t("dev.gSign.prereq1"),
              t("dev.gSign.prereq2"),
              t("dev.gSign.prereq3"),
              t("dev.gSign.prereq4"),
            ]}
          />
        </DevSection>

        <DevSection
          id="o-que-e-assinar"
          kicker={t("dev.gSign.whatKicker")}
          title={t("dev.gSign.whatTitle")}
          intro={t("dev.gSign.whatIntro")}
        >
          <SpecList
            rows={[
              { k: t("dev.gSign.whatPayload"), v: t("dev.gSign.whatPayloadBody") },
              { k: t("dev.gSign.whatHybrid"), v: t("dev.gSign.whatHybridBody") },
              { k: t("dev.gSign.whatFrom"), v: t("dev.gSign.whatFromBody") },
              { k: t("dev.gSign.whatId"), v: t("dev.gSign.whatIdBody") },
            ]}
          />
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.gSign.whatCalloutTitle")}>
              {t("dev.gSign.whatCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="passos"
          kicker={t("dev.gSign.stepsKicker")}
          title={t("dev.gSign.stepsTitle")}
          intro={t("dev.gSign.stepsIntro")}
        >
          <DevSteps
            steps={[
              {
                title: t("dev.gSign.s1Title"),
                body: t("dev.gSign.s1Body"),
                children: <CodeBlock code={WALLET} label="Rust · eav7-sdk" />,
              },
              {
                title: t("dev.gSign.s2Title"),
                body: t("dev.gSign.s2Body"),
                children: <CodeBlock code={NONCE} label="Rust" />,
              },
              {
                title: t("dev.gSign.s3Title"),
                body: t("dev.gSign.s3Body"),
                children: <CodeBlock code={BUILD} label="Rust" />,
              },
              {
                title: t("dev.gSign.s4Title"),
                body: t("dev.gSign.s4Body"),
                children: <CodeBlock code={ENVELOPE} label="tx.json" />,
              },
              {
                title: t("dev.gSign.s5Title"),
                body: t("dev.gSign.s5Body"),
                children: (
                  <CodeTabs
                    id="sign-send"
                    samples={[
                      { label: "Rust", code: SEND_RUST },
                      { label: "curl", code: SEND_CURL },
                    ]}
                  />
                ),
              },
              {
                title: t("dev.gSign.s6Title"),
                body: t("dev.gSign.s6Body"),
                children: <CodeBlock code={CONFIRM} label="Rust" />,
              },
            ]}
          />
        </DevSection>

        <DevSection
          id="respostas"
          kicker={t("dev.gSign.respKicker")}
          title={t("dev.gSign.respTitle")}
          intro={t("dev.gSign.respIntro")}
        >
          <DevTable
            columns={[
              { label: t("dev.gSign.colResponse"), width: "w-[230px]" },
              { label: t("dev.gSign.colMeaning") },
            ]}
          >
            <DevRows
              rows={RESPONSES.map((key) => ({
                k: key,
                cells: [t(`dev.gSign.resp.${key}Code`), t(`dev.gSign.resp.${key}Body`)],
              }))}
            />
          </DevTable>
        </DevSection>

        <DevSection
          id="offline"
          kicker={t("dev.gSign.offlineKicker")}
          title={t("dev.gSign.offlineTitle")}
          intro={t("dev.gSign.offlineIntro")}
        >
          <CodeBlock code={OFFLINE} label="Rust" />
          <div className="mt-5">
            <Callout tone="ok" title={t("dev.gSign.offlineCalloutTitle")}>
              {t("dev.gSign.offlineCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="rajada"
          kicker={t("dev.gSign.batchKicker")}
          title={t("dev.gSign.batchTitle")}
          intro={t("dev.gSign.batchIntro")}
        >
          <CodeBlock code={BATCH} label="Rust" />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: t("dev.gSign.batchReserve"), v: t("dev.gSign.batchReserveBody") },
                { k: t("dev.gSign.batchFail"), v: t("dev.gSign.batchFailBody") },
                { k: "MAX_FUTURE_NONCE_GAP", v: <Mono>64</Mono>, note: t("dev.gSign.batchGap") },
              ]}
            />
          </div>
        </DevSection>

        <DevSection
          id="armadilhas"
          kicker={t("dev.gSign.trapKicker")}
          title={t("dev.gSign.trapTitle")}
          intro={t("dev.gSign.trapIntro")}
        >
          <div className="space-y-3">
            <Callout tone="warn" title={t("dev.gSign.trap1Title")}>{t("dev.gSign.trap1Body")}</Callout>
            <Callout tone="warn" title={t("dev.gSign.trap2Title")}>{t("dev.gSign.trap2Body")}</Callout>
            <Callout tone="warn" title={t("dev.gSign.trap3Title")}>{t("dev.gSign.trap3Body")}</Callout>
            <Callout title={t("dev.gSign.trap4Title")}>{t("dev.gSign.trap4Body")}</Callout>
          </div>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/guides/transfer", label: t("dev.nav.transfer"), desc: t("dev.nav.transferDesc") },
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
