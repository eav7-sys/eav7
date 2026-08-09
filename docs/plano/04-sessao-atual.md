# O que mudou nesta sessão

Duas frentes: a API nativa e um bug de consenso que apareceu sozinho no meio do
trabalho.

## O bug de consenso — âncora de estado

**Onde:** `rust/src/blockchain.rs`, `evict_oldest`.

**O que estava errado:**

```rust
let mut base = self.base_state.take().unwrap_or_default();
```

Na **primeira** vez que a janela de RAM desliza, `tail_start` é 0 e a âncora ainda
é `None`. O `unwrap_or_default()` fazia ela nascer como estado **vazio**, e o
bloco 0 era aplicado em cima do nada.

As alocações do gênese não são transações — vivem em `block.genesis` e entram por
`apply_genesis`. A âncora perdia saldo, stake e tesouro inteiros.

O caminho de **reorg** já tratava isso corretamente (`tail_start == 0` →
`apply_genesis`, sem aplicar o bloco 0). O do slide, não. Os dois discordavam
sobre o mesmo ponto da cadeia.

**Por que era perigoso:** a âncora só é lida num reorg. O erro dormia até a rede
reorganizar — e então o nó reconstruiria um estado que nunca existiu, produzindo
raiz errada **em silêncio** e saindo da cadeia.

**Como apareceu:** o nó de desenvolvimento entrou em pânico ao tentar expulsar o
bloco 1268, que continha duas `TOKEN_CREATE`. A transação precisava do stake do
gênese para pagar energia; sem ele, a taxa apurada ultrapassava o limite
autorizado (`fee: "0"`) e a reaplicação falhava. Numa cadeia cujos primeiros
5.100 blocos são vazios, o defeito fica invisível.

**A prova:** teste novo (`ancora_da_primeira_expulsao_preserva_as_alocacoes_da_genese`)
reconstrói uma cadeia real desde o gênese e verifica a invariante **âncora +
janela = mesma raiz do estado corrente**. Confirmado que ele **falha sem a
correção** — quebra em `.expect("conta da gênese na âncora")`, porque a conta
simplesmente não existe.

## A falha silenciosa em release

No mesmo trecho: `debug_assert!` **não faz nada em release**. Em produção a
expulsão devolveria `false` calada, `slide_tail` pararia de deslizar e a janela
de RAM cresceria sem limite — o modo de falha do incidente dos 2 GiB, de volta
pela porta dos fundos e sem uma linha de log.

Agora existe `ancora_corrompida()`, que grita no log dizendo o que parou, em que
altura e por quê. A decisão de **derrubar** o nó em vez de degradar continua
pendente — ver [06-decisoes-abertas.md](06-decisoes-abertas.md).

O diagnóstico também passou a identificar o bloco. Antes dizia apenas
"reaplicar bloco da cadeia falhou"; agora diz
`bloco 1268 (2 tx: TOKEN_CREATE,TOKEN_CREATE) hash 4d41dd…`.

## API nativa

| Correção | O que estava errado | Prova |
|---|---|---|
| **Unidade em `/stats`** | Montantes saíam já divididos por `UNIT`, exceção só dessa rota. O cliente dividia de novo: 7.900 EAV7 apareciam como 0,0079. Além disso `Number` sobre e7 estoura o inteiro seguro do JS aos 900 milhões de EAV7. | Tela mostra "10 mil" contra o nó real |
| **TPS** | Calculado no cliente como "último balde ÷ 3600". O último balde é o da hora corrente, sempre parcial — o TPS caía para perto de zero ao virar a hora. | Teste fixa 2 tx em 4 s = 0,5 |
| **Volume fracionário** | A série somava `amount / UNIT` por transação: mil transferências de 0,9 EAV7 entravam como zero. | Teste com três de 0,4 somando 1,2 |
| **61 requisições → 1** | A tela de tokens buscava o detalhe de cada token para ler `decimals`, que o catálogo já entregava. Catálogo e detalhe saem da MESMA função (`tokenView`). O tipo escrito à mão declarava menos campos do que a rota devolve. | Token com 8 casas renderiza certo com uma chamada |
| **Nome do validador** | Cliente baixava `/names` e invertia o mapa; `/names` corta em 200 e deixava anônimo quem ficasse fora. | Resolvido no nó, desempate alfabético estável |
| **Tamanho do bloco** | Não existia. Definido como os bytes da serialização canônica — a mesma linha que vai para o disco e para os peers. | Idêntico nas 4 rotas; conferido por contagem independente em Python |

Tudo aplicado **nos dois clientes**. A produção ainda roda o JavaScript; corrigir
só um lado quebraria a tela contra o nó implantado.

## O contrato novo de `/stats`

```json
{
  "accounts": 1,
  "accountsDelta": 0,
  "transactions": 0,
  "transactionsDelta": 0,
  "volume": "0",
  "volumeDelta": "0",
  "staked": "10000000000",
  "stakedDelta": "0",
  "tps": 0.0,
  "txSeries": [ 24 inteiros ],
  "volSeries": [ 24 strings em e7 ]
}
```

Montantes em **e7 cru, string decimal** — a mesma regra do resto da API.

## Verificação

- 982 testes Rust, 378 JS, `tsc` limpo, `next build` limpo
- Lint de volta ao baseline (um `import` órfão removido; os 3 erros restantes já
  existiam antes)
- Nó reiniciado passou do bloco 1268 sem pânico e chegou a 6.405
- Bloco 1268 volta do disco íntegro depois de sair da janela de RAM
- Stake do gênese continua de pé

**O que não foi possível provar:** a prova de estado por Merkle (`/proof`)
responde `stateRoot indisponível` porque o fork está dormente neste build. A
invariante da âncora está coberta por teste unitário, não por prova em rede.
