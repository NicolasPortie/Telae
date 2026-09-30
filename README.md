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

As versões usam tags SemVer (`v0.1.0`, `v0.1.1`, ...). Ao enviar uma tag `v*`, o GitHub Actions valida o servidor, cria o instalador Windows e publica o instalador, o `.blockmap` e o `latest.yml` em um GitHub Release privado. O servidor atualiza pela tag:

Exemplo:

```bash
git tag v0.1.1
git push origin v0.1.1
ssh nicolas@192.168.15.3 '~/apps/telae/repo/ops/update-server-from-tag.sh v0.1.1'
```

O estado persistente do servidor fica fora da pasta de release e não é versionado.

### Atualização automática do desktop

A partir da versão 0.1.5, o Telae instalado verifica atualizações ao abrir usando o endereço do servidor configurado no aplicativo. O servidor publica os arquivos em `/updates/windows/`. Quando há versão nova, o download começa automaticamente; se houver transmissão ativa, a instalação espera ela terminar. O app reinicia para instalar. A versão 0.1.4 não possui atualizador e precisa receber a 0.1.5 manualmente uma vez.

Para publicar uma versão a partir deste computador, execute `pwsh ./ops/publish-desktop-update.ps1` após `npm run dist` em `apps/desktop`. O script envia `Telae-Setup-X.Y.Z.exe`, o `.blockmap` e `latest.yml` do mesmo build ao servidor. No servidor, `ops/publish-desktop-update.sh` confere o SHA-512 e publica `latest.yml` por último. Confira `http://<servidor>:5015/updates/windows/latest.yml` após a publicação. Os arquivos ficam em `data/updates/windows`, fora das releases do backend. A conexão SSH pode pedir a senha ou usar uma chave configurada.

O repositório GitHub é privado e não fornece downloads anônimos aos clientes. Para acesso fora da rede local, configure HTTPS no endereço público do servidor antes de usar a atualização automática pela internet. Os instaladores atuais não possuem assinatura de código Windows.

