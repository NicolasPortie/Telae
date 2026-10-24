# Operação: release, deploy e atualizações

## Perfis de qualidade

Os perfis **2K · 1440p** e **2K · 1440p60** capturam até 2560 × 1440 a 30/60 fps. Aqui, 2K é o nome popular de QHD/1440p, não o formato de cinema 2048 × 1080. Os tetos iniciais são 20/32 Mbps por espectador, sujeitos ao limite total de upload configurado.

- A seleção oferece apenas perfis explícitos, com **1080p30 como padrão**. O protocolo ainda aceita Auto de versões anteriores para preservar compatibilidade.
- Fontes menores continuam menores: o perfil não cria detalhes inexistentes. 1440p processa cerca de 78% mais pixels que 1080p na mesma taxa de quadros.
- A adaptação reduz FPS no modo Texto e resolução no modo Movimento quando há pressão de CPU; no modo Movimento também reduz resolução sob congestionamento.
- Tetos de bitrate são parâmetros iniciais, não requisitos mínimos nem garantia de desempenho. Valide em hardware real com o [benchmark](BENCHMARK.md).
- Para disponibilizar 1440p, atualize o servidor antes de distribuir o desktop: versões anteriores do backend rejeitam os novos perfis.

## Áudio

Compartilhar uma tela inteira exclui automaticamente o áudio do **aplicativo Discord** (incluindo PTB, Canary e Development) usando process loopback do Windows. O filtro acompanha abertura, fechamento e reinício, com detecção a cada 100 ms.

- Discord no navegador não pode ser separado dos outros sons do navegador.
- O filtro exige Windows build 20348 ou superior; sem ele, o vídeo continua sem som, sem voltar à captura geral.
- Com duas instalações independentes do Discord abertas, o áudio transmitido fica silencioso até restar uma: o Windows permite excluir apenas uma árvore de processos por capturador.
- Compartilhar uma janela mantém somente o áudio daquele aplicativo.

Regressão com áudio real, no Windows com saída de áudio disponível:

```bash
dotnet build tests/audio/Telae.Audio.Tests.csproj -c Release
python tests/audio/verify.py
```

O teste usa tons discretos de aplicativos separados e valida exclusão de processos filhos, abertura/reinício, preservação do outro aplicativo e silêncio seguro com duas árvores.

## Acesso ao servidor

- O cadastro vem fechado. Para liberar alguém, acrescente o e-mail em `Auth__AllowedEmails` (separados por vírgula) no ambiente do servidor e reinicie o serviço. `Auth__RegistrationOpen=true` abre para qualquer pessoa.
- Clientes sem conta ficam desligados (`Auth__AllowLegacyDevices=false`).
- O servidor não deve escutar em endereço público: use `ASPNETCORE_URLS=http://127.0.0.1:5015` atrás de um túnel ou proxy reverso com TLS (veja o [unit de exemplo](../ops/telae-server.service)).
- O Compose publica a porta 5015 apenas em `127.0.0.1`. Termine TLS no túnel/proxy; publique HTTPS/WSS, sem caminho HTTP público que contorne a borda. O desktop só aceita HTTP para loopback.
- Configure `Smtp__Host`, remetente e credenciais para enviar os códigos. Sem SMTP, o envio fica indisponível; códigos, senhas, tokens e endereços de e-mail não entram nos logs. A fila SMTP guarda até 256 mensagens em memória e não sobrevive a reinícios; nesse caso, peça um novo código após o intervalo de reenvio.
- Execute uma única instância do servidor. Registro, coordenação de contas e presença são locais ao processo; múltiplas réplicas exigem coordenação compartilhada.
- Em produção, configure `ConnectionStrings__Telae` para PostgreSQL. SQLite fica restrito a desenvolvimento/testes; falhas de leitura ou incompatibilidade de esquema interrompem a inicialização sem apagar o banco. Preserve o arquivo antes de qualquer recriação manual.

O corpo de `/auth/*` é limitado a 16 KiB antes de ler JSON, inclusive com transferência em blocos. Respostas de conta usam `Cache-Control: no-store`; as respostas HTTP incluem proteção contra interpretação indevida de conteúdo, enquadramento e envio de referência. HSTS é emitido em HTTPS fora de desenvolvimento. Isso não substitui TLS no proxy.

Só configure `ClientAddress__KnownProxies__0` (e índices seguintes) com os IPs exatos de proxies sob seu controle. O cabeçalho de cliente é `CF-Connecting-IP` por padrão, ou `X-Forwarded-For` quando configurado; `X-Forwarded-Proto` informa HTTPS. O proxy deve sobrescrever esses cabeçalhos e não aceitar valores arbitrários do cliente. Sem proxies configurados, nenhum deles é confiável. Não registre query strings de `/hubs/telae`: elas podem conter `access_token`; não habilite logs de corpos de `/auth`, parâmetros sensíveis do EF ou conteúdo SMTP.

