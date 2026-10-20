# Qualidade e fluidez de compartilhamento — 2026-10-10

Relato: imagem de quem assiste com lag e baixa qualidade em 1080p60.

## Resultado medido

O teste de captura real passou, incluindo emissor minimizado, troca de perfis durante a transmissão e encerramento recebido pelo espectador. Em 1080p60, o receptor apresentou 55,15 e 55,47 fps nas duas medições de 15 segundos. O cenário original ficava próximo de 24 fps; a implementação intermediária ainda caía para aproximadamente 30 fps ao minimizar a janela.

Ambiente: Windows 11 build 26200, Electron 44.4.5 / Chromium 152, monitores de 60 Hz, emissor e receptor em dois processos no mesmo PC, sinalização local, captura real de monitor QHD com fonte animada a 60 fps. Encoder H.264 por hardware NVIDIA. Estes resultados não medem latência entre dois computadores nem garantem a mesma taxa em outras GPUs ou redes.

| Perfil na sequência de troca | FPS apresentados no receptor | Resolução |
| --- | ---: | --- |
| 1080p60, emissor minimizado | 55,15 | 1920 × 1080 |
| 1440p30 | 28,06 | 2560 × 1440 |
| 1440p60 | 48,83 | 2560 × 1440 |
| 1080p60, emissor minimizado | 55,47 | 1920 × 1080 |
| 1080p30 | 28,48 | 1920 × 1080 |
| 1440p30 | 28,42 | 2560 × 1440 |

Telemetria resumida sem candidatos de rede: [VALIDATION_STREAM_2026-10-10.metrics.json](VALIDATION_STREAM_2026-10-10.metrics.json). Na primeira medição de 1080p60, o encoder acumulou 5,341 segundos para 847 quadros, aproximadamente 6,3 ms por quadro; não indicou limitação de CPU ou banda.

## Alterações

- Perfis de 60 fps usam modo de movimento desde o início e nas trocas pela interface. A primeira oferta e as alterações ao vivo aplicam FPS, escala, política de degradação e teto de bitrate, respeitando o orçamento de upload por espectador.
- A captura solicita pixels nativos e FPS. Um canvas redimensiona os quadros antes do encoder, preservando a proporção e sem ampliar fontes menores. A entrega acompanha cada quadro real por requestVideoFrameCallback, sem timer que duplique quadros. Trocas alteram os limites do canvas e o FPS da fonte; encerramento, cancelamento e falhas liberam ambas as trilhas.
- Em Windows 11 24H2 ou posterior, ZeroCopyDesktopCapture e WebRtcAllowWgcUsingTexture são ativados juntos antes de app.ready, preservando outras opções do launcher. A tentativa inicial de passar essas opções somente no teste não era válida: o launcher substituía a lista de recursos.
- backgroundThrottling=false e os switches disable-renderer-backgrounding e disable-backgrounding-occluded-windows mantêm o processamento ativo quando a janela é minimizada ou coberta. O benchmark aprovado verifica explicitamente o emissor minimizado.
- O diagnóstico considera a taxa real do media-source ao inferir pressão no encoder. Uma fonte lenta, por si só, não deve causar redução indevida de resolução. Limitação explícita de CPU e atraso de encode ainda provocam adaptação.

Referências de implementação: [captura desktop do Chromium 152](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/content/browser/media/capture/desktop_capture_device.cc), [visibilidade de BrowserWindow no Electron](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility).

## Verificação

Build, typecheck, lint e 134 testes unitários passaram. Os testes adicionais cobrem os parâmetros de qualidade, orçamento por espectador, escala e proporção, ausência de ampliação, falha na troca de FPS, cancelamento, timeout, término nativo e liberação de recursos.

Três testes de mídia real passaram: benchmark QHD/1080p com seis etapas, captura de janela com áudio do processo escolhido e fluxo de amigos com múltiplos espectadores. Essa validação não certifica sincronismo audiovisual perceptual nem condições de uma conexão TURN remota.

Reprodução a partir de apps/desktop, depois de npm run build:

```powershell
$env:TELAE_E2E_MEDIA = '1'
$env:TELAE_E2E_RELAY = '0'
npm run test:e2e -- --grep 'QHD:'
npm run test:e2e -- --grep 'janela captura|amigos mútuos'
```

As alterações e o instalador de teste são locais. Nenhuma atualização foi publicada.
