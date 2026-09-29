# Telae — Release Benchmark (Ticket 10)

Protocolo repetível para validar os Quality Targets do `PROJECT_SPEC.md` no release candidate.

## Setup

- 2 máquinas Windows (Sharer + Viewer) na matriz suportada: ao menos 1 com gráficos integrados Intel/AMD e 1 com GPU discreta NVIDIA/AMD.
- Servidor de sinalização acessível às duas (`TELAE_SIGNALING_URL` no main process / Settings mostra a URL ativa).
- TURN de produção configurado (`Turn:Secret` + `Turn:Urls` no `appsettings.json`).

## Roteiro (executar 1x em Direct e 1x em Relay)

1. Sharer: Share screen → 1080p60 → gerar convite.
2. Viewer: Join com o código → aguardar primeiro frame (cronometrar join → primeira imagem).
3. Sessão de 10 min com conteúdo em movimento (vídeo 1080p60) + áudio do sistema.
4. Durante a sessão, abrir Diagnostics e clicar **Exportar diagnóstico (JSON)** nas duas pontas ao final.
5. Forçar Relay: bloquear UDP/host direto no firewall da sessão Relay, ou apontar `Ice.Servers` só para TURN.

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

Sessão de 60 min em 1080p30 (modo filmes): observar drift A/V, crescimento de memória, degradação do encoder e falhas de reconexão. Registrar no relatório de release.

## Gate

Quality Targets ou **atingidos** ou **atualizados com evidência medida** antes do release. Sem exceção silenciosa.