Confirmação de e-mail e recuperação de senha permitem, por padrão, até 10 códigos emitidos (`Auth__MaxCodesPerDay`) e 20 tentativas incorretas (`Auth__MaxFailedCodeAttemptsPerDay`) por conta e finalidade em qualquer janela móvel de 24 horas. O intervalo de reenvio de 60 segundos e as 5 tentativas por código (`Auth__MaxCodeAttempts`) continuam valendo. Reenvios não zeram o orçamento diário; os históricos persistem no banco. Ao atingir o limite, o envio mantém a resposta genérica e a validação continua retornando `invalid_code`.

Tentativas de senha passam a usar a combinação de conta e IP resolvido pelo servidor: após 5 falhas (`Auth__MaxFailedLogins`), a espera começa em 1 segundo (`Auth__LoginBackoffSeconds`) e dobra até 15 minutos (`Auth__LockoutMinutes`). O histórico considera os últimos 60 minutos (`Auth__LoginFailureWindowMinutes`). Outro IP continua podendo entrar, respeitando o teto global de 100 falhas por conta nessa janela (`Auth__MaxAccountFailedLogins`), que limita tentativas distribuídas. As respostas permanecem `invalid_credentials`, inclusive para contas inexistentes; requisições bloqueadas não prolongam a espera. Os novos limites são validados na inicialização. Configure os proxies corretamente para que clientes distintos não compartilhem o IP da borda.

Contas, e-mails, nomes, hashes de senha, hashes de códigos e sessões ficam no banco; perfis e credenciais legadas com hash ficam no diretório de dados. Proteja esse diretório, o banco, backups e variáveis de ambiente por permissões e criptografia de disco conforme a implantação. Prévia de tela é memória transitória. O registro aceita até 10.000 perfis; acompanhe capacidade antes desse limite. No coturn, dimensione `user-quota`, `total-quota`, `max-bps` e `bps-capacity` para a capacidade real e mantenha os bloqueios de redes privadas do exemplo.

## Servidor padrão do instalador

O servidor que o app usa por padrão **não está no código nem no instalador público**. O endereço entra na compilação, pela variável `TELAE_DEFAULT_SERVER_URL`. O `release.yml` deste repositório não a define, então o instalador público (e qualquer build do código aberto) não vem com servidor: a pessoa escolhe o seu na tela de entrada (Servidor > Alterar) ou em Configurações. O instalador **oficial**, com o servidor do mantenedor, é gerado no repositório de operação privado e distribuído só por quem o mantém. Para um instalador próprio: `TELAE_DEFAULT_SERVER_URL=https://telae.seudominio.com npm run dist`.

A verificação de atualizações usa exclusivamente o servidor HTTPS definido na compilação por `TELAE_DEFAULT_SERVER_URL` (`<servidor>/updates/windows/`). Alterar o servidor de sinalização nas configurações não muda essa origem. Um build sem servidor fixo exige atualização manual.

O renderer empacotado é servido localmente por `telae://app`, com CSP aplicada no header da resposta. Conexões de sinalização ficam restritas à origem do servidor ativo e ao seu equivalente WS/WSS; os esquemas STUN/STUNS/TURN/TURNS permanecem permitidos para ICE. A política não libera HTTP(S) para outros servidores. A meta CSP continua como base estática; em desenvolvimento, o header também permite a origem local do renderer e seu WebSocket de desenvolvimento. Alterar o servidor salva a configuração para o próximo reinício, quando a política passa a usar a nova origem.

Atualize o backend antes de distribuir este desktop: o CORS do servidor precisa aceitar a origem exata `telae://app`. Se a borda também filtra origens, inclua esse valor sem liberar outros hosts do protocolo.

O `electron-builder` instalado suporta `electronFuses` diretamente. O instalador desativa execução como Node, `NODE_OPTIONS` e argumentos de inspeção; ativa criptografia de cookies, validação de integridade do ASAR e carregamento exclusivo do aplicativo pelo ASAR. Distribua o aplicativo empacotado completo, sem depender de código de inicialização externo ao ASAR.

## Repositórios e CI

O código fica neste repositório público e roda só em runners da GitHub, sem segredos de infraestrutura. A parte que mexe em máquinas próprias vive num repositório de operação **privado**: os runners `self-hosted`, a entrega do instalador ao servidor, a validação física de mídia e os scripts de deploy com o layout do servidor.

O repositório privado compila o instalador oficial a partir de uma tag do público. O público nunca o chama e não guarda segredos dele, então um PR de fora não alcança as máquinas de operação. Mantenha em Settings > Actions a aprovação de workflows para contribuidores externos, só ações oficiais liberadas e permissão de leitura por padrão. As tags `v*` têm regra de proteção: só o mantenedor cria.

## Versões e publicação

As versões usam tags SemVer (`v0.1.0`, `v0.1.1`, ...):

```bash
git tag v0.1.1
git push origin v0.1.1
```

