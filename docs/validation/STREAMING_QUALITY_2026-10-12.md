# Qualidade de transmissão — revisão de 12/10/2026

Escopo desta revisão: ajustes de áudio, jitter buffer, degradação de resolução, telemetria e interface. Nada foi publicado; as alterações estão na branch `feat/streaming-quality-polish`.

## O que foi medido

Ambiente: Windows 11, Electron 44 / Chromium 152, dois processos no mesmo PC, sinalização local, rota direta (RTT 0–1 ms), captura real do monitor. Não representa internet, relay ou duas máquinas.

| Verificação | Resultado |
| --- | --- |
| Testes unitários desktop | 146 aprovados |
| Lint, tipos, build | Aprovados |
| E2E determinístico | 2 aprovados, 5 ignorados por exigirem mídia |
| E2E com mídia real (janela com áudio do processo, amigos mútuos) | 2 aprovados com o novo SDP de áudio |
| Latência estimada pelo novo painel, rota direta, desktop leve | 7–48 ms, 29 fps, sem travadas |
| Latência estimada, desktop com filme em reprodução | 60–780 ms, ~21 fps, até 8 travadas em 30 s |

### Limites e achados

- **Benchmark QHD com tela real é instável nesta máquina.** O monitor principal agora opera a 200 Hz e há Discord e Steam abertos. Seis execuções de 1080p60 variaram entre 32 e 50 fps, com e sem estas alterações; não é possível atribuir diferença ao código novo nem ao antigo. Para comparar versões, repita em máquina ociosa e em monitor de 60 Hz.
- **Atraso crescente com conteúdo pesado.** Com um filme em reprodução na tela capturada, o atraso do jitter buffer subiu de ~260 para ~780 ms em 30 s, caiu de repente e foi acompanhado de travadas. Com buffer adaptativo e desktop leve isso não ocorreu. A causa não foi isolada. Hipóteses a testar: sincronização A/V com o caminho de áudio PCM, cadência de quadros do canvas de captura e carga de GPU. Esse é o próximo ponto a investigar.
- **Áudio estéreo não foi verificado em ouvido nem por medição de bitrate** em condições controladas. O código aplica os parâmetros e os testes de negociação passam, mas a validação ideal é conferir `audioBitrateKbps` e canais no painel durante um áudio de música.

## O que ainda depende de hardware ou infraestrutura

| Item | Por que não foi feito | Como validar |
| --- | --- | --- |
| Assinatura de código do instalador | Exige certificado (OV/EV) ou Azure Trusted Signing. O `electron-builder.yml` já lê `CSC_LINK` e `CSC_KEY_PASSWORD`. | Instalar em PC limpo e conferir o SmartScreen. |
| Limite de encoders de hardware com muitos espectadores | Cada espectador tem seu encoder. GPUs de consumo limitam sessões simultâneas de NVENC; o excedente cai para software. Os testes de carga existentes usaram conteúdo quase estático. | Carga com 6 e 12 espectadores e conteúdo em movimento, observando `encodeMs` e CPU. |
| Pular o canvas quando não há redução | Só vale se medido: o canvas resolve a escala e o ritmo de quadros. | Comparar latência e FPS com e sem canvas em máquina ociosa. |
| Codec adaptativo (AV1/HEVC) | Depende de encode e decode por hardware nos dois lados e de testes em várias GPUs. | `MediaCapabilities` + benchmark por GPU. |
| Rampa inicial de bitrate | Exige medir tempo até o bitrate-alvo em redes reais. | Registrar o bitrate a cada segundo nos primeiros 15 s. |
| Latência glass-to-glass e sincronia A/V | Exige fonte com marcador temporal e captura do receptor. O painel mostra apenas um piso estimado. | Roteiro em `BENCHMARK.md`, com marcador e clique de áudio. |
