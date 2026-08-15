# Fase 1 — QA carteiras (MetaMask / Trust)

Checklist manual após deploy do front e (idealmente) merge dos PRs de ícone/RPC.

## MetaMask (desktop)

1. Abrir [eavscan.com/developers/networks#add-network](https://eavscan.com/developers/networks#add-network)
2. Clicar **Adicionar rede** (ou usar o botão em `/developers/guides/metamask`)
3. Confirmar prompt da extensão
4. Verificar:
   - [ ] Nome: **EAV7** (não “EAV7 EAVM”)
   - [ ] Chain ID: **72020**
   - [ ] Símbolo: **EAV7**
   - [ ] RPC: `https://rpc.eavscan.com`
   - [ ] Explorer: `https://eavscan.com`
   - [ ] Ícone aparece (após merge ethereum-lists #8591; até lá pode ficar genérico)

### Cadastro manual (fallback)

```
Nome       EAV7
RPC        https://rpc.eavscan.com
Chain ID   72020
Símbolo    EAV7
Decimais   18
Explorer   https://eavscan.com
```

## Trust Wallet

1. Settings → Networks → Add custom network  
2. Preencher os mesmos campos acima  
3. Salvar e trocar para EAV7  
4. Abrir um endereço no explorador via Trust (link EIP-3091)

## Smoke RPC

```bash
curl -s https://rpc.eavscan.com \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# → "0x11954"
```

## Socials (já no footer)

| Canal | URL |
|---|---|
| X | https://x.com/eav7 |
| Telegram | https://t.me/eav7 |
| Discord | https://discord.gg/eav7 |
| GitHub | https://github.com/eav7-sys/eav7 |

## PRs externos (só acompanhar)

| PR | Esperado |
|---|---|
| [DefiLlama #3040](https://github.com/DefiLlama/chainlist/pull/3040) | RPC privacy / redes seguras |
| [ethereum-lists #8591](https://github.com/ethereum-lists/chains/pull/8591) | Ícone IPFS + nome EAV7 |
