# Listar a EAV7 (ícone + nome na MetaMask)

Para o **nome e o ícone da EAV7 aparecerem automaticamente** quando alguém adiciona
a rede (Chain ID **72020**) na MetaMask/Trust, a rede precisa estar no repositório
público **[ethereum-lists/chains](https://github.com/ethereum-lists/chains)**. A MetaMask
e vários apps consomem essa lista.

> É uma submissão **manual** via Pull Request no GitHub — precisa ser feita pela **sua**
> conta do GitHub (eu não posso abrir o PR por você). Os arquivos abaixo já estão prontos.

## Passo a passo

1. **Fork** de `https://github.com/ethereum-lists/chains`.

2. Copie **`eip155-72020.json`** (desta pasta) para:
   ```
   _data/chains/eip155-72020.json
   ```

3. **Ícone** (opcional, mas é o que faz aparecer a imagem):
   1. Suba o `public/icon.png` (256×256) para o IPFS. Sem instalar nada, use um pin
      público, por exemplo:
      ```bash
      # com a CLI da web3.storage, ou pelo site pinata.cloud / nft.storage
      # o objetivo é obter um CID, ex.: bafybeih...
      ```
   2. Pegue o **CID** retornado e cole em **`eav7-icon.json`** no lugar de
      `SUBSTITUA_PELO_CID_DO_ICONE` (mantenha o prefixo `ipfs://`).
   3. Copie `eav7-icon.json` para:
      ```
      _data/icons/eav7.json
      ```
      (o nome do arquivo — `eav7` — tem que bater com o campo `"icon": "eav7"` do chain JSON.)

   Se você **não** quiser ícone agora, apague a linha `"icon": "eav7",` do
   `eip155-72020.json` e pule o passo 3.

4. Commit + push no seu fork e abra um **Pull Request** para `ethereum-lists/chains`.
   A CI deles valida o schema automaticamente; depois de mergeado, o ícone/nome passam
   a aparecer nos apps que usam a lista (leva alguns dias para propagar).

## Observações

- `decimals: 18` porque as carteiras EVM (MetaMask) exibem a moeda nativa com 18 casas;
  on-chain a EAV7 usa 6 (o RPC EAVM converte 1 EAV7 = 10¹² unidades EAVM = 10⁶ e7).
- `EIP3091` é o padrão de URL de explorador (`/tx/…`, `/block/…`, `/address/…`) — o
  EAV7 Scan já segue esse padrão.
- Para **preço** aparecer na carteira/corretora, é um caminho separado (listagem em
  exchange + CoinGecko/CoinMarketCap), que exige liquidez e um processo próprio.