Ao enviar a tag, o `release.yml` valida, gera o instalador genérico do Windows e cria a Release pública com o instalador, o blockmap e o `latest.yml`. O instalador oficial, a entrega ao servidor de atualizações e a atualização do backend são feitos pelo repositório de operação.

Quem hospeda o próprio servidor pode implantar o backend de qualquer forma que preferir (veja o `docker-compose.yml` e o [unit de exemplo](../ops/telae-server.service)). O estado persistente fica fora da pasta de release e não é versionado.

## Atualização automática do desktop

O aplicativo instalado e assinado verifica atualizações ao abrir e a cada 15 minutos, usando o endereço HTTPS fixado na compilação. O servidor publica os arquivos em `/updates/windows/` (`Updates__Path`).

- Quando há versão nova, o download começa sozinho. Com transmissão ativa, a instalação espera o encerramento.
- O app reinicia e instala em silêncio, sem abrir o assistente. A tela inicial oferece "Buscar atualização" e a versão instalada aparece no cabeçalho.
- O instalador inicial usa instalação com um clique, por usuário. Instalações para todos os usuários podem exigir autorização do Windows na atualização.
- Mudanças só chegam a aplicativos já instalados depois de distribuídas em uma nova versão.

O publicador confere o SHA-512 do instalador contra o `latest.yml` e troca os arquivos de forma atômica, com o `latest.yml` por último. Confira `/updates/windows/latest.yml` após publicar.

Os instaladores sem assinatura exigem atualização manual a partir da página oficial do projeto. Para habilitar atualizações automáticas, assine o build com `CSC_LINK` e `CSC_KEY_PASSWORD` no ambiente de release e confira o `publisherName` gerado no `app-update.yml` instalado. O publicador esperado vem desse arquivo local, nunca do servidor de sinalização. O SHA-512 sozinho não autentica um instalador quando o mesmo servidor fornece o manifesto e o executável. Distribua esta versão segura também para quem ainda usa o atualizador antigo.

A migração de sessões de conta adiciona a família de refresh tokens; o PostgreSQL aplica a migração no início. Tokens antigos e sessões locais sem vínculo com o servidor exigem novo login. Faça backup do banco e atualize servidor e desktop de forma coordenada.

Esta atualização também adiciona tabelas de histórico para os limites de autenticação; o PostgreSQL aplica a nova migração ao iniciar. O SQLite de desenvolvimento/testes com esquema antigo interrompe a inicialização para preservar os dados: faça backup e atualize o esquema ou recrie explicitamente apenas um banco descartável.

`Auth__JwtKey` permanece como chave raiz, mas HKDF-SHA-256 deriva chaves independentes com os rótulos `telae/jwt-signing/v1` e `telae/one-time-codes/v1`. Tokens de acesso e códigos pendentes emitidos antes deste deploy deixam de valer, mesmo mantendo a chave raiz. Peça um novo código após o intervalo de reenvio; sessões com refresh token válido podem obter um novo token de acesso. Não misture instâncias de versões anteriores e novas durante a atualização.

## Proteção opcional na borda

Estas recomendações usam o proxy da Cloudflare; o serviço continua em Docker/systemd e não depende de Workers ou de bibliotecas Cloudflare.

- Restrinja o acesso direto à origem por túnel ou firewall, publique apenas HTTPS e mantenha TLS completo até a origem quando ela estiver em outra máquina. Confiar em cabeçalhos sem restringir o acesso à origem permite contornar limites por IP.
- Ative regras gerenciadas do WAF e valide falsos positivos antes de bloquear. Regras próprias podem restringir host, caminhos e métodos aos usados por `/auth/*`, `/hubs/telae*`, `/health` e `/updates/windows/*`; preserve `OPTIONS`, negociação e os transportes SignalR. Não imponha desafios HTML indiscriminados às chamadas do desktop.
- Adicione limites por IP para cadastro/reenvio/recuperação, login/validação e negociação do hub. Comece alinhado aos limites da aplicação (6/min para envio/cadastro e 30/min para demais chamadas de conta), observe NATs compartilhados e ajuste ao tráfego real e ao plano contratado. Use bloqueio/429 para a API. Limites por conta continuam no servidor.
- O WAF inspeciona a abertura do WebSocket, sem inspecionar suas mensagens posteriores; mantenha os limites de sinalização e prévias na aplicação. Veja [WebSockets](https://developers.cloudflare.com/network/websockets/) e [parâmetros de limites](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/).
- Para cadastro e recuperação públicos, considere Turnstile em uma página HTTPS própria integrada ao fluxo do desktop. A futura integração deve validar o token no servidor por Siteverify, conferir `hostname` e `action`, rejeitar falhas, expiração e reutilização; o token vale cinco minutos e é de uso único. O widget sozinho não protege o endpoint. Veja [validação de tokens](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). Não foi integrado: exige domínio, chaves e um fluxo de desafio que este cliente ainda não possui.

Veja também o [checklist de release](RELEASE.md) e os [requisitos de validação](RELEASE_VALIDATION.md).
