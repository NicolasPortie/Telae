# Contribuindo

Para mudanças maiores, abra uma discussão ou relate o problema antes de começar. Isso ajuda a combinar o escopo da contribuição.

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

- Use [Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/): `tipo(escopo): descrição em pt-BR`. Exemplos: `feat(amigos): adicionar pedidos de amizade`, `fix(audio): corrigir captura de janelas minimizadas` e `chore(deps): atualizar dependências`. Use `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci` ou `chore` conforme a mudança; o escopo é opcional. Agrupe alterações relacionadas e preserve autoria e referências relevantes.
- Cores e espaçamentos vêm dos tokens em `apps/desktop/tailwind.config.cjs`; veja [docs/DESIGN.md](docs/DESIGN.md).
- Lógica de WebRTC, captura e sinalização fica em `src/services` (sem React) e precisa de teste unitário.
- Todo texto visível passa por `t('texto em pt-BR')` e precisa de tradução em `apps/desktop/src/i18n/en.ts` (o teste de i18n avisa o que falta).
- Mudanças visíveis ao usuário entram no [CHANGELOG](CHANGELOG.md).
