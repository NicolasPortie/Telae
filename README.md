<div align="center">

**English** · [Português](README.pt-BR.md)

<img src="apps/desktop/public/icon.svg" alt="Telae" width="88" height="88" />

# Telae

**Share your screen with friends in high quality and low latency.**

A Windows desktop app (English and Portuguese UI) with video up to 1440p60, system or per-application audio, and peer-to-peer WebRTC transport.

[![CI](https://github.com/NicolasPortie/Telae/actions/workflows/validate.yml/badge.svg)](https://github.com/NicolasPortie/Telae/actions/workflows/validate.yml)
![License](https://img.shields.io/badge/license-MIT-green)
![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![ASP.NET Core](https://img.shields.io/badge/ASP.NET_Core-SignalR-512BD4?logo=dotnet&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-E0AE5E)

</div>

<p align="center">
  <img src="docs/screenshots/home.png" alt="Telae home screen with the share card and the friends panel" width="860" />
</p>

## Overview

Telae does one thing well: pick a screen or window and let a friend watch it with a sharp picture, synced sound and low latency. There are no rooms, calls or channels. Whoever is streaming shows up as **Live** in your friends list, and you join with one click.

## Features

- **Up to 1440p60** with explicit profiles (720p60, 1080p30, 1080p60, 1440p30, 1440p60) and automatic adaptation under CPU or network pressure.
- **Synced audio** from the whole system or only the chosen application, captured by a native bridge using Windows process loopback. Discord's audio is excluded automatically when sharing a full screen.
- **Friends and presence**: add people by their @username, mutual friendship, friend requests and quick switching between live streams. The friend list lives on the server, so it follows your account to any computer.
- **Up to 12 viewers** per stream, each with independent quality and recovery.
- **Real-time statistics** in the player and on the sharer screen: resolution, FPS, bitrate, estimated latency, jitter, packet loss, freezes and route (direct or relayed).
- **Peer-to-peer first**: media flows directly between peers and uses TURN only when the network requires it.
- **Windows notifications** when a friend goes live, optional launch at startup and background auto-updates.
- **Accounts**: email + password with 6-digit email verification, password recovery, rotating sessions and account deletion ([ADR 0004](docs/adr/0004-user-accounts.md)). Tokens are kept in the OS keystore.
- **English and Portuguese** interface, following the Windows language or chosen in Settings.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/sharer.png" alt="Sharer screen with preview, viewers and statistics" /></td>
    <td width="50%"><img src="docs/screenshots/viewer.png" alt="Viewer player with controls and the statistics panel" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Sharer: preview, viewers and telemetry</sub></td>
    <td align="center"><sub>Viewer: player with controls and statistics (key <code>I</code>)</sub></td>
  </tr>
</table>

## Architecture

```text
 Desktop (Electron + React)  ◄── SignalR signaling ──►  Server (ASP.NET Core)
        │                                                     │
        └──────────── encrypted WebRTC media ─────────────────┘
                  direct (P2P) · TURN relay as fallback
```

| Folder | Description |
| --- | --- |
| [`apps/desktop`](apps/desktop) | Electron app with React, TypeScript and Tailwind: capture, WebRTC, adaptive quality and UI. |
| [`apps/server`](apps/server) | ASP.NET Core/SignalR signaling service: devices, friends, sessions, invites and ephemeral TURN credentials. |
| [`apps/audio-bridge`](apps/audio-bridge) | Native audio bridge (.NET/NAudio) for per-application capture on Windows. |
| [`tests`](tests) | Server tests and a real-audio regression test. |
| [`ops`](ops) | Scripts and units to deploy the Linux server and publish updates. |
| [`docs`](docs) | Architecture, decision records (ADR), quality validations and release notes (mostly in Portuguese). |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the [decision records](docs/adr).

## Getting started

**Requirements:** Windows 10/11 x64, Node.js 22+ and the .NET 10 SDK. Per-application audio filtering needs Windows build 20348 or later.

Signaling server:

```bash
dotnet run --project apps/server/Telae.Server.csproj
```

Desktop app:

```bash
cd apps/desktop
npm ci
npm run dev
```

## Self-hosting

The signaling server and its PostgreSQL database run in containers. Copy `.env.example` to `.env`, set `POSTGRES_PASSWORD` and `TELAE_JWT_KEY` (and the SMTP settings, so verification emails can be sent), then:

```bash
docker compose up -d
```

In development (`dotnet run`), accounts use a local SQLite file and verification codes are written to the server log, so no database or mail server is needed.

Then, in the app, open **Settings > Signaling server** and enter its address (for example `http://localhost:5015`). The server keeps profiles in a volume and exposes `GET /health`. For restrictive networks, configure a TURN server (see [`ops/turnserver.conf.example`](ops/turnserver.conf.example) and the comments in [`docker-compose.yml`](docker-compose.yml)).

## Tests and quality

```bash
cd apps/desktop
npm run lint        # oxlint
npm run typecheck   # tsc
npm test            # unit and component tests (vitest)
npm run test:e2e    # two Electron instances + local server (Playwright)
```

```bash
dotnet test tests/server/Telae.Server.Tests.csproj
```

The end-to-end suite with real screen and audio capture is opt-in (`TELAE_E2E_MEDIA=1`). See [docs/RELEASE_VALIDATION.md](docs/RELEASE_VALIDATION.md) and [docs/BENCHMARK.md](docs/BENCHMARK.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md) and [project spec](docs/PROJECT_SPEC.md)
- [UI design](docs/DESIGN.md)
- [Operations: release, deploy and updates](docs/OPERATIONS.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT License](LICENSE)
- [Streaming quality](docs/validation/STREAMING_QUALITY_2026-10-12.md) and [benchmark](docs/BENCHMARK.md)
- [Changelog](CHANGELOG.md) · [Glossary](GLOSSARY.md)
