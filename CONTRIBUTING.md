# Contribuindo

Obrigado pelo interesse. O projeto é pequeno e opinativo; abra uma issue antes de começar algo grande.

## Ambiente

- Windows 10/11 x64, Node.js 22+ e .NET SDK 10.
- `cd apps/desktop && npm ci` e, em outro terminal, `dotnet run --project apps/server/Telae.Server.csproj`.
- `npm run dev` abre o app apontando para o servidor local.

## Antes de abrir um PR

```bash
cd apps/desktop
npm run lint && npm run typecheck && npm test
npm run build && npm run test:e2e
```

```bash
dotnet test tests/server/Telae.Server.Tests.csproj
```

O E2E com captura real de tela e áudio é opcional (`TELAE_E2E_MEDIA=1`) e exige uma máquina Windows com monitor.

## Convenções

- Commits no formato [Conventional Commits](https://www.conventionalcommits.org/pt-br/) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `ci:`).
- Cores e espaçamentos vêm dos tokens em `apps/desktop/tailwind.config.cjs`; veja [docs/DESIGN.md](docs/DESIGN.md).
- Lógica de WebRTC, captura e sinalização fica em `src/services` (sem React) e precisa de teste unitário.
- Mudanças visíveis ao usuário entram no [CHANGELOG](CHANGELOG.md).
