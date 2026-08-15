# Patch guide — `constants/extraRpcs.js`

## 1) Inside `privacyStatement = { ... }`, add:

```js
  eav7:
    "EAV7 public RPC (https://rpc.eavscan.com) does not sell personal data and does not build advertising profiles from RPC traffic. We may temporarily process IP addresses and request metadata for rate limiting, DDoS protection and abuse prevention. We do not correlate wallet addresses with IP addresses for marketing, and we do not front-run transactions using RPC metadata. Edge/CDN logs may be processed by Cloudflare. Operational logs are retained on a short cycle (typically within 7 days). Details: https://eavscan.com/privacy#rpc",
```

Place it alphabetically near similar first-party entries (e.g. after `dwellir` / before `etcnetworkinfo`, or at a tidy spot in the object — consistency matters more than perfect alpha order in this file).

## 2) Inside `extraRpcs = { ... }`, before the closing `};`, add:

```js
  72020: {
    rpcs: [
      {
        url: "https://rpc.eavscan.com",
        tracking: "limited",
        trackingDetails: privacyStatement.eav7,
      },
    ],
  },
```

## Notes

- Do **not** invent extra RPCs.
- Do **not** mark `tracking: "none"` while Cloudflare is in front.
- Keep the existing file style (2-space indent, trailing commas as already used).
