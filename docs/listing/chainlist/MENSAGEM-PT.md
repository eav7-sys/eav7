# Mensagem / capa (PT) — solicitação Chainlist

Use no corpo do PR (além do `PR-BODY.md` em inglês) ou em follow-up interno.

---

Prezados maintainers,

Solicitamos a inclusão do RPC oficial da **EAV7 Mainnet (Chain ID 72020)** na Chainlist, com metadados de privacidade, para que a rede apareça corretamente no filtro de RPCs seguros / privacy-friendly.

**Resumo técnico**

- Rede: EAV7 (Layer-1 · protocolo eav20 · EAVM)
- Chain ID: 72020 (`0x11954`)
- RPC: https://rpc.eavscan.com
- Explorer: https://eavscan.com
- Documentação: https://eavscan.com/docs/sobre
- Ícone: já registrado em ethereum-lists/chains (`eav7`)
- Privacidade do RPC: https://eavscan.com/privacy#rpc
- Classificação: `tracking: "limited"` (endpoint atrás de Cloudflare; sem profiling publicitário; sem correlação carteira↔IP para marketing)

A chain já foi mergeada em ethereum-lists/chains (PR #8521) e já figura em https://chainlist.org/chain/72020. Este PR apenas anexa o RPC oficial com o statement de privacidade exigido pela UX de redes seguras da Chainlist.

Agradecemos a revisão.

Equipe EAV7  
https://eavscan.com · https://github.com/eav7-sys/eav7
