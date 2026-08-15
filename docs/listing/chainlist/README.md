# Chainlist — RPC seguro (DefiLlama/chainlist)

A EAV7 **já está** em [`ethereum-lists/chains`](https://github.com/ethereum-lists/chains)
(PR [#8521](https://github.com/ethereum-lists/chains/pull/8521), merge 11 ago 2026) e
aparece em [chainlist.org/chain/72020](https://chainlist.org/chain/72020).

O que falta para o RPC entrar no filtro de **redes/RPCs seguros (privacy)** da
[Chainlist](https://chainlist.org) é um PR em
[`DefiLlama/chainlist`](https://github.com/DefiLlama/chainlist) adicionando
`https://rpc.eavscan.com` em `constants/extraRpcs.js` com `tracking: "limited"`
e um `privacyStatement` apontando para uma URL pública.

## Por que `limited` (e não `none`)

O endpoint público passa por **Cloudflare**. Declarar `tracking: "none"` seria
rejeitável / desonesto. `limited` + aviso claro é o padrão que os maintainers
aceitam de primeira para RPCs próprios atrás de CDN.

## Arquivos deste pacote

| Arquivo | Uso |
|---|---|
| `PR-BODY.md` | Corpo do Pull Request (colar no GitHub) |
| `extraRpcs.patch.md` | Trechos exatos a inserir em `extraRpcs.js` |
| `eav7-icon-256.png` | Ícone oficial 256×256 (já referenciado no ethereum-lists) |
| `../eip155-72020.json` | Registro canônico da chain (já mergeado upstream) |

## Pré-requisito (obrigatório antes do PR)

Publicar o aviso de privacidade do RPC:

```
https://eavscan.com/privacy#rpc
```

Fonte no repo: `web-next/public/rpc-privacy.html` (+ rewrite em `next.config.ts`).
Depois do deploy, confira com:

```bash
curl -sI https://eavscan.com/privacy#rpc | head -5
```

## Abrir o PR

```bash
# 1) fork + clone
gh repo fork DefiLlama/chainlist --clone
cd chainlist
git checkout -b add-eav7-72020-safe-rpc

# 2) editar constants/extraRpcs.js conforme extraRpcs.patch.md

# 3) commit + PR
git add constants/extraRpcs.js
git commit -m "$(cat <<'EOF'
Add EAV7 (72020) public RPC with privacy metadata

EOF
)"
git push -u origin HEAD
gh pr create --title "Add EAV7 mainnet RPC (chainId 72020) with privacy statement" --body-file /path/to/docs/listing/chainlist/PR-BODY.md
```

## Verificação rápida (colar no PR)

```bash
curl -s -X POST https://rpc.eavscan.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# → {"result":"0x11954"}  (== 72020)
```
