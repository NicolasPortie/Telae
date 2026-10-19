# Telae — Release Benchmark

Protocolo repetível para validar os Quality Targets do `PROJECT_SPEC.md` no release candidate.

## Setup

- 2 máquinas Windows (Sharer + Viewer) na matriz suportada: ao menos 1 com gráficos integrados Intel/AMD e 1 com GPU discreta NVIDIA/AMD.
- Servidor de sinalização acessível às duas (`TELAE_SIGNALING_URL` no main process / Settings mostra a URL ativa).
- TURN configurado via ambiente protegido (`Turn__Secret` + `Turn__Urls__N`), conforme [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md). Não versione segredos em `appsettings.json`.
- Registre SHA candidato, Windows, CPU/GPU/driver, display, áudio, rede e configuração. Faça cada cenário em GPU integrada e discreta. Use relógio/contador visual e impulsos A/V sincronizados como fonte, sem DRM.

## Roteiro (executar 1x em Direct e 1x em Relay)

1. Sharer: Share screen → 1080p60 → gerar convite.
2. Viewer: Join com o código → aguardar primeiro frame (cronometrar join → primeira imagem).
3. Sessão de 10 min com conteúdo em movimento (vídeo 1080p60) + áudio do sistema.
4. Nos testes automatizados, coletar a telemetria interna nas duas pontas com o helper `e2e/diagnostics.ts`. O teste de carga salva esses dados na evidência; a interface não oferece painel nem exportação de diagnóstico.
5. Forçar Relay no build de teste não empacotado: `TELAE_E2E_MEDIA=1`, `TELAE_E2E_RELAY=1`, após compilar desktop e bridge. O processo principal expõe `forceRelay`; o controller define `iceTransportPolicy: 'relay'`. Para o E2E execute `npm run test:e2e -- --grep 'relay obrigatório'`. Confirme `transportPath=relay` nas duas pontas. Apenas fornecer servidores TURN não força relay; bloquear só UDP também pode deixar outros caminhos diretos.

## Amostragem e evidência

Faça pelo menos 30 joins independentes por cenário e registre tempo desde confirmar Entrar até o primeiro frame apresentado. Conte falhas separadamente; não descarte joins que excedem o timeout. Ordene as amostras e use nearest rank: p95 é a amostra de índice `ceil(0,95 × N)` (base 1). Preserve valores brutos e método de coleta.

Para glass-to-glass filme simultaneamente fonte e destino com câmera de alta taxa de quadros e contador visual; use ao menos 100 pares de frames distribuídos pela sessão. Registre resolução temporal da câmera e erro de medição. Em máquinas remotas, sincronize relógios e documente erro residual ou use referência temporal externa. RTT, jitter e `getStats()` não medem glass-to-glass. Registre p95 separadamente para LAN direto, Internet direto e Internet relay.

Execute a matriz com **1, 3, 6 e 12 espectadores**, em direto e relay, pelo menos 10 minutos por cenário. Registre upload total do emissor, banda/custo de TURN, CPU/GPU, FPS/resolução por espectador, perdas e descartes. Inclua texto estático e movimento, perfil Auto e modos de conteúdo. O limite lógico de 12 participantes não garante capacidade de upload para 12 conexões. Declare limites suportados pelos resultados.

Durante a sessão teste alteração de qualidade, áudio on/off, troca de fonte, remoção de um espectador preservando os outros e interrupção breve de rede. Cronometre recovery até frames voltarem. Verifique que o estado de reprodução só aparece após o primeiro frame.

## Métricas (do JSON exportado + cronômetro)

| Métrica | Alvo inicial |
| --- | --- |
| Alvo visual padrão | 1080p60 quando sender, receiver e rede sustentam |
| Latência glass-to-glass LAN | p95 <= 180 ms |
| Latência glass-to-glass Internet | p95 <= 400 ms (RTT/perda dentro das condições suportadas) |
| Join → primeiro frame | <= 5 s p95 |
| Recuperação pós-queda breve (ICE restart) | <= 5 s quando o ICE recovery tem sucesso |
| A/V sync | Alinhado perceptualmente; medir drift no teste de endurance |
| Congestionamento | Reduz qualidade antes de buferizar longo |

Campos do JSON: `bitrateKbps`, `roundTripMs`, `packetLossPercent`, `framesPerSecond`, `jitterMs`, `width/height`, `codec`, `transportPath` (direct/relay), `candidateType`, `availableOutgoingKbps` + amostras de 1s (`samples`).

## Endurance (1x por release)

### Carga automatizada opcional (Windows / PowerShell)

Após `npm run build` e `npm run build:audio-bridge`, em `apps/desktop`, deixe uma fonte real em movimento. Execute **uma carga por vez**, após os demais E2E terminarem:

