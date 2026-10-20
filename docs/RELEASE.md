# Telae — Release Checklist

## Segurança

- [ ] `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` no `BrowserWindow` (ver `src/main/index.ts`).
- [ ] Preload expõe só `window.telae` (superfície estreita e tipada).
- [ ] CSP restritiva no `index.html`; `setWindowOpenHandler` nega popups.
- [ ] Convites: 8 chars de alta entropia, TTL 10 min, uso único; esgotado não reentra (`share_not_active`).
- [ ] Credenciais TURN efêmeras (HMAC, TTL 1h padrão) — nunca estáticas no cliente.
- [ ] Queda curta do socket preserva a Share Session por até 20 s para reconexão; após a janela, a sessão/Viewer é removida no servidor.

## Empacotamento Windows

1. `npm run build` verde (tsc + electron-vite).
2. `npm run dist` gera o instalador NSIS x64 em `apps/desktop/dist/`.
3. Release assinada: definir `CSC_LINK` + `CSC_KEY_PASSWORD` no CI antes do `dist`.
4. Smoke test do instalador na matriz Windows suportada: inicia limpo, lista fontes, compartilha, entra via convite.

## Benchmark

- [ ] Seguir `docs/BENCHMARK.md` em Direct e Relay.
- [ ] Relatório arquivado com os JSONs de diagnóstico.
- [ ] Targets atingidos ou atualizados com evidência.

## Pós-release (marcos futuros)

Multi-viewer só via SFU como novo adapter de PeerTransport (nunca mesh). Captura nativa só se o benchmark provar que o Chromium limita.
