# Validação antes da publicação

## Fluxo automático

`validate.yml` executa lint, TypeScript, testes unitários, build .NET, testes do servidor, build desktop e E2E determinístico em Windows a cada PR/push. Não publica releases. Configure `checks` como status obrigatório na proteção de branches.

`release.yml` roda ao enviar uma tag `v*`: valida o servidor, confere que a tag corresponde à versão do desktop, repete lint, tipos, testes e o E2E determinístico, gera o instalador e cria a Release pública. Só usa runners da GitHub e só lê os segredos opcionais `CSC_LINK` e `CSC_KEY_PASSWORD` (certificado de assinatura).

## Validação física de mídia

A captura real de tela e áudio exige uma máquina com monitor, e por isso não roda no repositório público. Ela é executada a partir de um repositório de operação **privado**, num runner Windows dedicado, contra o código de uma tag do repositório público. Assim, nenhum PR de fora consegue executar código nessa máquina.

Use um Windows x64 com monitor ativo, dispositivo de áudio e sessão de usuário desbloqueada, com o runner na sessão interativa (não como serviço). Prepare uma janela capturável, sem DRM e com áudio reproduzindo. Para validar o relay TURN, defina no repositório privado a variável `TELAE_TEST_TURN_URL` (sem senha embutida) e o secret `TELAE_TEST_TURN_SECRET`.

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

O workflow público transmite os secrets opcionais `CSC_LINK` e `CSC_KEY_PASSWORD` ao electron-builder. Quando houver certificado Authenticode, verifique o EXE (`Get-AuthenticodeSignature`) e a cadeia esperada. O canal oficial a partir da 0.3.2 usa também assinatura Ed25519 própria para atualizações automáticas, com chave pública fixada na compilação e chave privada apenas no CI privado/cópia local protegida. Verifique a correspondência EXE/manifesto e o `.exe.sig.json`; um arquivo alterado, assinatura ausente ou chave diferente deve impedir a instalação, inclusive no cache. Essa assinatura não substitui a reputação/certificado Authenticode do Windows na instalação inicial. Veja os detalhes em [OPERATIONS.md](OPERATIONS.md).

Antes de criar a tag, complete [BENCHMARK.md](BENCHMARK.md) e registre evidência vinculada ao SHA candidato em um relatório conforme [VALIDATION_REPORT_TEMPLATE.md](VALIDATION_REPORT_TEMPLATE.md). Os E2E não medem automaticamente glass-to-glass nem drift acústico. Aprovação de targets revisados deve incluir resultado medido e justificativa; não publique alegações sem medições.
