# Telae

Aplicativo desktop de compartilhamento de tela com sinalização ASP.NET Core/SignalR e transporte WebRTC.

## Estrutura

- `apps/desktop`: Electron + React + TypeScript.
- `apps/server`: servidor de sinalização ASP.NET Core/SignalR.
- `apps/audio-bridge`: bridge de áudio Windows/NAudio.
- `tests/server`: testes do servidor.
- `ops`: arquivos usados no deploy do servidor Linux.

## Desenvolvimento

Servidor:

```bash
dotnet run --project apps/server/Telae.Server.csproj
```

Desktop:

```bash
cd apps/desktop
npm ci
npm run dev
```

## Release e deploy

As versões usam tags SemVer (`v0.1.0`, `v0.1.1`, ...). Ao enviar uma tag `v*`, o workflow `Deploy server` roda os testes, publica o servidor e atualiza o serviço de produção no runner Linux dedicado.

Exemplo:

```bash
git tag v0.1.1
git push origin v0.1.1
```

O estado persistente do servidor fica fora da pasta de release e não é versionado.

