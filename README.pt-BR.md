<div align="center">

[English](README.md) · **Português**

<img src="apps/desktop/public/icon.svg" alt="Telae" width="88" height="88" />

# Telae

**Compartilhe sua tela com amigos em alta qualidade e baixa latência.**

Aplicativo desktop para Windows (interface em português e inglês) com vídeo até 1440p60, áudio do sistema ou do aplicativo escolhido e transporte WebRTC peer-to-peer.

[![CI](https://github.com/NicolasPortie/Telae/actions/workflows/validate.yml/badge.svg)](https://github.com/NicolasPortie/Telae/actions/workflows/validate.yml)
![License](https://img.shields.io/badge/license-MIT-green)
![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![ASP.NET Core](https://img.shields.io/badge/ASP.NET_Core-SignalR-512BD4?logo=dotnet&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-E0AE5E)

</div>

<p align="center">
  <img src="docs/screenshots/pt-BR/home.png" alt="Tela inicial do Telae com o cartão de compartilhamento e a lista de amigos" width="860" />
</p>

## Visão geral

O Telae faz uma coisa bem: escolher uma tela ou janela e deixar um amigo assistir com imagem nítida, som sincronizado e latência baixa. Não há salas, chamadas nem canais. Quem está transmitindo aparece como **Ao vivo** na lista de amigos e entra com um clique.

## Recursos

- **Até 1440p60** com perfis explícitos (720p60, 1080p30, 1080p60, 1440p30, 1440p60) e adaptação automática sob pressão de CPU ou rede.
- **Áudio sincronizado** do sistema ou apenas do aplicativo escolhido, capturado por uma ponte nativa com process loopback do Windows. O áudio do Discord é excluído automaticamente ao compartilhar a tela inteira.
- **Amigos e presença**: código pessoal de 6 caracteres, amizade mútua, pedidos de amizade e troca rápida entre transmissões ao vivo.
- **Até 12 espectadores** por transmissão, cada um com qualidade e recuperação independentes.
- **Estatísticas em tempo real** no player e na tela de quem transmite: resolução, FPS, bitrate, latência estimada, jitter, perda de pacotes, travadas e rota (direta ou via servidor).
- **Peer-to-peer primeiro**: a mídia vai direto entre os pares e usa TURN somente quando a rede exige.
- **Avisos do Windows** quando um amigo começa a transmitir, início automático opcional e atualização automática em segundo plano.
- **Sem conta nem senha**: cada instalação tem uma identidade criptográfica própria ([ADR 0003](docs/adr/0003-device-identity.md)).

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/pt-BR/sharer.png" alt="Tela de quem transmite, com prévia, espectadores e estatísticas" /></td>
    <td width="50%"><img src="docs/screenshots/pt-BR/viewer.png" alt="Player do espectador com controles e painel de estatísticas" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Quem transmite: prévia, espectadores e telemetria</sub></td>
    <td align="center"><sub>Quem assiste: player com controles e estatísticas (tecla <code>I</code>)</sub></td>
  </tr>
</table>

## Arquitetura

```text
 Desktop (Electron + React)  ◄── sinalização SignalR ──►  Servidor (ASP.NET Core)
        │                                                     │
        └──────────── mídia WebRTC criptografada ─────────────┘
                 direta (P2P) · relay TURN como alternativa
```

| Pasta | Descrição |
| --- | --- |
| [`apps/desktop`](apps/desktop) | Aplicativo Electron com React, TypeScript e Tailwind. Captura, WebRTC, qualidade adaptativa e interface. |
| [`apps/server`](apps/server) | Serviço de sinalização ASP.NET Core/SignalR: dispositivos, amigos, sessões, convites e credenciais TURN efêmeras. |
| [`apps/audio-bridge`](apps/audio-bridge) | Ponte de áudio nativa (.NET/NAudio) para captura por aplicativo no Windows. |
| [`tests`](tests) | Testes do servidor e regressão de áudio real. |
| [`ops`](ops) | Scripts e unidades para implantação do servidor Linux e publicação das atualizações. |
| [`docs`](docs) | Arquitetura, decisões (ADR), validações de qualidade e notas de versão. |

Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e nas [decisões de arquitetura](docs/adr).

## Como executar

**Requisitos:** Windows 10/11 x64, Node.js 22+ e .NET SDK 10. O filtro de áudio por aplicativo exige Windows build 20348 ou superior.

Servidor de sinalização:

```bash
dotnet run --project apps/server/Telae.Server.csproj
```

Aplicativo desktop:

```bash
cd apps/desktop
npm ci
npm run dev
```

## Self-hosting

O servidor de sinalização roda em um container:

```bash
docker compose up -d
```

Depois, no app, abra **Configurações > Servidor de sinalização** e informe o endereço (por exemplo `http://localhost:5015`). O servidor persiste perfis em um volume e expõe `GET /health`. Para redes restritivas, configure um servidor TURN (veja [`ops/turnserver.conf.example`](ops/turnserver.conf.example) e os comentários do [`docker-compose.yml`](docker-compose.yml)).

## Testes e qualidade

```bash
cd apps/desktop
npm run lint        # oxlint
npm run typecheck   # tsc
npm test            # testes unitários e de componentes (vitest)
npm run test:e2e    # duas instâncias do Electron + servidor local (Playwright)
```

```bash
dotnet test tests/server/Telae.Server.Tests.csproj
```

O E2E com captura real de tela e áudio é opt-in (`TELAE_E2E_MEDIA=1`). Veja [docs/RELEASE_VALIDATION.md](docs/RELEASE_VALIDATION.md) e [docs/BENCHMARK.md](docs/BENCHMARK.md).

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md) e [especificação do projeto](docs/PROJECT_SPEC.md)
- [Design da interface](docs/DESIGN.md)
- [Operação: release, deploy e atualizações](docs/OPERATIONS.md)
- [Contribuindo](CONTRIBUTING.md) · [Segurança](SECURITY.md) · [Licença MIT](LICENSE)
- [Qualidade de transmissão](docs/validation/STREAMING_QUALITY_2026-10-12.md) e [benchmark](docs/BENCHMARK.md)
- [Changelog](CHANGELOG.md) · [Glossário](GLOSSARY.md)
