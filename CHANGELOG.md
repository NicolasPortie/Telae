# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). As notas detalhadas de cada versão publicada ficam em `docs/releases/`.

## [Não lançado]

## [0.2.1] - 2026-10-24

O instalador público passa a ser genérico, sem servidor embutido; o oficial é distribuído pelo mantenedor. Notas em [docs/releases/RELEASE_0.2.1.md](docs/releases/RELEASE_0.2.1.md).

## [0.2.0] - 2026-10-23

Contas de usuário, amigos pelo @usuário e um novo visual. Notas completas em [docs/releases/RELEASE_0.2.0.md](docs/releases/RELEASE_0.2.0.md). **Exige atualizar o servidor e o desktop juntos:** o servidor passa a recusar clientes sem conta.

### Servidor padrão
- **O servidor padrão sai do código e do instalador público.** O endereço entra na compilação (`TELAE_DEFAULT_SERVER_URL`); o instalador oficial é gerado num repositório privado e o público não vem com servidor nenhum. A tela de entrada ganhou **Servidor > Alterar** para apontar o app para o seu próprio servidor antes de criar a conta.

### Segurança
- **Cadastro fechado por padrão.** O servidor só cria conta para e-mails liberados em `Auth__AllowedEmails` (ou `TELAE_ALLOWED_EMAILS` no Docker Compose); `Auth__RegistrationOpen=true` reabre para qualquer pessoa. Quem não está na lista recebe o erro `registration_closed`, traduzido na interface.
- **Clientes sem conta desligados por padrão** (`Auth__AllowLegacyDevices=false`): sem entrar numa conta, não há acesso ao servidor. Antes de publicar este servidor, distribua o desktop com contas, ou ligue a opção temporariamente.
- Arquivos de operação (`ops/`) sem usuário nem caminhos pessoais, e o unit de exemplo escuta só em `127.0.0.1`. Removida a nota de implantação da 0.1.16.

### Operação
- **Repositório público só com CI em runners da GitHub.** O deploy, os runners `self-hosted`, os scripts do servidor e a validação física de mídia foram para um repositório de operação privado, que consulta a Release pública. Um PR de fora não alcança mais nenhuma máquina de operação.
- Novo `release.yml`: ao enviar uma tag `v*`, valida, gera o instalador e cria a Release. Removidos `deploy-server.yml` e os scripts de `ops/` com o layout do servidor (ficam `ops/telae-server.service` e `ops/turnserver.conf.example`).

### Marca
- O nome do produto passa a ser escrito **Telaê**, com acento, na interface, nos e-mails e na documentação. Identificadores técnicos (pacotes, namespaces, domínio, nome do instalador) continuam `Telae`.

### Projeto
- READMEs em inglês e português reescritos: demonstração em GIF, sumário, diagrama de sequência, tecnologias, hospedagem própria com tabela de variáveis, testes, segurança e limitações conhecidas.
- Novas capturas de tela (início, transmissão, player, entrar e criar conta) nos dois idiomas.
- `CODE_OF_CONDUCT.md`, modelo de sugestão de recurso, configuração de issues e `CODEOWNERS`.
- Especificação, diagrama de arquitetura, glossário e ADRs atualizados para contas, amigos e vários espectadores; metadados do `package.json`.

### Interface
- **Redesenho completo ("sala escura"):** paleta de projetor (âmbar para ações, vermelho para "no ar"), Geist em peso forte nos títulos e na marca, grão de filme e facho de luz.
- **Tela inicial nova:** trilho de amigos agrupado por Ao vivo, Online e Offline, e um palco com os cartazes de quem está transmitindo ("Em cartaz") ou a "tela apagada" quando ninguém está.
- **Entrada em duas colunas**, com painel da marca; configurações com navegação lateral por seção (Conta, Geral, Segurança, Servidor, Sobre).
- **Textos reescritos em tom de conversa** (pt-BR e inglês). Erros agora dizem o que aconteceu e o que fazer.
- A luz vermelha de "no ar" passa a marcar quem transmite; saudação por horário na tela inicial.

### Amigos
- **Amigos pelo @usuário, sem código.** A lista de amigos, os pedidos e as dispensas agora ficam no banco e acompanham a conta em qualquer computador. O app mostra o seu @, adiciona por @ e não menciona mais códigos.
- Entrar e criar conta redesenhados: abas, campos com ícone, medidor de força da senha, código de verificação em seis casas (aceita colar) e uma amostra do produto ao lado.

### Contas
- **Contas de usuário** com e-mail, nome de usuário único e senha, em PostgreSQL. Verificação de e-mail e recuperação de senha por código de 6 dígitos (SMTP configurável), sessões com rotação e detecção de reutilização, bloqueio por tentativas, limites por IP e exclusão de conta. Detalhes na [ADR 0004](docs/adr/0004-user-accounts.md).
- O app ganhou as telas de entrar, criar conta, confirmar e-mail e recuperar senha. Conta, senha e exclusão ficam em Configurações, e os tokens ficam no cofre do sistema.
- Os limites por IP do cadastro e das demais chamadas de conta são configuráveis (`Auth:StrictRequestsPerMinute` e `Auth:RequestsPerMinute`).
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
- **Aviso do Windows** quando um amigo começa a transmitir e o Telaê não está em foco.
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
- Removidos arquivos de exemplo do projeto inicial (logos do Vite e do React, README e favicon padrão).
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
