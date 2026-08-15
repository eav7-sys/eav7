# Apresentação EAV7

Deck de 16 slides (16:9) em português para investidores, parceiros e comunidade.

| Arquivo | Papel |
|---|---|
| `deck.html` | Fonte do deck — um slide por `<section class="slide">` |
| `make-ambient.py` | Gera `assets/ambient.png` (luz de fundo dos slides) |
| `build.sh` | Renderiza `deck.html` em PDF via Chrome headless |
| `EAV7-apresentacao.pdf` | Saída final — 16 páginas, 13,333in × 7,5in (1280 × 720 px) |
| `fonts/` | Space Grotesk e JetBrains Mono **estáticas** (OFL) — variáveis viram Type 3 borrado no PDF do Chrome |

## Regenerar

```bash
cd docs/pitch
./build.sh
```

Só isso. O script procura, nesta ordem: Google Chrome, Chromium, Microsoft Edge e
o Chromium do Playwright (`~/Library/Caches/ms-playwright`). Se nenhum existir:

```bash
npx playwright install chromium
```

Para alterar a luz de fundo, edite as constantes no topo de `make-ambient.py`
(`GLOWS`, `GRID_STEP`, `GRID_ALPHA`, `SCALE`) e regenere antes do build.
`SCALE=2` produz 2560×1440 (~192 ppi no PDF) — não baixe para 1 sem precisar:

```bash
python3 make-ambient.py && ./build.sh
```

## Conferir o resultado

```bash
pdftoppm -png -r 72 EAV7-apresentacao.pdf /tmp/eav7-slide   # 1 PNG por slide
```

## Editar conteúdo

Cada slide é uma `<section class="slide">` com um padrão de corpo reutilizável:
`cols` (colunas), `kv` (chave/valor em mono), `stack` (lista com régua), `steps`
(lista numerada), `metrics` (números grandes) e `note` (ressalva).

Duas restrições ao editar:

- **Altura fixa.** Cada slide tem 720 px de altura útil menos os paddings; texto
  em excesso vaza para cima do rodapé em vez de criar uma página nova. Sempre
  rasterize e confira depois de mexer no conteúdo.
- **Nada de gradiente CSS/SVG no fundo.** O exportador de PDF do Chrome
  reposiciona, reescala e recorta gradientes de elementos que sangram fora da
  página. Por isso a atmosfera vem de `assets/ambient.png`, rasterizado por
  `make-ambient.py`. Gradientes dentro dos limites do slide (a barra de
  tokenomics, por exemplo) exportam corretamente.

## Fatos

Todo número e afirmação do deck vem de `docs/whitepaper.md` (v1.0) e do
`README.md` da raiz — incluindo o que ainda não está pronto: conjunto ativo de
7 âncoras, ausência de auditoria externa, atestação de IA pendente e ponte
fechada para valor econômico. Ao atualizar a rede, atualize o deck junto.
