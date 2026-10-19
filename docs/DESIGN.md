# Design da interface

O Telae é um utilitário de desktop para assistir à tela de um amigo. A imagem compartilhada é o objeto principal; todo o resto existe para iniciar, entender ou encerrar essa experiência.

## Direção visual

Interface escura e sóbria, com superfícies neutras e um único acento âmbar, lembrando a lâmpada de um projetor. O vídeo ocupa o preto absoluto e os controles ficam em grafite, com hierarquia feita por contraste, bordas finas e espaçamento, não por ornamento.

- **Marca:** tela com ponto "ao vivo", em CSS (`.telae-mark`) no cabeçalho e em SVG no ícone do aplicativo (`apps/desktop/public/icon.svg`).
- **Barra de título integrada:** o Windows mantém os controles da janela (`titleBarOverlay`) e a interface desenha o cabeçalho de 48 px.
- **Atmosfera:** brilho âmbar discreto no topo e grade de pontos que se dissolve, só nas telas de navegação. Durante o player não há decoração.

## Tokens

Definidos em `apps/desktop/tailwind.config.cjs`. Componentes usam apenas nomes semânticos (`bg-surface`, `text-ink-3`, `border-line`), nunca cores soltas.

| Token | Valor | Uso |
| --- | --- | --- |
| `canvas` | `#0B0B0D` | Fundo do app e campos de entrada |
| `surface` / `raised` | `#131316` / `#19191D` | Cartões e controles elevados |
| `active` | `#222227` | Estado ativo e hover |
| `ink` 1–4 | `#F4F3EF` → `#82817B` | Texto primário a terciário (mínimo 4,5:1) |
| `line` | `#222226`, `#2D2D33`, `#3B3B43` | Divisores e bordas |
| `signal` | `#E0AE5E` | Acento, ações primárias e "ao vivo" |
| `danger` / `ok` | `#F0615D` / `#5FC98A` | Parar e erro / online |

## Tipografia

**Geist** para a interface e **Geist Mono** para códigos, versão e números de telemetria, ambas empacotadas com o aplicativo (`@fontsource-variable`), sem depender de rede. Numerais tabulares nas estatísticas.

## Componentes base

Classes em `apps/desktop/src/index.css`: `.btn` (`-primary`, `-secondary`, `-ghost`, `-danger`, `-sm`, `-lg`), `.card`, `.field`, `.avatar`, `.count`, `.badge-live`, `.notice` e `.eyebrow`. Alvos de toque de pelo menos 34 px, foco visível em âmbar e redução de movimento respeitada.

## Responsividade

A janela mínima é 640 × 560. A tela inicial mantém a ação principal e a lista de amigos acima da dobra a partir de 980 × 650; abaixo disso as colunas empilham. A ilustração do cartão principal aparece apenas em janelas largas.
