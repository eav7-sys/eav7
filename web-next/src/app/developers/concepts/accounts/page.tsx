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
  DevTable,
  Mono,
  SpecList,
} from "@/components/developers/dev-page";
import { getT } from "@/i18n/server";

const ADDRESS_SHAPE = `E7 A4B2C7D1E0F39A5B6C8D1E2F 9F21
│  │                        │
│  │                        └─ 4 hex de checksum: SHA3-256("EAV7-ADDR:" + corpo)
│  └─ 28 hex MAIÚSCULOS: 14 bytes do SHA3-256 do material da chave
└─ prefixo fixo do endereço (a HASH usa minúscula — não normalize os dois juntos)

34 caracteres no total.`;

const NONCE_CURL = `curl -s https://eavscan.com/address/E7A4B2…9F21 \\
  -H 'Accept: application/json'

{
  "balance": "12500000",
  "staked": "1000000000",
  "nonce": 41,
  "nextNonce": 42,
  "energy": 8000,
  "feeExempt": true,
  "isValidator": false,
  "unbonding": [],
  "tokens": []
}`;

const NONCE_RUST = `let conta = cliente.conta("E7A4B2…9F21")?;

// nonce = o CONFIRMADO em estado; next_nonce já conta o mempool.
println!("{} · {}", conta.balance, conta.next_nonce);

let n = cliente.proximo_nonce("E7A4B2…9F21")?; // atalho para o mesmo campo`;

const MAPPING = `# regra padrão: qualquer 0x deriva uma conta nativa
0x71C7…9f21  ──►  E7 = derive("EAV7-EAVM:0x71c7…9f21")

# rota reservada: um E7 literal viaja dentro de um endereço de 20 bytes
0xe7000000 + 32 hex minúsculos  ──►  E7 + os mesmos 32 hex em MAIÚSCULA

# o saldo do mundo 0x É o da conta nativa correspondente — um ledger só`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.accounts.title"), description: t("dev.accounts.lede") };
}

export default async function AccountsPage() {
  const t = await getT();

  return (
    <>
      <DevPageHead
        eyebrow={t("dev.accounts.eyebrow")}
        title={t("dev.accounts.title")}
        lede={t("dev.accounts.lede")}
      />

      <DevSections>
        <DevSection
          id="formato"
          kicker={t("dev.accounts.formatKicker")}
          title={t("dev.accounts.formatTitle")}
          intro={t("dev.accounts.formatIntro")}
        >
          <CodeBlock code={ADDRESS_SHAPE} label="E7" />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: t("dev.accounts.specPrefix"), v: <Mono>E7</Mono>, note: t("dev.accounts.specPrefixNote") },
                { k: t("dev.accounts.specLength"), v: <Mono>34</Mono>, note: t("dev.accounts.specLengthNote") },
                {
                  k: t("dev.accounts.specChecksum"),
                  v: <Mono>SHA3-256(&quot;EAV7-ADDR:&quot; + corpo)</Mono>,
                  note: t("dev.accounts.specChecksumNote"),
                },
              ]}
            />
          </div>
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.accounts.caseTitle")}>
              {t("dev.accounts.caseBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="chaves"
          kicker={t("dev.accounts.keysKicker")}
          title={t("dev.accounts.keysTitle")}
          intro={t("dev.accounts.keysIntro")}
        >
          <SpecList
            rows={[
              { k: "secp256k1", v: <Mono>publicKey · signature</Mono>, note: t("dev.accounts.keyEcdsa") },
              { k: "ML-DSA-44", v: <Mono>pqPublicKey · pqSignature</Mono>, note: t("dev.accounts.keyPq") },
              { k: t("dev.accounts.keyAddress"), v: <Mono>address_from_public_keys(ecdsa, pq)</Mono>, note: t("dev.accounts.keyAddressNote") },
            ]}
          />
          <div className="mt-5">
            <Callout tone="ok" title={t("dev.accounts.keysCalloutTitle")}>
              {t("dev.accounts.keysCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="nonce"
          kicker={t("dev.accounts.nonceKicker")}
          title={t("dev.accounts.nonceTitle")}
          intro={t("dev.accounts.nonceIntro")}
        >
          <CodeTabs
            id="acc-nonce"
            samples={[
              { label: "curl", code: NONCE_CURL },
              { label: "Rust", code: NONCE_RUST },
            ]}
          />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: "nonce", v: t("dev.accounts.nonceConfirmed") },
                { k: "nextNonce", v: t("dev.accounts.nonceNext") },
                { k: "MAX_FUTURE_NONCE_GAP", v: <Mono>64</Mono>, note: t("dev.accounts.nonceGap") },
              ]}
            />
          </div>
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.accounts.nonceCalloutTitle")}>
              {t("dev.accounts.nonceCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="mapeamento"
          kicker={t("dev.accounts.mapKicker")}
          title={t("dev.accounts.mapTitle")}
          intro={t("dev.accounts.mapIntro")}
        >
          <CodeBlock code={MAPPING} label="0x ↔ E7" />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: "eavmToE7", v: <Mono>derive(&quot;EAV7-EAVM:&quot; + addr0x)</Mono>, note: t("dev.accounts.mapDerive") },
                { k: "decodeE7Dest", v: <Mono>0xe7000000…</Mono>, note: t("dev.accounts.mapDest") },
                { k: t("dev.accounts.mapLedger"), v: t("dev.accounts.mapLedgerBody") },
              ]}
            />
          </div>
        </DevSection>

        <DevSection
          id="campos"
          kicker={t("dev.accounts.fieldsKicker")}
          title={t("dev.accounts.fieldsTitle")}
          intro={t("dev.accounts.fieldsIntro")}
        >
          <DevTable columns={[{ label: t("dev.accounts.colField"), width: "w-[190px]" }, { label: t("dev.accounts.colMeaning") }]}>
            <DevRows
              rows={[
                "balance",
                "staked",
                "nonce",
                "nextNonce",
                "gb",
                "energy",
                "feeExempt",
                "isValidator",
                "unbonding",
                "claimableVoterReward",
                "tokens",
              ].map((field) => ({ k: field, cells: [field, t(`dev.accounts.field.${field}`)] }))}
            />
          </DevTable>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/concepts/resources", label: t("dev.nav.resources"), desc: t("dev.nav.resourcesDesc") },
              { href: "/developers/guides/sign-broadcast", label: t("dev.nav.signBroadcast"), desc: t("dev.nav.signBroadcastDesc") },
              { href: "/developers/api", label: t("dev.nav.api"), desc: t("dev.nav.apiDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
