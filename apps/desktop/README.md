# Telae Desktop

Aplicativo Electron do Telae: captura de tela e janela, WebRTC, qualidade adaptativa e a interface em React.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Inicia o app em modo de desenvolvimento (electron-vite) |
| `npm run build` | Verifica tipos e gera `out/` |
| `npm run lint` | oxlint |
| `npm run typecheck` | `tsc -b` |
| `npm test` | Testes unitários (vitest) |
| `npm run test:e2e` | E2E de duas instâncias com Playwright (inicia o servidor local) |
| `npm run dist` | Gera o instalador NSIS x64 com a ponte de áudio |

## Estrutura

```text
src/
├─ main/         processo principal: janela, IPC, perfil local, atualizações, ponte de áudio
├─ preload/      API segura exposta ao renderer (window.telae)
├─ shared/       contratos entre main e renderer
├─ services/     sinalização, WebRTC, captura, qualidade e telemetria (sem React)
├─ hooks/        estado de interface com efeitos (amigos e presença)
├─ components/   telas e componentes de interface
└─ ui/           formatação e constantes de apresentação
```

O renderer roda isolado (`contextIsolation`, sem Node) e fala com o processo principal somente por `window.telae`. Os tokens de design ficam em `tailwind.config.cjs`; veja [docs/DESIGN.md](../../docs/DESIGN.md).
