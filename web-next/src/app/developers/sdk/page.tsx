import type { Metadata } from "next";
import { CodeBlock } from "@/components/developers/code-block";
import { DevPager } from "@/components/developers/dev-pager";
import { Callout, DevPageHead, DevSection, DevSections, DevTable } from "@/components/developers/dev-page";
import { getT } from "@/i18n/server";

const CARGO = `# rust/ é o workspace do monorepo
[dependencies]
eav7-sdk = { path = "sdk" }

# fora do monorepo, aponte para o clone local
# eav7-sdk = { path = "../eav7/rust/sdk" }`;

const CLIENT = `use eav7_sdk::{Eav7Client, ProductionWallet};
use std::time::Duration;

// leitura: nenhum segredo envolvido
let cliente = Eav7Client::novo("https://eavscan.com");

// escrita: o cliente passa a assinar com a carteira
let carteira = ProductionWallet::from_file("carteira.json")?;
let cliente = Eav7Client::com_carteira("https://eavscan.com", Box::new(carteira));

// controle fino
let cliente = Eav7Client::construtor("http://127.0.0.1:6070")
    .timeout(Duration::from_secs(10))
    .construir();`;

const PROOF = `// 1) raiz vinda do HEADER verificado, não do próprio /proof
let raiz = cliente.raiz_confiavel_do_header("latest")?;

// 2) saldo conferido por Merkle contra essa raiz
let saldo = cliente.saldo_provado("E7A4B2…9F21", Some(&raiz))?;
println!("saldo PROVADO: {saldo} e7");`;

const SENDER = `// duas transferências seguidas: a segunda usaria o MESMO nextNonce
// se perguntasse ao nó antes da primeira entrar no mempool.
let mut remetente = cliente.remetente()?;

let a = remetente.transferir("E7DEST…9A02", 5 * UNIT)?;
let b = remetente.transferir("E7OUTRO…41C7", 2 * UNIT)?;

for tx in [a, b] {
    let id = tx.id.expect("assinada");
    cliente.aguardar_confirmacao(&id, Duration::from_secs(30))?;
}`;

const EXAMPLES = `# consulta um nó, depois PROVA o saldo contra o stateRoot
cargo run -p eav7-sdk --example consulta -- http://127.0.0.1:6070 E7A4B2…9F21

# monta, assina e envia uma transferência
cargo run -p eav7-sdk --example enviar -- \\
  http://127.0.0.1:6070 carteira.json E7DEST…9A02 5000000`;

const READ_METHODS = ["status", "conta", "saldo", "proximo_nonce", "bloco", "transacao", "historico", "validadores_tipados", "contrato", "get"];
const PROOF_METHODS = ["raiz_confiavel_do_header", "saldo_provado"];
const WRITE_METHODS = ["transferir", "stake", "unstake", "votar", "reivindicar_recompensa", "executar", "montar", "enviar", "aguardar_confirmacao", "remetente"];

const SIGNATURES: Record<string, string> = {
  status: "status() -> Value",
  conta: "conta(&str) -> Conta",
  saldo: "saldo(&str) -> u128",
  proximo_nonce: "proximo_nonce(&str) -> i64",
  bloco: "bloco(&str) -> Value",
  transacao: "transacao(&str) -> Value",
  historico: "historico(&str, Option<u64>) -> Historico",
  validadores_tipados: "validadores_tipados() -> Vec<Validador>",
  contrato: "contrato(&str) -> Value",
  get: "get(&str) -> Value",
  raiz_confiavel_do_header: "raiz_confiavel_do_header(&str) -> String",
  saldo_provado: "saldo_provado(&str, Option<&str>) -> u128",
  transferir: "transferir(&str, u128) -> Submissao",
  stake: "stake(u128) -> Submissao",
  unstake: "unstake(u128) -> Submissao",
  votar: "votar(Vec<(String, u128)>) -> Submissao",
  reivindicar_recompensa: "reivindicar_recompensa(&str) -> Submissao",
  executar: "executar(&str, u128, impl Fn) -> Submissao",
  montar: "montar(TxSpec) -> Tx",
  enviar: "enviar(&Tx) -> Submissao",
  aguardar_confirmacao: "aguardar_confirmacao(&str, Duration) -> Confirmacao",
  remetente: "remetente() -> Remetente",
};

