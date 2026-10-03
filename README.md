# Telae

Aplicativo desktop de compartilhamento de tela com sinalização ASP.NET Core/SignalR e transporte WebRTC.

Consulte [as melhorias e resultados de validação](docs/IMPROVEMENTS_2026-10-02.md) e [os requisitos de publicação](docs/RELEASE_VALIDATION.md) para esta revisão local.

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

O atualizador verifica novas versões ao abrir, baixa em segundo plano e instala silenciosamente, reabrindo o Telae automaticamente. Se houver sessão ativa, aguarda seu encerramento. A instalação inicial ainda usa o instalador; instalações feitas para todos os usuários podem exigir autorização do Windows na atualização. As mudanças precisam ser distribuídas em uma nova versão para chegar aos aplicativos já instalados.

Os perfis **2K · 1440p** e **2K · 1440p60** capturam até 2560 × 1440 a 30/60 fps. Aqui, 2K é o nome popular de QHD/1440p, não o formato cinema 2048 × 1080. Os tetos iniciais são 20/32 Mbps por espectador, sujeitos ao limite total de upload configurado. A seleção oferece apenas perfis explícitos, com **1080p30 como padrão**; Auto foi removido da interface. O protocolo ainda aceita Auto de versões anteriores para preservar compatibilidade. Fontes menores continuam menores; o perfil não cria detalhes inexistentes. 1440p processa aproximadamente 78% mais pixels que 1080p na mesma taxa de quadros. A adaptação reduz FPS no modo Texto e resolução no modo Movimento quando há pressão de CPU; no modo Movimento também reduz resolução sob congestionamento. Tetos de bitrate são parâmetros iniciais, não requisitos mínimos ou garantia de desempenho. Consulte [o benchmark](docs/BENCHMARK.md) para validar em hardware real.

Para disponibilizar 1440p, atualize o servidor antes de distribuir o desktop: o backend anterior rejeita os novos perfis.

As versões usam tags SemVer (`v0.1.0`, `v0.1.1`, ...). Ao enviar uma tag `v*`, o GitHub Actions valida o servidor, cria o instalador Windows, publica os três arquivos em um GitHub Release privado e os entrega automaticamente ao servidor de atualizações pelo runner `telae-updates`. O backend continua podendo ser atualizado separadamente pela tag:

Exemplo:

```bash
git tag v0.1.1
git push origin v0.1.1
ssh usuario@servidor '~/apps/telae/repo/ops/update-server-from-tag.sh v0.1.1'
```

O estado persistente do servidor fica fora da pasta de release e não é versionado.

A versão 0.1.13 exige credencial por dispositivo e convite para novos espectadores. Consulte [as notas de implantação e migração](docs/RELEASE_0.1.13.md) antes de atualizar o backend: os clientes antigos precisam atualizar para registrar no servidor novo. O aplicativo aceita até 12 espectadores, com qualidade e recuperação independentes por conexão.

### Atualização automática do desktop

A partir da versão 0.1.5, o Telae instalado verifica atualizações ao abrir usando o endereço do servidor configurado no aplicativo. O servidor publica os arquivos em `/updates/windows/`. Quando há versão nova, o download começa automaticamente; se houver transmissão ativa, a instalação espera ela terminar. O app reinicia para instalar silenciosamente, sem abrir o assistente. Na versão 0.1.19, a versão instalada aparece no cabeçalho, a tela inicial oferece “Buscar atualização” e o app verifica novidades a cada 15 minutos. O instalador inicial usa instalação com um clique, por usuário. A versão 0.1.4 não possui atualizador e precisa receber uma versão mais recente manualmente. A partir da 0.1.8, o instalador usa `https://telae.nicolasportie.com` por padrão, inclusive ao migrar a configuração antiga `http://localhost:5015`.

O runner de publicação executa com uma conta dedicada no servidor e grava em `/var/lib/telae-updates/windows`. O publicador confere o SHA-512 e troca os arquivos de forma atômica, com `latest.yml` ao final. Confira `http://<servidor>:5015/updates/windows/latest.yml` após a publicação. Caso seja preciso republicar manualmente, execute `pwsh ./ops/publish-desktop-update.ps1` após `npm run dist` em `apps/desktop`, ou após baixar os três arquivos do GitHub Release para `apps/desktop/dist`.

O repositório GitHub é privado e não fornece downloads anônimos aos clientes. O túnel Cloudflare expõe `https://telae.nicolasportie.com` para sinalização e atualizações, inclusive fora da rede local. Quem instalou a versão 0.1.7 pode informar esse endereço em Configurações > Servidor de sinalização para recuperar a conexão e a atualização automática. Os instaladores atuais não possuem assinatura de código Windows.
