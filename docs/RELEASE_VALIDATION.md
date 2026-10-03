# Validação antes da publicação

## Fluxo automático

`validate.yml` executa lint, TypeScript, testes unitários, build .NET, testes do servidor, build desktop e E2E determinístico em Windows a cada PR/push. Não publica releases. Configure `checks` como status obrigatório na proteção de branches.

O workflow de tags valida o servidor e exige mídia real antes de gerar/publicar o instalador. O job `media-readiness` falha rapidamente se faltar configuração ou runner online/livre; não agenda o job de mídia nessas condições. Uma desconexão entre a verificação e o agendamento ainda pode deixar o job em fila: cancele a execução e restaure o runner. O timeout de job limita execução, não espera na fila.

Use uma máquina dedicada com Windows x64, monitor ativo, dispositivo de áudio e sessão de usuário desbloqueada. Execute o runner na sessão interativa, não como serviço Windows. Prepare uma janela capturável com conteúdo sem DRM e áudio reproduzindo. Registre labels `self-hosted`, `Windows`, `X64`, `telae-media`. Não use esse runner em PRs de forks; só tags revisadas de mantenedores chegam a ele.

Configuração do repositório:

| Campo | Tipo | Valor |
| --- | --- | --- |
| `TELAE_MEDIA_RUNNER_READY` | Variable | `true` após preparar a máquina |
| `MEDIA_RUNNER_STATUS_TOKEN` | Secret | Token de leitura de runners deste repositório, Administration: read |
| `TELAE_TEST_TURN_URL` | Variable, opcional | URL TURN de teste, sem senha embutida |
| `TELAE_TEST_TURN_SECRET` | Secret | Segredo REST do TURN de teste; obrigatório quando houver URL |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Secrets, opcionais | Certificado real e senha, conforme política de distribuição |

A consulta de runners usa a [API oficial do GitHub](https://docs.github.com/en/rest/actions/self-hosted-runners#list-self-hosted-runners-for-a-repository). Mantenha o token restrito e renove-o antes do vencimento. Runner de organização exige credenciais e escopo adequados ao endpoint utilizado.

O job físico compila o bridge e executa Electron headed com `TELAE_E2E_MEDIA=1`. Verifica frames decodificados, faixa de áudio, troca de fonte, espectadores, remoção e controles durante a transmissão. Com TURN configurado, executa também `TELAE_E2E_RELAY=1` e exige relay no par ICE selecionado. Sem TURN o teste relay é explicitamente omitido; isso não comprova aptidão para redes restritivas. Os artefatos HTML/trace registram falhas, mas não substituem o benchmark de hardware/rede.

A carga/endurance é opt-in: `TELAE_E2E_VIEWERS=3|6|12` com `TELAE_E2E_MEDIA=1` e `TELAE_E2E_SOAK_SECONDS>=60` (padrão 60; 3600 para uma hora). Nenhum workflow habilita carga automaticamente. Consulte comandos e limites de medição em [BENCHMARK.md](BENCHMARK.md). O teste determinístico de convite inválido não chama o bridge de áudio sem a flag de mídia.

## Contrato dos E2E com o aplicativo

### Endereço do cliente atrás do túnel

Antes de implantar o backend com limites de registro, configure o endereço exato do processo proxy. Sem isso, todos os clientes de um túnel compartilham o limite de registro do endereço do proxy. Para cloudflared acessando o origin por IPv4 loopback, acrescente ao arquivo protegido de ambiente do servidor:

```text
ClientAddress__KnownProxies__0=127.0.0.1
ClientAddress__HeaderName=CF-Connecting-IP
```

Acrescente `ClientAddress__KnownProxies__1=::1` somente se o túnel usa também IPv6 loopback. O backend ignora headers encaminhados por endereços não configurados e aceita somente um salto. Não use curingas nem exponha acesso direto ao origin que permita contornar o proxy confiável. Encaminhamento está desativado por padrão. Os testes verificam isolamento de limites entre clientes, spoofing e fallback para headers ausentes ou inválidos.

Os comandos novos `UpdateShareQuality` e `RemoveViewer` exigem implantar este backend antes de distribuir este desktop. Clientes anteriores ainda negociam mídia, mas não conhecem esses controles.

- `getEnvironment()` expõe `forceRelay: true` quando `!app.isPackaged && TELAE_E2E_RELAY === '1'` no processo principal. O renderer passa `iceTransportPolicy: 'relay'` a todos os peers e valida presença de credenciais TURN. Não altere a política com monkey patch no teste.
- Select `Qualidade da transmissão`, valores `720p60`, `1080p30`, `1080p60`, `1440p30`, `1440p60`. É o único ajuste de transmissão na interface.
- Botões `Parar transmissão`, `Trocar fonte`, `Remover ${displayName}`. O receptor mantém volume e silenciamento local.
- Vídeo `Transmissão do seu amigo`; `Assistindo` somente após confirmação de primeiro frame.
- O helper E2E `diagnosticSnapshot` coleta telemetria interna para confirmar o caminho ICE real (`relay`) do par selecionado; o teste também exige frames decodificados no receptor. Diagnósticos não aparecem na interface.

Após as mudanças do aplicativo serem compiladas, execute os E2E. Um teste que falha por contrato ausente é bloqueio de integração, não motivo para ignorá-lo.

## TURN de produção

`ops/turnserver.conf.example` é um template sem segredos válidos, baseado no [exemplo oficial coturn](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf). Instale coturn conforme o sistema operacional, copie para um caminho protegido e configure DNS, interfaces, IP público/NAT e certificado TLS válido. Substitua o segredo por pelo menos 32 bytes aleatórios; não o exponha ao desktop, ao log ou ao Git. No arquivo protegido de ambiente do servidor:

```dotenv
Turn__Secret=SEGREDO_GERADO_FORA_DO_GIT
Turn__Urls__0=turn:turn.example.com:3478?transport=udp
Turn__Urls__1=turn:turn.example.com:3478?transport=tcp
Turn__Urls__2=turns:turn.example.com:5349?transport=tcp
Turn__TtlSeconds=3600
```

O serviço versionado já lê `telae-server.env`. Restrinja permissões ao operador e à identidade de serviço. Abra 3478 UDP/TCP, 5349 TCP e a faixa UDP 49160–49260; redimensione faixa/capacidade conforme espectadores. Bloqueie relay para redes internas e monitore banda/alocações. Use um TURN de teste separado do segredo de produção no CI. Confirme emissão de credenciais temporárias, expiração, conexão forçada e comportamento após renovação em sessões longas. Uma health check de configuração não verifica conectividade TURN.

## Assinatura e evidência

O workflow transmite os secrets opcionais `CSC_LINK` e `CSC_KEY_PASSWORD` ao electron-builder. Configure um certificado adquirido/emitido pela organização; não há certificado criado neste trabalho. A distribuição de produção deve verificar Authenticode do EXE (`Get-AuthenticodeSignature`) e a cadeia esperada. Sem certificado, trate o artefato como candidato unsigned para teste. Veja a [documentação electron-builder](https://www.electron.build/code-signing.html).

Antes de criar a tag, complete [BENCHMARK.md](BENCHMARK.md) e registre evidência vinculada ao SHA candidato em um relatório conforme [VALIDATION_REPORT_TEMPLATE.md](VALIDATION_REPORT_TEMPLATE.md). Os E2E não medem automaticamente glass-to-glass nem drift acústico. Aprovação de targets revisados deve incluir resultado medido e justificativa; não publique alegações sem medições.