function MethodRows({ rows }: { rows: { signature: string; desc: string }[] }) {
  return (
    <>
      {rows.map((row) => (
        <tr key={row.signature} className="border-b border-line/50 transition-colors hover:bg-violet/[0.04]">
          <td className="py-2.5 pr-6 align-top">
            <code className="font-mono whitespace-nowrap text-[12.5px] font-semibold text-ink">
              {row.signature}
            </code>
          </td>
          <td className="py-2.5 align-top text-[13px] leading-relaxed text-muted">{row.desc}</td>
        </tr>
      ))}
    </>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.sdk.title"), description: t("dev.sdk.lede") };
}

export default async function SdkPage() {
  const t = await getT();

  const rowsFor = (names: string[]) =>
    names.map((name) => ({ signature: SIGNATURES[name], desc: t(`dev.sdk.m.${name}`) }));

  const columns = [{ label: t("dev.sdk.colMethod") }, { label: t("dev.sdk.colDesc") }];

  return (
    <>
      <DevPageHead eyebrow={t("dev.sdk.eyebrow")} title={t("dev.sdk.title")} lede={t("dev.sdk.lede")} />

      <DevSections>
        <DevSection
          id="instalar"
          kicker={t("dev.sdk.installKicker")}
          title={t("dev.sdk.installTitle")}
          intro={t("dev.sdk.installIntro")}
        >
          <CodeBlock code={CARGO} label="Cargo.toml" />
          <div className="mt-5">
            <Callout title={t("dev.sdk.installCalloutTitle")}>{t("dev.sdk.installCalloutBody")}</Callout>
          </div>
        </DevSection>

        <DevSection
          id="cliente"
          kicker={t("dev.sdk.clientKicker")}
          title={t("dev.sdk.clientTitle")}
          intro={t("dev.sdk.clientIntro")}
        >
          <CodeBlock code={CLIENT} label="Rust" />
        </DevSection>

        <DevSection
          id="leitura"
          kicker={t("dev.sdk.readKicker")}
          title={t("dev.sdk.readTitle")}
          intro={t("dev.sdk.readIntro")}
        >
          <DevTable columns={columns}>
            <MethodRows rows={rowsFor(READ_METHODS)} />
          </DevTable>
        </DevSection>

        <DevSection
          id="provas"
          kicker={t("dev.sdk.proofKicker")}
          title={t("dev.sdk.proofTitle")}
          intro={t("dev.sdk.proofIntro")}
        >
          <DevTable columns={columns}>
            <MethodRows rows={rowsFor(PROOF_METHODS)} />
          </DevTable>
          <div className="mt-6">
            <CodeBlock code={PROOF} label="Rust" />
          </div>
          <div className="mt-5">
            <Callout tone="ok" title={t("dev.sdk.proofCalloutTitle")}>
              {t("dev.sdk.proofCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="escrita"
          kicker={t("dev.sdk.writeKicker")}
          title={t("dev.sdk.writeTitle")}
          intro={t("dev.sdk.writeIntro")}
        >
          <DevTable columns={columns}>
            <MethodRows rows={rowsFor(WRITE_METHODS)} />
          </DevTable>
        </DevSection>

        <DevSection
          id="remetente"
          kicker={t("dev.sdk.senderKicker")}
          title={t("dev.sdk.senderTitle")}
          intro={t("dev.sdk.senderIntro")}
        >
          <CodeBlock code={SENDER} label="Rust" />
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.sdk.senderCalloutTitle")}>
              {t("dev.sdk.senderCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="exemplos"
          kicker={t("dev.sdk.examplesKicker")}
          title={t("dev.sdk.examplesTitle")}
          intro={t("dev.sdk.examplesIntro")}
        >
          <CodeBlock code={EXAMPLES} label="bash" />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
