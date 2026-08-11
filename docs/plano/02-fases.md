# O caminho, em seis fases

A ordem importa: cada fase depende da anterior. Estamos na **quarta**.

## 1. Protocolo — biblioteca Rust

10.649 linhas. O papel dela é o do `execution-specs` do Ethereum: legível e
auditável, define o protocolo. Continua sendo a fonte dos 9 vetores de
conformidade em `vectors/`.

## 2. Biblioteca de consenso em Rust — pronta

36.885 linhas em 29 arquivos. Regras, criptografia híbrida pós-quântica
(`eav7-hybrid-1` = ECDSA secp256k1 + ML-DSA-44, os dois têm de verificar),
estado, raiz de estado, armazenamento e EAVM.

Compila também para `wasm32`, recortando a camada de armazenamento por alvo. É o
que tira as três cópias de criptografia do navegador — que tinham cada uma o seu
próprio keccak, secp256k1, RLP e derivação de endereço.

## 3. Nó, SDK e WASM — prontos

| Crate | Linhas | Arquivos |
|---|---:|---:|
| `eav7-node` | 17.215 | 27 |
| `eav7-sdk` | 1.709 | 6 |
| `eav7-wasm` | 308 | 1 |

O nó traz API HTTP, P2P, RPC EAVM (dialeto Ethereum para MetaMask e Trust
Wallet), produtor de blocos, camada de IA e guarda anti-abuso.

**As 34 rotas da API existem nos dois clientes.** Nenhuma ficou só no Rust.

## 4. Explorador e API nativa — em andamento

É aqui que estamos.

O desenho novo está portado nas telas principais. A API foi corrigida para não
obrigar o cliente a adivinhar unidade nem a compensar campo ausente — ver
[04-sessao-atual.md](04-sessao-atual.md).

## 5. Rollout coordenado dos forks — bloqueada

Há 20 forks definidos por altura, o que permite mudar regra sem invalidar
histórico. Dois estão **dormentes na altura 100.000.000**:

| Fork | Altura | O que ativa |
|---|---:|---|
| `BRIDGE_BREAKER_HEIGHT` | 100.000.000 | Disjuntor da ponte |
| `AI_TEE_HEIGHT` | 100.000.000 | Atestação TEE dos oráculos de IA |

Ativar exige todos os validadores atualizados ao mesmo tempo, e depende de
produção estar de pé.

## 6. Runtime único (Rust) — feito

Só depois que o Rust estiver validando em produção e os vetores de conformidade
fecharem. Nunca antes.

Enquanto os dois existirem, **toda correção é dupla** — nesta sessão foram quatro
lugares corrigidos duas vezes.

A limpeza da cadeia é assunto separado e depende de confirmação explícita de que
o desenvolvimento acabou.
