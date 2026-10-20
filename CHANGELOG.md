# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). As notas detalhadas de cada versão publicada ficam em `docs/releases/`.

## [Não lançado]

### Contas
- **Contas de usuário** com e-mail, nome de usuário único e senha, em PostgreSQL. Verificação de e-mail e recuperação de senha por código de 6 dígitos (SMTP configurável), sessões com rotação e detecção de reutilização, bloqueio por tentativas, limites por IP e exclusão de conta. Detalhes na [ADR 0004](docs/adr/0004-user-accounts.md).
- O app ganhou as telas de entrar, criar conta, confirmar e-mail e recuperar senha. Conta, senha e exclusão ficam em Configurações, e os tokens ficam no cofre do sistema.
- O servidor continua aceitando clientes anteriores enquanto `Auth:AllowLegacyDevices` estiver ligado. Para publicar esta versão do servidor é preciso definir `Auth__JwtKey` e, em produção, a conexão com o PostgreSQL (veja `.env.example`).

## [0.1.26] - 2026-10-19

Novo visual, interface em português e inglês, configurações e avisos de amigos ao vivo. Notas completas em [docs/releases/RELEASE_0.1.26.md](docs/releases/RELEASE_0.1.26.md).

### Interface
- **Nova identidade visual:** paleta neutra com acento âmbar, tipografia Geist (e Geist Mono para códigos e telemetria) empacotada com o app, e novo ícone do aplicativo.
- **Barra de título integrada** com marca, versão e perfil; os controles da janela do Windows são preservados.
- **Tela inicial refeita:** cartão de compartilhamento com ilustração e recursos, painel de amigos com avatares, filtro e remoção ao passar o mouse, e código pessoal em destaque.
- Seletor de fontes, seletor de qualidade, tela de quem transmite, player e painel de estatísticas atualizados para o mesmo sistema de design (botões, cartões, campos e selos reutilizáveis em `index.css`).
- A navegação foi dividida em componentes (`HomeScreen`, `FriendsPanel`, `PickerScreen`, `AppHeader`, `NameForm`) e o estado de amigos foi isolado no hook `useFriends`, sem mudança de comportamento.

- **Configurações:** perfil, avisos, início com o Windows, endereço do servidor de sinalização e informações da instalação.
- **Aviso do Windows** quando um amigo começa a transmitir e o Telae não está em foco.
- Indicador de conexão no cabeçalho, esqueleto de carregamento na lista de amigos e passos de "Como funciona" na tela inicial.
- Texto terciário com contraste mínimo de 4,5:1 e botão de configurações no lugar do botão de perfil.
- O player do espectador virou o componente `ViewerSession`; `App.tsx` caiu de mais de 1000 para cerca de 450 linhas.

- **Interface em português e inglês**, seguindo o idioma do Windows ou escolhida em Configurações. Os textos usam `t()` com o pt-BR como texto-fonte; um teste garante que todo texto tem tradução (inclusive as mensagens do servidor).
- A credencial do dispositivo passa a ser guardada cifrada com o cofre do sistema (DPAPI); perfis antigos são migrados sem trocar a identidade.

### Projeto
- README em inglês (`README.md`) e português (`README.pt-BR.md`), com novas capturas de tela.
- `TelaeRegistry` dividido em arquivos parciais por responsabilidade (dispositivos, sessões, amigos, convites, conexões e persistência).
- Licença MIT, `CONTRIBUTING.md`, `SECURITY.md`, `.editorconfig`, Dependabot e modelos de issue e PR.
- Dockerfile e `docker-compose.yml` para hospedar o servidor.
- ADR 0003 documenta a identidade por dispositivo (sem contas).
- Servidor e testes compilam com avisos tratados como erro; atualizado o cliente SignalR dos testes por vulnerabilidade conhecida.
- Testes de componentes (Testing Library) para o painel de amigos e as configurações.
- Dependências atualizadas dentro das faixas atuais (React 19.3.1, Electron 44.9, Playwright, Vitest, oxlint, lucide).
- Notas de versão e validações movidas para `docs/releases` e `docs/validation`.
- Removidos resíduos do template (logos do Vite e do React, README e favicon padrão) e documentos de planejamento interno.
- Documentação reorganizada: README com visão geral e capturas de tela, `docs/OPERATIONS.md` (release, deploy e atualizações) e `docs/DESIGN.md`.

## [0.1.25] - 2026-10-14

### Correções de transmissão
- A captura recebe quadros nativos diretamente e preserva seus timestamps, sem depender da apresentação de um vídeo oculto. Minimizar o emissor não deve reduzir a transmissão a 1 fps.
- O redimensionamento preserva a textura nativa, a proporção e os limites reais de 1080p/1440p, sem ampliar fontes menores. Quadros excedentes são descartados antes de processar ou codificar.
- A fila de áudio recupera o tempo real após pausas na entrega de PCM: um atraso persistente acima de 40 ms por 250 ms é reduzido para os 20 ms mais recentes, mantendo o limite absoluto de memória de 120 ms.
- Regressões de recuperação de áudio, cadência, timestamps, cancelamento e liberação de quadros. Benchmark de resolução seleciona o monitor da fonte e guarda imagens decodificadas para inspeção de nitidez.

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

Consulte `docs/releases/` e as tags do repositório.
