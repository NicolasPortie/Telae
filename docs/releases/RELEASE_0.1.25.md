# Telae 0.1.25 — áudio e captura contínua

Correção de 14/10/2026 para o relato de áudio atrasando e vídeo com travadas, incluindo a comparação entre 1080p e 1440p.

## Causas reproduzidas

- Uma pausa na entrega de PCM deixava uma fila persistente: produzir e consumir áudio na mesma taxa não elimina o atraso acumulado. O teste de regressão anterior à correção manteve 5.760 quadros (120 ms a 48 kHz) mesmo depois de 600 ms de entrega regular.
- O caminho com vídeo oculto e `requestVideoFrameCallback` dependia do compositor. Na captura real de janela, minimizar o emissor reduziu captura e recepção de aproximadamente 60 para 1 fps, enquanto a janela de origem continuava desenhando a aproximadamente 200 fps.
- O benchmark antigo de monitor podia selecionar uma tela diferente da fonte em máquinas com múltiplos monitores, ou capturar o player por cima da fonte. Essas execuções não servem como comparação de qualidade ou FPS.

## Correções

- `MediaStreamTrackProcessor` recebe os quadros diretamente, com buffer de um quadro. `MediaStreamTrackGenerator` entrega os quadros ao WebRTC, preservando timestamps de captura. Não há uma superfície de vídeo oculta entre captura e transmissão nesse caminho.
- Dimensões são declaradas sobre o `VideoFrame` nativo, evitando uma cópia intermediária de canvas. A saída mantém a proporção, os limites do perfil e fontes menores sem ampliação. O limite de FPS atua antes da entrega ao encoder.
- Depois de 250 ms com fila de áudio persistentemente acima de 40 ms, o worklet descarta o excesso antigo e mantém os 20 ms mais recentes. Picos breves e a entrega normal de pacotes de 20 ms não provocam essa recuperação. O limite absoluto de memória continua em 120 ms.
- O benchmark agora seleciona o monitor que contém a fonte, afasta o player desse monitor quando há uma segunda tela, verifica um marcador dentro da imagem e salva PNGs dos quadros decodificados na resolução real.
- Os tetos de vídeo continuam em 12/20 Mbps para 1080p30/60 e 20/32 Mbps para 1440p30/60, respeitando o orçamento de upload. Esta correção não aumenta o buffer de reprodução para ocultar lentidão.

## Validação

Ambiente local: Windows 11 build 26200, Electron 44 / Chromium 152, encoder H.264 NVIDIA, monitor principal 2560 × 1440 a 200 Hz e monitor secundário 2560 × 1080 a 60 Hz. Emissor e receptor são processos distintos no mesmo PC, com sinalização local e rota direta.

O teste A/V usa uma janela própria com contador codificado em pixels e pulsos simultâneos de luz e áudio. Coleta 30 segundos, provoca uma pausa de 180 ms no renderer do emissor e depois minimiza sua janela. O áudio do receptor é analisado no Web Audio; isso não mede a saída física dos alto-falantes. O benchmark QHD usa padrão animado e texto, não um filme ou uma conexão entre dois computadores.

Validação concluída: build com TypeScript e lint passaram; 157 testes unitários em 19 arquivos e seis testes E2E passaram, incluindo captura de janela com áudio, amizade, múltiplos espectadores, latência e troca entre perfis de resolução.

| Perfil | Resolução recebida | FPS apresentados |
| --- | --- | --- |
| 1080p60 | 1920 × 1080 | 50,46 |
| 1440p30 | 2560 × 1440 | 28,92 |
| 1440p60 | 2560 × 1440 | 49,26 |
| 1080p60 (retorno) | 1920 × 1080 | 49,98 |
| 1080p30 | 1920 × 1080 | 29,26 |
| 1440p30 (retorno) | 2560 × 1440 | 29,24 |

Os quadros decodificados mantiveram a resolução esperada e texto legível, com mais detalhe em 1440p. Os perfis de 60 fps foram medidos com o emissor minimizado; neste PC entregaram aproximadamente 50 fps. Isso não garante 60 fps em qualquer hardware ou conexão.

No teste A/V, o percentil 95 da latência de vídeo foi 100 ms. Os 16 pares de pulsos tiveram diferença mediana de +87 ms entre áudio e vídeo; a mediana inicial foi +138 ms e a final +76 ms. O sinal positivo indica áudio observado depois do vídeo. A fila não acumulou atraso depois da pausa e da minimização. Esses números descrevem o grafo de reprodução local durante 30 segundos, sem medir alto-falantes, sincronismo labial de um filme ou uma sessão longa pela internet.

As métricas resumidas estão em [stream-2026-10-14.metrics.json](../evidence/stream-2026-10-14.metrics.json). As capturas de qualidade e a telemetria completa foram preservadas localmente em `apps/desktop/build/validation-0.1.25/`.

## Atualização

Atualize emissor e espectador. No Telae, use **Buscar atualização**. A instalação aguarda o encerramento da transmissão; não é necessário interromper uma sessão para baixar a atualização.

Nenhuma mudança no servidor de sinalização ou reinicialização de serviço é necessária para esta correção.
