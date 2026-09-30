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

A versão 0.1.12 exige credencial por dispositivo e convite para novos espectadores. Consulte [as notas de implantação e migração](docs/RELEASE_0.1.12.md) antes de atualizar o backend: os clientes antigos precisam atualizar para registrar no servidor novo. O aplicativo aceita até 12 espectadores, com qualidade e recuperação independentes por conexão.

### Atualização automática do desktop

A partir da versão 0.1.5, o Telae instalado verifica atualizações ao abrir usando o endereço do servidor configurado no aplicativo. O servidor publica os arquivos em `/updates/windows/`. Quando há versão nova, o download começa automaticamente; se houver transmissão ativa, a instalação espera ela terminar. O app reinicia para instalar. A versão 0.1.4 não possui atualizador e precisa receber uma versão mais recente manualmente. A partir da 0.1.8, o instalador usa `https://telae.nicolasportie.com` por padrão, inclusive ao migrar a configuração antiga `http://localhost:5015`.

O runner de publicação executa com uma conta dedicada no servidor e grava em `/var/lib/telae-updates/windows`. O publicador confere o SHA-512 e troca os arquivos de forma atômica, com `latest.yml` ao final. Confira `http://<servidor>:5015/updates/windows/latest.yml` após a publicação. Caso seja preciso republicar manualmente, execute `pwsh ./ops/publish-desktop-update.ps1` após `npm run dist` em `apps/desktop`, ou após baixar os três arquivos do GitHub Release para `apps/desktop/dist`.

O repositório GitHub é privado e não fornece downloads anônimos aos clientes. O túnel Cloudflare expõe `https://telae.nicolasportie.com` para sinalização e atualizações, inclusive fora da rede local. Quem instalou a versão 0.1.7 pode informar esse endereço em Configurações > Servidor de sinalização para recuperar a conexão e a atualização automática. Os instaladores atuais não possuem assinatura de código Windows.

