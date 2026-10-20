# Validação de 1440p30 e 1440p60 — 02/10/2026

Resultado: os dois perfis transmitiram vídeo real em **2560 × 1440**. O teste de integração passou, incluindo troca 1440p30 → 1440p60 → 1080p30 → 1440p30, preservando conexão e convite. Não foi encontrado erro funcional nos cenários executados. Isso não constitui garantia de desempenho em todo hardware ou rede.

## Ambiente e método

- Windows, Electron 44.4.5, duas instâncias do aplicativo no mesmo computador, servidor de sinalização local.
- Monitor principal: 2560 × 1440, escala 1, 60 Hz; secundário: 2560 × 1080, escala 1, 60 Hz.
- Fonte: janela real sem bordas, em tela cheia, com canvas animado de 2560 × 1440. Capturada pelo fluxo normal de `getDisplayMedia`, enviada por WebRTC e reproduzida pelo receptor do Telae. O canvas é conteúdo da janela; o stream não é simulado nem gerado por `captureStream`.
- Encoder observado: `MediaFoundationVideoEncodeAccelerator (NVIDIA H.264 Encoder MFT)`, com aceleração por hardware.
- Modo de conteúdo Texto, um espectador, limite total padrão de 40 Mbps.
- Verificação estrita da resolução recebida, conexão ativa, constraints de captura, continuidade dos frames e preservação do convite.
- Medição de frames efetivamente apresentados pelo elemento de vídeo em intervalos de aproximadamente 15 segundos por perfil; três amostras WebRTC por intervalo. Taxas de encoding/recepção instantâneas podem oscilar ao redor do alvo.

## Medições

| Perfil | Resolução recebida | FPS apresentados (média) | FPS recebidos nas amostras | Teto de vídeo |
| --- | --- | --- | --- | --- |
| 1440p30 | 2560 × 1440 | 29,91 | 30 / 30 / 30 | 20 Mbps |
| 1440p60 | 2560 × 1440 | 58,33 | 60 / 59 / 59 | 32 Mbps |
| 1080p30 | 1920 × 1080 | 30,06 | 30 / 30 / 30 | 12 Mbps |
| Retorno a 1440p30 | 2560 × 1440 | 29,97 | 30 / 30 / 30 | 20 Mbps |

Nas amostras do receptor, `packetsLost=0` e `framesDropped=0`; no emissor, `qualityLimitationReason=none`. A diferença entre FPS apresentados e FPS recebidos usa contadores e janelas distintos; não comprova por si só perda de rede ou descarte de decodificação.

Entre a primeira e terceira amostras de cada intervalo inicial: vídeo enviado médio de 2,40 Mbps e encode médio de 10,82 ms/quadro em 1440p30; 3,07 Mbps e 12,27 ms/quadro em 1440p60. Esses valores se aplicam ao padrão animado usado, não a filmes/jogos ou banda mínima necessária. Os 20/32 Mbps são tetos, não tráfego obrigatório.

Evidência: [telemetria de vídeo e parâmetros dos senders](../evidence/qhd-2026-10-02.json). O arquivo preserva os campos coletados de vídeo, pares de candidatos, settings e encodings, retirando listagens repetidas de todos os codecs e relatórios de áudio. O teste mantém a coleta completa em seu diretório de resultados.

As duas tentativas iniciais falharam porque a janela de teste tinha área útil menor que QHD: primeiro 2544 × 1378 (bordas/menu), depois 2560 × 1392 (limite da área de trabalho do Windows). A janela em tela cheia forneceu a fonte real de 2560 × 1440. Os asserts de resolução foram mantidos.

## Testes automatizados

- 110 testes unitários do desktop aprovados: captura dos dois perfis, FPS/bitrate aplicados ao sender, limites de upload, adaptação à pressão de CPU/rede e recuperação, alteração durante sessão e preservação do perfil após rejeição do servidor.
- 69 testes do servidor aprovados, incluindo início, entrada de espectador e alteração de qualidade com os novos perfis.
- Build, typecheck e lint aprovados.
- Teste de mídia real QHD aprovado em aproximadamente 1,2 minuto.

Reprodução (após `npm run build`, em `apps/desktop`, com monitor principal QHD/60 Hz e bridge de áudio compilado):

```powershell
$env:TELAE_E2E_MEDIA = '1'
$env:TELAE_E2E_RELAY = '0'
npm run test:e2e -- --grep 'QHD:'
```

## Onde fica o custo

O PC emissor captura e codifica, usando CPU/GPU conforme o encoder disponível. O PC receptor decodifica e apresenta os frames, também dependendo do hardware. O servidor de sinalização coordena a sessão e não recodifica vídeo. Em conexão direta, a mídia vai entre os PCs; em TURN, o servidor retransmite os dados e consome banda. Cada espectador tem uma conexão WebRTC e uma parcela do upload total configurado, então o tráfego cresce com espectadores adicionais; o custo de codificação depende também do comportamento do runtime.

## Limites da validação

Não foram medidos nesta execução: dois PCs físicos distintos, GPU integrada, Internet congestionada, TURN real, múltiplos espectadores em QHD, endurance, qualidade visual de filme/jogo e latência física glass-to-glass. Pressão de CPU/rede foi validada com estatísticas simuladas nos testes unitários, não imposta fisicamente durante este teste de mídia. O resultado local não valida 1440p60 estável em todos esses cenários. Siga [BENCHMARK.md](../BENCHMARK.md) para a matriz completa antes de afirmar suporte universal.