```powershell
$env:TELAE_E2E_MEDIA = '1'
$env:TELAE_E2E_RELAY = '0'
$env:TELAE_E2E_VIEWERS = '3' # repetir com '6' e '12'
$env:TELAE_E2E_SOAK_SECONDS = '60' # mínimo e padrão; smoke de carga
npm run test:e2e -- --grep 'carga e endurance opt-in'

# Uma hora de coleta, por configuração de espectadores:
$env:TELAE_E2E_SOAK_SECONDS = '3600'
npm run test:e2e -- --grep 'carga e endurance opt-in'

# Para relay: configure TURN no servidor e então repita a carga:
$env:TELAE_E2E_RELAY = '1'
npm run test:e2e -- --grep 'carga e endurance opt-in'

# Voltar à suíte rápida padrão:
Remove-Item Env:TELAE_E2E_VIEWERS, Env:TELAE_E2E_SOAK_SECONDS -ErrorAction SilentlyContinue
$env:TELAE_E2E_MEDIA = '0'
$env:TELAE_E2E_RELAY = '0'
```

Sem `TELAE_E2E_VIEWERS`, esse teste é omitido. Aceita somente 3/6/12 viewers e inteiro de soak >=60 segundos. O timeout cresce com duração e quantidade de espectadores. Evidências ficam em `test-results/load-N-media` ou `load-N-relay`: JSON incremental (inclusive em falha), screenshot full-page do emissor com controles e convite mascarado e screenshot do receptor, anexados ao relatório Playwright. Tracing está desligado só para carga, para evitar snapshots pesados em uma hora.

O JSON registra joins sequenciais desde o clique até `requestVideoFrameCallback`, contadores `totalVideoFrames`/drops e FPS de reprodução a cada ~5 segundos, diagnóstico público inicial/final com `framesDecoded`, `framesPerSecond` e amostras WebRTC, mais `app.getAppMetrics()` no início/fim do soak para emissor e cada receptor (memória em KiB; PIDs não são estáveis). Start significa todos os viewers já conectados; end é antes de parar. Dumps permitem investigar memória por processo e caminho ICE. O p95 de 3/6/12 joins é descritivo da execução e não atende a amostragem de release.

Todas as instâncias estão no mesmo computador e compartilham CPU/GPU/display/rede; a captura pode conter outras janelas de teste. Viewers têm saída sonora silenciada para evitar feedback. Esses dados **não medem glass-to-glass, áudio audível, sincronização A/V nem capacidade entre máquinas remotas**. Use o protocolo físico abaixo e a matriz de redes para essas conclusões. FPS de playback e `framesDecoded` WebRTC têm fontes distintas e não devem ser confundidos. Um smoke de 60 segundos não substitui endurance de 60 minutos nem garante qualidade para 12 espectadores.

Sessão de **60 min** em 1080p30 com conteúdo em movimento e áudio. Meça diferença entre flash visual e impulso sonoro no início e a cada 10 minutos; registre desvio absoluto e drift final menos inicial, memória e filas/descartes de áudio. Defina tolerância A/V antes de iniciar; o spec exige alinhamento perceptual, sem número de milissegundos inventado. Repita em relay para verificar renovação de credenciais TURN além do TTL. Verifique crescimento de memória, degradação do encoder e reconexão.

O JSON pode manter só uma janela recente de amostras; exportações no final não provam uma hora de comportamento. Recolha amostras continuamente ou exporte em intervalos e preserve resumos de sessão quando disponíveis. Use [VALIDATION_REPORT_TEMPLATE.md](VALIDATION_REPORT_TEMPLATE.md) e associe arquivos brutos ao SHA.

## Validação de 1440p (2K/QHD)

Repita os cenários em 1440p30 e 1440p60 com uma fonte real de pelo menos 2560 × 1440, comparando com 1080p30/60 na mesma máquina e rede. Registre resolução efetivamente recebida (a seleção do perfil não comprova 1440p), FPS, encodeMs/decodeMs, qualityLimitationReason, frames descartados, CPU/GPU, upload e latência. Inclua GPU integrada e dedicada, texto e movimento, direto e relay, um e vários espectadores.

Os tetos de 20 Mbps (30 fps) e 32 Mbps (60 fps) por espectador são iniciais. O orçamento total padrão pode limitar esses valores; documente o limite de upload usado. Não aumente o limite além da capacidade real da conexão. Teste sobrecarga de CPU e congestionamento, confirmando redução e recuperação de FPS/resolução sem encerrar a sessão. Fontes 1080p não validam QHD nativo. Sem essas medições não há garantia de 1440p60 fluido nem de suporte em toda GPU.

## Gate

Quality Targets ou **atingidos** ou **atualizados com evidência medida** antes do release. Sem exceção silenciosa. O workflow bloqueia publicação até os testes físicos passarem; o responsável pelo release deve revisar também este benchmark antes de criar a tag. Um E2E com faixa de áudio live não comprova som audível nem sincronização A/V; a gravação e o teste de endurance fornecem essa evidência.
