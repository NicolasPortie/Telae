import { defineConfig } from '@playwright/test'

/**
 * E2E de duas instâncias (IMPLEMENTATION_PLAN 02/03 + PROJECT_SPEC testing).
 * Requer: Windows com display, `npm run build` já executado.
 * - `npm run test:e2e` — fluxos determinísticos sem mídia (nomes, picker, convite inválido).
 * - `TELAE_E2E_MEDIA=1 npm run test:e2e` — fluxo completo com captura real (headed).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  reporter: 'line',
  use: {
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'dotnet run --project ..\\server\\Telae.Server.csproj --no-launch-profile --urls http://localhost:5015',
    url: 'http://localhost:5015/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
