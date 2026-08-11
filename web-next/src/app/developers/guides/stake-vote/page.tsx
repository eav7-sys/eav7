import type { Metadata } from "next";
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
  Prereqs,
  SpecList,
} from "@/components/developers/dev-page";
import { getT } from "@/i18n/server";

const STAKE = `let mut remetente = cliente.remetente()?;

// STAKE move saldo para o peso de consenso da própria conta
let tx = remetente.stake(1_000 * UNIT)?;
cliente.aguardar_confirmacao(&tx.id.expect("assinada"), Duration::from_secs(30))?;`;

const VOTE = `// o peso é distribuído entre candidatos: endereço → e7
let tx = remetente.votar(vec![
    ("E7VAL1…77A1".to_string(), 600 * UNIT),
    ("E7VAL2…0C42".to_string(), 400 * UNIT),
])?;`;

const CLAIM = `// a recompensa é POR VALIDADOR VOTADO — o endereço é obrigatório
let tx = remetente.reivindicar_recompensa("E7VAL1…77A1")?;

let conta = cliente.conta(&de)?;
println!("ainda a resgatar: {} e7", conta.claimable_voter_reward);`;

const UNSTAKE = `let tx = remetente.unstake(100 * UNIT)?;

// o valor NÃO volta na hora: entra em unbonding e matura por altura
for parcela in cliente.conta(&de)?.unbonding {
    println!("{} e7 liberam em {} blocos", parcela.amount, parcela.blocks_left);
}`;

const VALIDATORS = `curl -s https://eavscan.com/validators -H 'Accept: application/json' \\
  | jq '.current[0:3] | .[] | { address, staked, votes }'`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.gStake.title"), description: t("dev.gStake.lede") };
}

export default async function StakeVoteGuidePage() {
  const t = await getT();

  return (
    <>
      <DevPageHead eyebrow={t("dev.gStake.eyebrow")} title={t("dev.gStake.title")} lede={t("dev.gStake.lede")} />

      <DevSections>
        <DevSection
          id="requisitos"
          kicker={t("dev.common.prereqKicker")}
          title={t("dev.common.prereqTitle")}
          intro={t("dev.gStake.prereqIntro")}
        >
          <Prereqs
            title={t("dev.common.prereqLabel")}
            items={[t("dev.gStake.prereq1"), t("dev.gStake.prereq2"), t("dev.gStake.prereq3")]}
          />
        </DevSection>

        <DevSection
          id="numeros"
          kicker={t("dev.gStake.numbersKicker")}
          title={t("dev.gStake.numbersTitle")}
          intro={t("dev.gStake.numbersIntro")}
        >
          <SpecList
            rows={[
              { k: "MIN_VALIDATOR_STAKE", v: <Mono>1 000 EAV7</Mono>, note: t("dev.gStake.numMin") },
              { k: "FEE_EXEMPT_STAKE", v: <Mono>100 EAV7</Mono>, note: t("dev.gStake.numExempt") },
              { k: "MAX_VALIDATORS", v: <Mono>27</Mono>, note: t("dev.gStake.numMax") },
              { k: "MAX_VOTE_TARGETS", v: <Mono>30</Mono>, note: t("dev.gStake.numTargets") },
              { k: "UNBONDING_BLOCKS", v: <Mono>604 800</Mono>, note: t("dev.gStake.numUnbonding") },
              { k: "DEFAULT_COMMISSION_PCT", v: <Mono>20 %</Mono>, note: t("dev.gStake.numCommission") },
            ]}
          />
        </DevSection>

        <DevSection
          id="passos"
          kicker={t("dev.gStake.stepsKicker")}
          title={t("dev.gStake.stepsTitle")}
          intro={t("dev.gStake.stepsIntro")}
        >
          <DevSteps
            steps={[
              {
                title: t("dev.gStake.s1Title"),
                body: t("dev.gStake.s1Body"),
                children: <CodeBlock code={STAKE} label="Rust · eav7-sdk" />,
              },
              {
                title: t("dev.gStake.s2Title"),
                body: t("dev.gStake.s2Body"),
                children: <CodeBlock code={VALIDATORS} label="bash" />,
              },
              {
                title: t("dev.gStake.s3Title"),
                body: t("dev.gStake.s3Body"),
                children: <CodeBlock code={VOTE} label="Rust" />,
              },
              {
                title: t("dev.gStake.s4Title"),
                body: t("dev.gStake.s4Body"),
                children: <CodeBlock code={CLAIM} label="Rust" />,
              },
            ]}
          />
        </DevSection>

        <DevSection
          id="saida"
          kicker={t("dev.gStake.exitKicker")}
          title={t("dev.gStake.exitTitle")}
          intro={t("dev.gStake.exitIntro")}
        >
          <CodeBlock code={UNSTAKE} label="Rust" />
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.gStake.exitCalloutTitle")}>
              {t("dev.gStake.exitCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/guides/run-node", label: t("dev.nav.runNode"), desc: t("dev.nav.runNodeDesc") },
              { href: "/developers/concepts/resources", label: t("dev.nav.resources"), desc: t("dev.nav.resourcesDesc") },
              { href: "/developers/transactions", label: t("dev.nav.transactions"), desc: t("dev.nav.transactionsDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
