# Interface do Telaê

O conteúdo compartilhado ocupa o centro da experiência. A interface precisa facilitar a escolha da fonte, mostrar quem está assistindo e permitir encerrar a transmissão sem procurar controles.

## Aparência atual

O fundo é quase preto, com tons de verde. O verde-lima marca ações principais, seleção e foco; vermelho indica transmissão ao vivo; âmbar fica reservado a avisos de conexão ou qualidade.

A marca combina duas molduras de tela e um ponteiro. O desenho está em `apps/desktop/public/icon.svg` e no componente `BrandMark`. Não depende de imagens remotas.

Na tela inicial, a lista de amigos fica à esquerda. O espaço principal mostra as prévias de quem está ao vivo e o botão para escolher uma tela. A entrada usa um painel da marca e um formulário com abas. As configurações são divididas em seções com navegação lateral.

## Cores

Os valores vêm de `apps/desktop/tailwind.config.cjs`. Os componentes usam os nomes definidos ali.

| Nome | Valor | Uso |
| --- | --- | --- |
| `canvas` | `#070A08` | Fundo do aplicativo. |
| `chrome` | `#090D0B` | Barra superior. |
| `surface` / `raised` | `#0D1210` / `#131A16` | Superfícies e controles. |
| `active` | `#1B241F` | Estado ativo. |
| `ink` | `#EEF1EA` | Texto principal. |
| `ink.2` / `ink.3` / `ink.4` | `#B5BEB6` / `#8E9991` / `#7A857D` | Hierarquia de textos secundários. |
| `signal` | `#C4F04D` | Ação principal, seleção e foco. |
| `tally` | `#FF5144` | Indicador de transmissão ao vivo. |
| `warn` | `#F2B544` | Avisos. |
| `ok` | `#4FD483` | Conexão disponível. |

## Tipografia e controles

Geist é usada na interface, nos títulos e na marca. Geist Mono aparece na versão e nos números das estatísticas. As fontes são empacotadas com o app.

Os controles base ficam em `apps/desktop/src/index.css`: botões, campos, opções de fonte, qualidade, avisos e painéis. O foco precisa ser visível, os textos secundários precisam manter contraste e a preferência de redução de movimento deve ser respeitada. Animações de hover não devem deslocar a área de clique.

## Tamanhos de janela

A janela mínima é 640 × 560. Em janelas largas, lista de amigos e conteúdo principal ficam lado a lado. Em janelas estreitas, o conteúdo vem primeiro e a lista passa para baixo. O painel ilustrado da entrada fica oculto quando não há espaço para as duas colunas.

## Textos e idiomas

Escreva frases curtas em português do Brasil. Diga o que aconteceu e, quando necessário, o que a pessoa pode fazer. Evite apresentar limitações normais como falhas permanentes ou usar termos de implementação onde não ajudam a decisão.

O texto-fonte passa por `t()` em `src/i18n`. A tradução inglesa fica em `src/i18n/en.ts`. Frases com contagem usam `{count}` e `tn()`. Os testes verificam traduções ausentes e traduções sem uso.

Português do Brasil é o padrão de novas instalações. Inglês e o modo automático continuam como escolhas explícitas nas configurações.
