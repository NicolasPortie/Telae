# Design da interface

O Telae é um utilitário de desktop para assistir à tela de um amigo. A imagem compartilhada é o objeto principal; todo o resto existe para começar, entender ou encerrar essa experiência.

## Direção visual: sala escura

Uma sala de cinema pequena, só para os amigos. O app é quase preto, com tons quentes de projetor: o âmbar é a luz que sai do projetor (ações e destaques) e o vermelho é a luz de "no ar", usado apenas para quem está transmitindo. Quem está ao vivo aparece como um **cartaz** em "Em cartaz"; quando ninguém transmite, o palco mostra uma **tela apagada**.

- **Marca:** a palavra *Telae* em Geist negrito, com espaçamento justo, ao lado de uma pequena tela com a luz do projetor (CSS em `.telae-mark`; SVG em `apps/desktop/public/icon.svg`).
- **Barra de título integrada:** o Windows mantém os controles da janela (`titleBarOverlay`) e a interface desenha o cabeçalho de 40 px. Fora da conta (tela de entrada) o cabeçalho mostra só a marca.
- **Atmosfera:** facho de luz âmbar no canto superior, filme de grão por cima de tudo (`.telae-shell::after`, 7% de opacidade) e uma tira de fotograma na tela de entrada. No player não há decoração.
- **Composição:** a tela inicial é um trilho de amigos à esquerda (agrupados por Ao vivo, Online e Offline) e o palco à direita. A tela de entrada divide-se em painel da marca e formulário. As configurações têm navegação lateral com um painel por seção.

## Tokens

Definidos em `apps/desktop/tailwind.config.cjs`. Componentes usam apenas nomes semânticos (`bg-surface`, `text-ink-3`, `border-line`), nunca cores soltas.

| Token | Valor | Uso |
| --- | --- | --- |
| `canvas` | `#0A0908` | Fundo do app e campos de entrada |
| `surface` / `raised` | `#12100E` / `#1A1713` | Cartões e controles elevados |
| `active` | `#26211A` | Estado ativo e hover |
| `ink` 1–4 | `#F4EFE6` → `#867F73` | Texto primário a terciário (mínimo 4,5:1) |
| `line` | `#26211B`, `#322C24`, `#463F35` | Divisores e bordas |
| `signal` | `#F5B544` | Luz de projetor: ações principais e destaques |
| `tally` | `#FF5144` | Luz de "no ar": só para quem transmite |
| `danger` / `ok` | `#F0615D` / `#5FC98A` | Parar e erro / online |

## Tipografia

- **Geist** para tudo: interface, títulos grandes (classe `.display`, peso 650 e espaçamento de -0,045 em) e marca.
- **Geist Mono** para códigos, versão e números de telemetria.

As fontes são empacotadas com o aplicativo (`@fontsource-variable`), sem depender de rede. A fonte dos títulos é um único token (`fontFamily.display` em `tailwind.config.cjs`): trocar ali muda o app inteiro. Numerais tabulares nas estatísticas.

## Componentes base

Classes em `apps/desktop/src/index.css`: `.btn` (`-primary`, `-secondary`, `-ghost`, `-danger`, `-sm`, `-lg`), `.card`, `.field`, `.avatar`, `.count`, `.badge-live`, `.notice`, `.eyebrow`, `.display` e `.tally` (a luz pulsante de "no ar"). Alvos de toque de pelo menos 34 px, foco visível em âmbar e redução de movimento respeitada.

## Responsividade

A janela mínima é 640 × 560. A partir de 860 px a tela inicial usa trilho e palco lado a lado, cada um rolando sozinho; abaixo disso o palco vem primeiro e o trilho passa para baixo. O painel da marca da tela de entrada some em janelas estreitas.

## Textos

O tom é de conversa entre amigos: frases curtas, voz ativa e nada de "Não foi possível…". Erros dizem o que aconteceu e o que fazer (por exemplo, "Esse @ já tem dono. Tenta outro."). O texto-fonte é pt-BR e passou por revisão com o humanizador (sem vocabulário de modelo, sem ritmo de lista de três, sem travessão). O inglês segue o mesmo tom, com contrações.

## Idiomas

O texto-fonte do código é pt-BR e é traduzido em tempo de execução por `t()` (`src/i18n`); o inglês vive em `src/i18n/en.ts`. Frases com número usam `{count}` e `tn()`. O teste `i18n.test.ts` falha se algum texto usado no código (ou mensagem de erro do servidor) não tiver tradução, ou se sobrar tradução sem uso. Para adicionar um idioma, inclua o catálogo e a opção em `LANGUAGES`.
