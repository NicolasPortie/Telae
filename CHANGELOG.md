# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). As notas detalhadas de cada versão publicada ficam em `docs/RELEASE_*.md`.

## [0.1.24] - 2026-10-12

### Qualidade de transmissão
- **Áudio Opus em estéreo com até 192 kbps**, FEC ligado e DTX desligado, aplicado na oferta e na resposta SDP e como teto no sender de áudio. Antes não havia ajuste de SDP, e o Chromium tende a negociar Opus mono de baixo bitrate.
- **Buffer de jitter adaptativo no espectador.** Em rota direta e estável continua em 0 ms; sobe imediatamente para 30–80 ms em relay, jitter, perda ou RTT altos e só desce após 10 amostras estáveis.
- **Degradação de resolução em passos menores** (1 → 1,33 → 2 → 3, por exemplo 1440p → 1080p → 720p → 480p) no lugar de dobrar a cada etapa. O modo Texto continua reduzindo FPS antes de qualquer coisa.
- **Telemetria ampliada:** tempo de decodificação, atraso do jitter buffer, travadas (quantidade e duração), quadros descartados, PLI, NACK e bitrate de áudio. Latência estimada = RTT/2 + buffer + decode.

### Interface
- Painel **Estatísticas** no player (botão ou tecla `I`) e na tela do emissor, com selo de saúde da conexão.
- Aviso no emissor quando a qualidade é reduzida automaticamente por CPU ou rede.
- Seletor de qualidade com resolução e FPS visíveis e explicação do perfil escolhido.
- **Tela inicial em duas colunas:** ação de compartilhar à esquerda e painel de amigos fixo e rolável à direita, com o seu código no topo. Tudo cabe sem rolar a página, inclusive em 980 × 650, e quem está ao vivo fica sempre à vista. Removido o cartão informativo repetido e o selo "Aguardando transmissão".
- **Tokens de design** (`canvas`, `surface`, `ink`, `line`, `signal`…) no Tailwind, substituindo mais de 230 cores hexadecimais soltas nos componentes. Sem mudança visual.

### Testes
- Testes unitários para SDP, jitter, telemetria, nova escada de resolução e formatação (146 no total).

## 0.1.23 e anteriores

Consulte `docs/RELEASE_0.1.12.md` a `docs/RELEASE_0.1.17.md`, `docs/DEPLOYMENT_0.1.16.md` e as tags do repositório.
