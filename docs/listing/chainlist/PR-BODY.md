## Summary

Add the official EAV7 mainnet public RPC to Chainlist with privacy metadata so wallets can connect via the **privacy-friendly / safe RPC** filter.

| Field | Value |
|---|---|
| **Network** | EAV7 |
| **Chain ID** | `72020` (`0x11954`) |
| **RPC** | `https://rpc.eavscan.com` |
| **Explorer** | https://eavscan.com (EIP-3091) |
| **Docs** | https://eavscan.com/docs/sobre |
| **Info** | https://eavscan.com |
| **Native currency** | EAV7 · 18 decimals (wallet display; protocol uses 6 with EAVM conversion) |
| **Icon** | Already registered on `ethereum-lists/chains` as `eav7` |
| **Tracking** | `limited` (Cloudflare edge + short-lived ops logs for rate-limit / DDoS) |
| **Privacy notice** | https://eavscan.com/privacy#rpc |

The chain itself is already listed upstream in [`ethereum-lists/chains`](https://github.com/ethereum-lists/chains) (PR [#8521](https://github.com/ethereum-lists/chains/pull/8521), merged) and visible at https://chainlist.org/chain/72020. This PR only adds the privacy-annotated RPC entry expected by Chainlist’s safe-RPC UX.

## Live verification

```text
eth_chainId        → 0x11954          (72020)
net_version        → "72020"
eth_syncing        → false
web3_clientVersion → EAV7/eavm/v1
Explorer           → https://eavscan.com  (EIP-3091 /tx /block /address)
```

Commands:

```bash
curl -s -X POST https://rpc.eavscan.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

curl -sI https://eavscan.com/privacy#rpc | head -3
curl -sI https://eavscan.com | head -3
```

## Privacy classification

We intentionally use **`tracking: "limited"`** (not `none`) because the public endpoint is fronted by Cloudflare. The operator notice states clearly that:

- no advertising profiles / no sale of personal data
- no wallet↔IP correlation for marketing
- no RPC-metadata front-running
- IP / request metadata only for rate-limit, DDoS and abuse prevention
- short retention (typically ≤ 7 days)

Full text: https://eavscan.com/privacy#rpc

## Checklist

- [x] Chain ID unique and already registered in ethereum-lists (`eip155-72020`)
- [x] Public RPC responds to `eth_chainId` / `eth_blockNumber` / `eth_gasPrice`
- [x] Explorer live and EIP-3091 compatible
- [x] Privacy statement URL is public and specific to the RPC
- [x] `tracking` level matches actual infrastructure (honest `limited`)
- [x] Icon already available via ethereum-lists (`icon: "eav7"`)

Thank you for reviewing.
