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

As versões usam tags SemVer (`v0.1.0`, `v0.1.1`, ...). Ao enviar uma tag `v*`, o GitHub Actions valida o servidor, cria o instalador Windows, publica os três arquivos em um GitHub Release privado e os entrega automaticamente ao servidor de atualizações pelo runner `telae-updates`. O backend continua podendo ser atualizado separadamente pela tag:

Exemplo:

```bash
git tag v0.1.1
git push origin v0.1.1
ssh usuario@servidor '~/apps/telae/repo/ops/update-server-from-tag.sh v0.1.1'
```

O estado persistente do servidor fica fora da pasta de release e não é versionado.

### Atualização automática do desktop

A partir da versão 0.1.5, o Telae instalado verifica atualizações ao abrir usando o endereço do servidor configurado no aplicativo. O servidor publica os arquivos em `/updates/windows/`. Quando há versão nova, o download começa automaticamente; se houver transmissão ativa, a instalação espera ela terminar. O app reinicia para instalar. A versão 0.1.4 não possui atualizador e precisa receber a 0.1.5 manualmente uma vez.

O runner de publicação executa com uma conta dedicada no servidor e grava em `/var/lib/telae-updates/windows`. O publicador confere o SHA-512 e troca os arquivos de forma atômica, com `latest.yml` ao final. Confira `http://<servidor>:5015/updates/windows/latest.yml` após a publicação. Caso seja preciso republicar manualmente, execute `pwsh ./ops/publish-desktop-update.ps1` após `npm run dist` em `apps/desktop`, ou após baixar os três arquivos do GitHub Release para `apps/desktop/dist`.

O repositório GitHub é privado e não fornece downloads anônimos aos clientes. Para acesso fora da rede local, configure HTTPS no endereço público do servidor antes de usar a atualização automática pela internet. Os instaladores atuais não possuem assinatura de código Windows.

