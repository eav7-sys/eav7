// Estrutura do portal. Fica em módulo próprio (sem "use client") para que tanto
// a navegação lateral (cliente) quanto as páginas (servidor) leiam a MESMA lista —
// é ela que define o paginador anterior/próximo no rodapé de cada página.

export interface DevRoute {
  href: string;
  /** rótulo curto, usado na navegação */
  key: string;
  /** descrição de uma linha, usada no índice do hub e no paginador */
  descKey: string;
}

export interface DevNavGroup {
  key: string;
  routes: DevRoute[];
}

export const DEV_NAV: DevNavGroup[] = [
  {
    key: "dev.nav.groupStart",
    routes: [
      { href: "/developers", key: "dev.nav.overview", descKey: "dev.nav.overviewDesc" },
      { href: "/developers/quickstart", key: "dev.nav.quickstart", descKey: "dev.nav.quickstartDesc" },
      { href: "/developers/networks", key: "dev.nav.networks", descKey: "dev.nav.networksDesc" },
    ],
  },
  {
    key: "dev.nav.groupConcepts",
    routes: [
      { href: "/developers/concepts/accounts", key: "dev.nav.accounts", descKey: "dev.nav.accountsDesc" },
      { href: "/developers/concepts/resources", key: "dev.nav.resources", descKey: "dev.nav.resourcesDesc" },
      { href: "/developers/concepts/transactions", key: "dev.nav.lifecycle", descKey: "dev.nav.lifecycleDesc" },
      { href: "/developers/concepts/finality", key: "dev.nav.finality", descKey: "dev.nav.finalityDesc" },
    ],
  },
  {
    key: "dev.nav.groupGuides",
    routes: [
      { href: "/developers/guides", key: "dev.nav.guides", descKey: "dev.nav.guidesDesc" },
      {
        href: "/developers/guides/sign-broadcast",
        key: "dev.nav.signBroadcast",
        descKey: "dev.nav.signBroadcastDesc",
      },
      { href: "/developers/guides/transfer", key: "dev.nav.transfer", descKey: "dev.nav.transferDesc" },
      { href: "/developers/guides/stake-vote", key: "dev.nav.stakeVote", descKey: "dev.nav.stakeVoteDesc" },
      { href: "/developers/guides/token-eav20", key: "dev.nav.tokenGuide", descKey: "dev.nav.tokenGuideDesc" },
      { href: "/developers/guides/light-client", key: "dev.nav.lightClient", descKey: "dev.nav.lightClientDesc" },
      { href: "/developers/guides/metamask", key: "dev.nav.metamask", descKey: "dev.nav.metamaskDesc" },
      { href: "/developers/guides/run-node", key: "dev.nav.runNode", descKey: "dev.nav.runNodeDesc" },
    ],
  },
  {
    key: "dev.nav.groupReference",
    routes: [
      { href: "/developers/api", key: "dev.nav.api", descKey: "dev.nav.apiDesc" },
      { href: "/developers/api/json-rpc", key: "dev.nav.jsonRpc", descKey: "dev.nav.jsonRpcDesc" },
      { href: "/developers/transactions", key: "dev.nav.transactions", descKey: "dev.nav.transactionsDesc" },
      { href: "/developers/eavm", key: "dev.nav.eavm", descKey: "dev.nav.eavmDesc" },
      { href: "/developers/errors", key: "dev.nav.errors", descKey: "dev.nav.errorsDesc" },
      { href: "/developers/sdk", key: "dev.nav.sdk", descKey: "dev.nav.sdkDesc" },
      { href: "/developers/core", key: "dev.nav.core", descKey: "dev.nav.coreDesc" },
    ],
  },
  {
    key: "dev.nav.groupOperate",
    routes: [
      { href: "/developers/integrations", key: "dev.nav.integrations", descKey: "dev.nav.integrationsDesc" },
      {
        href: "/developers/troubleshooting",
        key: "dev.nav.troubleshooting",
        descKey: "dev.nav.troubleshootingDesc",
      },
    ],
  },
];

export const DEV_ROUTES: DevRoute[] = DEV_NAV.flatMap((group) => group.routes);

/** Rotas de um grupo, pelo `key` do grupo — o índice do hub lê por seção. */
export function devGroup(key: string): DevRoute[] {
  return DEV_NAV.find((group) => group.key === key)?.routes ?? [];
}

/** Vizinhos de uma rota na ordem de leitura do portal. */
export function devPager(href: string): { prev: DevRoute | null; next: DevRoute | null } {
  const i = DEV_ROUTES.findIndex((route) => route.href === href);
  if (i < 0) return { prev: null, next: null };
  return {
    prev: i > 0 ? DEV_ROUTES[i - 1] : null,
    next: i < DEV_ROUTES.length - 1 ? DEV_ROUTES[i + 1] : null,
  };
}
