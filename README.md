<div align="center">

**Português** · [English](README.en.md)

<img src="apps/desktop/public/icon.svg" alt="Telaê" width="88" height="88" />

# Telaê

**Compartilhe sua tela com os amigos, com alta qualidade e baixa latência.**

Aplicativo de desktop para Windows com vídeo de até 1440p60, áudio do sistema ou de um aplicativo específico e transporte WebRTC ponto a ponto. Sem salas e sem links: quem está transmitindo aparece na sua lista de amigos e você entra com um clique.

[![CI](https://github.com/NicolasPortie/Telae/actions/workflows/validate.yml/badge.svg)](https://github.com/NicolasPortie/Telae/actions/workflows/validate.yml)
[![Release](https://img.shields.io/github/v/release/NicolasPortie/Telae?label=release&color=8CC63F)](https://github.com/NicolasPortie/Telae/releases)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-green)
![Plataforma](https://img.shields.io/badge/plataforma-Windows%2010%2F11-0078D4?logo=windows&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![.NET](https://img.shields.io/badge/.NET-10-512BD4?logo=dotnet&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-8CC63F)

[Em uso](#em-uso) · [Recursos](#recursos) · [Como funciona](#como-funciona) · [Primeiros passos](#primeiros-passos) · [Hospedagem própria](#hospedagem-própria) · [Documentação](#documentação)

</div>

## Em uso

<p align="center">
  <img src="docs/media/demo.pt-BR.gif" alt="A página da Casa Nativa é compartilhada e assistida pelo Telaê" width="720" />
</p>

<p align="center"><sub>A loja Casa Nativa aparece no Início dos amigos autorizados e abre no player ao entrar na transmissão.</sub></p>

## Sumário

- [Visão geral](#visão-geral)
- [Recursos](#recursos)
- [Capturas de tela](#capturas-de-tela)
- [Como funciona](#como-funciona)
- [Tecnologias](#tecnologias)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Primeiros passos](#primeiros-passos)
- [Hospedagem própria](#hospedagem-própria)
- [Segurança](#segurança)
- [Limitações conhecidas](#limitações-conhecidas)
- [Documentação](#documentação)
- [Contribuindo](#contribuindo) · [Licença](#licença) · [Autor](#autor)

## Visão geral

O Telaê permite compartilhar uma tela ou janela com amigos, com áudio sincronizado. Quem transmite aparece como **Ao vivo** na lista de amigos; para assistir, basta clicar. Não há salas, chamadas ou canais.

O aplicativo reúne captura de áudio do Windows, transporte WebRTC, contas, amigos e atualizações automáticas. A imagem passa diretamente entre os computadores; o servidor mantém as contas, a lista de amigos e a conexão entre eles.

## Recursos

- **Até 1440p60**, com perfis explícitos (720p60, 1080p30, 1080p60, 1440p30, 1440p60) e adaptação automática sob pressão de CPU ou de rede.
- **Áudio sincronizado** do sistema inteiro ou só do aplicativo escolhido, capturado por uma ponte nativa com process loopback do Windows. O áudio do Discord é excluído automaticamente ao compartilhar a tela inteira.
- **Amigos e presença**: adicione pessoas pelo @usuário, amizade mútua, pedidos de amizade e troca rápida entre transmissões ao vivo. A lista fica no servidor e acompanha sua conta em qualquer computador.
- **Prévia ao vivo**: uma miniatura da transmissão se atualiza no Início dos amigos que podem assistir. Quem transmite pode escolher todos os amigos ou só algumas pessoas; quem ficou de fora não vê o cartão ao vivo nem a prévia. A imagem fica apenas em memória durante a transmissão.
- **Quem pode ver**: ao transmitir, escolha entre todos os amigos ou só alguns (e mude isso no meio da transmissão) e oculte suas transmissões de quem quiser, sem desfazer a amizade. A transmissão aparece somente para o público escolhido.
- **Vários espectadores** por transmissão, cada um com conexão, qualidade e recuperação independentes.
- **Estatísticas em tempo real** no player e na tela de quem transmite: resolução, FPS, bitrate, latência estimada, jitter, perda de pacotes, travamentos e rota (direta ou via relay).
- **Ponto a ponto primeiro**: a mídia vai direto entre os pares e só usa TURN quando a rede exige.
- **Contas**: e-mail e senha com verificação por código de 6 dígitos, recuperação de senha, sessões com rotação e exclusão de conta ([ADR 0004](docs/adr/0004-user-accounts.md)). Os tokens ficam no cofre do sistema.
- **Avisos do Windows** quando um amigo entra ao vivo, início opcional com o Windows e atualização automática no instalador oficial, verificada pela chave de assinatura do projeto.
- **Interface em português e inglês**, com português do Brasil por padrão e seleção de idioma em Configurações.

## Capturas de tela

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/pt-BR/home.png" alt="Tela inicial com a prévia ao vivo dos amigos que estão transmitindo e a lista de amigos" /></td>
    <td width="50%"><img src="docs/screenshots/pt-BR/viewer.png" alt="Player do espectador com controles e painel de estatísticas" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Início: quem está ao vivo aparece com a tela passando</sub></td>
    <td align="center"><sub>Espectador: player com controles e estatísticas (tecla <code>I</code>)</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/pt-BR/sharer.png" alt="Tela de transmissão com a página da Casa Nativa selecionada" /></td>
    <td width="50%"><img src="docs/screenshots/pt-BR/create-account.png" alt="Tela de criar conta com e-mail, nome de usuário e senha" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Transmissão: a janela escolhida aparece na prévia</sub></td>
    <td align="center"><sub>Criar conta: o @usuário é como os amigos te encontram</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/pt-BR/audience-choice.png" alt="Tela de escolher janela com o painel Quem pode ver aberto, no modo Amigos escolhidos" /></td>
    <td width="50%"><img src="docs/screenshots/pt-BR/audience-live.png" alt="Transmissão ao vivo com o editor Quem pode ver aberto, trocando o público em tempo real" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Quem pode ver: todos os amigos ou só quem você marcar</sub></td>
    <td align="center"><sub>Dá para mudar o público com a transmissão já no ar</sub></td>
  </tr>
</table>

## Como funciona

```mermaid
sequenceDiagram
    autonumber
    participant S as Quem transmite (Electron)
    participant H as Servidor (ASP.NET Core + SignalR)
    participant V as Espectador (Electron)
    S->>H: Entra na conta (JWT) e começa a transmitir
    H-->>V: Presença: o amigo está ao vivo
    V->>H: Entra na transmissão do amigo (exige amizade mútua)
    H-->>S: Um espectador está entrando
    S->>H: SDP offer + candidatos ICE
    H->>V: Repassa a oferta e os candidatos
    V->>H: SDP answer + candidatos ICE
    H->>S: Repassa a resposta e os candidatos
    S-->>V: Mídia criptografada (DTLS-SRTP), direta ou via TURN
```

O servidor cuida de contas, amizades, presença, sinalização e distribuição das miniaturas autorizadas. O vídeo e o áudio da transmissão seguem por WebRTC, diretamente entre os computadores ou por um relay TURN. Quem transmite codifica a captura uma vez por espectador, e um controlador de qualidade ajusta bitrate, resolução e taxa de quadros a partir das estatísticas ao vivo.

O funcionamento dos componentes está em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e os registros de decisão em [docs/adr](docs/adr).

## Tecnologias

| Área | Tecnologia |
| --- | --- |
| Casca desktop | Electron 44, electron-vite, electron-builder (NSIS), electron-updater |
| Interface | React 19, TypeScript 6, Tailwind CSS 3, Geist e Geist Mono |
| Mídia | WebRTC do Chromium (H.264, Opus), parâmetros do `RTCRtpSender`, caminho PCM com AudioWorklet |
| Áudio nativo | .NET 10 e NAudio, captura por process loopback do Windows |
| Backend | ASP.NET Core 10, SignalR, Entity Framework Core, JWT |
| Dados | PostgreSQL em produção, SQLite em desenvolvimento |
| Entrega | GitHub Actions, Docker Compose, releases por tag e canal de atualização automática |

## Estrutura do repositório

| Pasta | Descrição |
| --- | --- |
| [`apps/desktop`](apps/desktop) | App Electron: captura, WebRTC, qualidade adaptativa e interface. |
| [`apps/server`](apps/server) | Serviço de sinalização: contas, amigos, sessões e credenciais TURN efêmeras. |
| [`apps/audio-bridge`](apps/audio-bridge) | Ponte de áudio nativa para captura por aplicativo no Windows. |
| [`ops`](ops) | Scripts e units para publicar o servidor Linux e as atualizações. |
| [`docs`](docs) | Arquitetura, privacidade das transmissões, registros de decisão (ADR) e notas de versão. |

## Primeiros passos

### Baixar

Baixe o instalador genérico do Windows (`Telae-Setup-<versão>.exe`) na [última release](https://github.com/NicolasPortie/Telae/releases/latest). Ele não vem com servidor nem feed oficial. O mantenedor distribui o instalador oficial por um link estável separado: ele já vem com o servidor e instala futuras atualizações automaticamente, após verificar a assinatura Ed25519 do projeto. Os instaladores ainda não têm certificado Authenticode do Windows, então o SmartScreen pode avisar na instalação inicial.

Para usar o instalador genérico, [hospede o servidor](#hospedagem-própria) e informe o endereço na tela de entrada (**Servidor > Alterar**) ou nas Configurações. Para embutir um endereço no seu instalador, defina `TELAE_DEFAULT_SERVER_URL` ao rodar `npm run dist`.

### Usar com amigos

1. Conectem os aplicativos ao mesmo servidor e criem suas contas.
2. Envie um pedido pelo @usuário do amigo e aguarde ele aceitar.
3. Clique em **Escolher tela**, selecione uma tela ou janela e escolha quem pode ver.
4. Comece a transmitir. Seu amigo pode entrar pelo botão **Assistir** no Início ou na lista de amigos.

Durante a transmissão, use **Quem pode ver > Alterar** para mudar o público. A miniatura acompanha automaticamente a seleção. Para ocultar suas transmissões de alguém, use o ícone de olho na lista de amigos; a aba **Privacidade** permite desfazer.

### Compilar a partir do código

**Requisitos:** Windows 10/11 x64, Node.js 22+ e .NET 10 SDK. O filtro de áudio por aplicativo exige o Windows build 20348 ou superior.

Servidor de sinalização (em desenvolvimento, usa SQLite local e salva os e-mails de verificação em `apps/server/data/dev-mail`, sem precisar de banco externo nem de SMTP):

```bash
dotnet run --project apps/server/Telae.Server.csproj
```

App desktop, em outro terminal:

```bash
cd apps/desktop
npm ci
npm run dev
```

Para gerar o instalador do Windows:

```bash
cd apps/desktop
npm run dist
```

## Hospedagem própria

O servidor de sinalização e o PostgreSQL rodam em contêineres. Copie `.env.example` para `.env`, defina `POSTGRES_PASSWORD` e `TELAE_JWT_KEY` (e o SMTP, para enviar os e-mails de verificação) e execute:

```bash
docker compose up -d
```

No app, abra **Configurações > Servidor de sinalização** e informe o endereço (por exemplo `http://localhost:5015`). O servidor guarda os perfis em um volume e expõe `GET /health`.

O Compose publica a porta apenas no próprio computador (`127.0.0.1:5015`). Para amigos acessarem de outros computadores, exponha o serviço por um proxy com HTTPS e use o mesmo endereço nos aplicativos. Configure `TELAE_ALLOWED_EMAILS` com os e-mails dos participantes ou abra o cadastro com `TELAE_REGISTRATION_OPEN=true`.

| Variável | Para que serve |
| --- | --- |
| `POSTGRES_PASSWORD` | Senha do banco PostgreSQL. |
| `TELAE_JWT_KEY` | Chave de assinatura dos tokens de acesso (32+ caracteres). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | E-mail transacional. Configure SMTP em produção para verificação e recuperação de conta. Sem ele, o envio fica indisponível; em desenvolvimento, os e-mails são salvos em `data/dev-mail`. |
| `TELAE_ALLOWED_EMAILS` | E-mails (separados por vírgula) que podem criar conta. O cadastro vem **fechado por padrão**: qualquer outra pessoa é recusada. |
| `TELAE_REGISTRATION_OPEN` | Use `true` para deixar qualquer pessoa criar conta (servidores públicos). |
| `Auth__AllowLegacyDevices` | Aceita clientes lançados antes das contas (sem login). Desligado por padrão. |
| `Auth__StrictRequestsPerMinute`, `Auth__RequestsPerMinute` | Limites por IP do cadastro e das demais chamadas de conta. |
| `Turn__Secret`, `Turn__Urls__0` | Relay TURN opcional para redes restritivas. |

Para redes restritivas, configure um servidor TURN (veja [`ops/turnserver.conf.example`](ops/turnserver.conf.example) e os comentários do [`docker-compose.yml`](docker-compose.yml)). Release, deploy e atualizações estão descritos em [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Segurança

- O renderer é isolado (`contextIsolation`, sem Node, sandbox, CSP restrita) e conversa com o processo principal por uma API de preload estreita e tipada.
- As senhas usam o hasher de senhas do ASP.NET Core. As sessões usam tokens de acesso JWT de vida curta e tokens de renovação com rotação e detecção de reutilização, guardados cifrados no cofre do sistema.
- Entrar em uma transmissão exige amizade mútua e passa por uma única regra de acesso no servidor (público escolhido, ocultos e removidos). O servidor também impõe limites de entrada e de taxa por IP e por conexão.
- A mídia é criptografada entre os pares (DTLS-SRTP); as credenciais TURN são efêmeras.

Para relatar uma vulnerabilidade, veja [SECURITY.md](SECURITY.md).

## Limitações conhecidas

- Só Windows por enquanto (a captura e o áudio dependem de APIs do Windows).
- Os instaladores ainda não têm certificado Authenticode do Windows, então o SmartScreen pode avisar na primeira execução. A atualização automática oficial usa uma chave Ed25519 própria fixada no app; builds genéricos precisam configurar o próprio feed e chave de confiança.
- Cada espectador recebe um fluxo codificado só para ele, então upload e CPU crescem com o número de espectadores. Um SFU é uma opção futura.
- 1440p60 depende da máquina e da rede.

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md) e [especificação do projeto](docs/PROJECT_SPEC.md)
- [Privacidade das transmissões](docs/adr/0005-share-audience.md)
- [Design da interface](docs/DESIGN.md) e [glossário](GLOSSARY.md)
- [Operação: release, deploy e atualizações](docs/OPERATIONS.md)
- [Changelog](CHANGELOG.md)

## Contribuindo

Para relatar um problema, abra uma issue. Leia o [CONTRIBUTING.md](CONTRIBUTING.md) antes de contribuir e siga o [Código de Conduta](CODE_OF_CONDUCT.md).

## Licença

Distribuído sob a [Licença MIT](LICENSE).

## Autor

Feito por **Nicolas Portie** · [GitHub](https://github.com/NicolasPortie)
