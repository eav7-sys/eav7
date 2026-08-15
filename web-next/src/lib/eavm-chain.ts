/** Parâmetros canônicos EAVM (MetaMask / Trust / wallet_addEthereumChain). */
const IS_TESTNET = process.env.NEXT_PUBLIC_NETWORK === "testnet";

export const EAVM_CHAIN_ID_DEC = IS_TESTNET ? 72021 : 72020;
export const EAVM_CHAIN_ID_HEX = IS_TESTNET ? "0x11955" : "0x11954";

export const EAVM_RPC_URL = IS_TESTNET
  ? "https://rpc-testnet.eavscan.com"
  : "https://rpc.eavscan.com";

export const EAVM_EXPLORER_URL = IS_TESTNET
  ? "https://testnet.eavscan.com"
  : "https://eavscan.com";

export const EAVM_CHAIN_PARAMS = {
  chainId: EAVM_CHAIN_ID_HEX,
  chainName: IS_TESTNET ? "EAV7 Testnet" : "EAV7",
  nativeCurrency: { name: "EAV7", symbol: "EAV7", decimals: 18 },
  rpcUrls: [EAVM_RPC_URL],
  blockExplorerUrls: [EAVM_EXPLORER_URL],
  iconUrls: [`${EAVM_EXPLORER_URL}/icon-512.png`],
} as const;

/** Bloco copy-paste para cadastro manual de rede personalizada. */
export const EAVM_MANUAL_NETWORK = `Nome da rede   ${EAVM_CHAIN_PARAMS.chainName}
RPC            ${EAVM_RPC_URL}
Chain ID       ${EAVM_CHAIN_ID_DEC}            (${EAVM_CHAIN_ID_HEX})
Símbolo        EAV7
Decimais       18               (a superfície EAVM assume 18)
Explorador     ${EAVM_EXPLORER_URL}
Ícone          ${EAVM_EXPLORER_URL}/icon-512.png`;
