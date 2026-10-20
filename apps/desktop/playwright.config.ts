import { defineConfig } from '@playwright/test'

const externalSignalingUrl = process.env.TELAE_E2E_SIGNALING_URL?.replace(/\/+$/, '')
const evidenceKind = process.env.TELAE_E2E_VIEWERS
  ? `load-${process.env.TELAE_E2E_VIEWERS}-${process.env.TELAE_E2E_RELAY === '1' ? 'relay' : 'media'}`
  : process.env.TELAE_E2E_RELAY === '1' ? 'relay' : process.env.TELAE_E2E_MEDIA === '1' ? 'media' : 'deterministic'
if (process.env.TELAE_E2E_RELAY === '1' && process.env.TELAE_E2E_MEDIA !== '1') {
  throw new Error('TELAE_E2E_RELAY=1 exige TELAE_E2E_MEDIA=1 e TURN funcional.')
}

/**
 * E2E de duas instâncias (ver docs/PROJECT_SPEC.md, seção de testes).
 * Requer: Windows com display, `npm run build` já executado.
 * - `npm run test:e2e` — fluxos determinísticos sem mídia (nomes, picker, convite inválido).
 * - `TELAE_E2E_MEDIA=1 npm run test:e2e` — fluxo completo com captura real (headed).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir: `test-results/${evidenceKind}`,
  reporter: [['line'], ['html', { open: 'never', outputFolder: `playwright-report/${evidenceKind}` }]],
  use: {
    trace: 'retain-on-failure',
  },
  webServer: externalSignalingUrl
    ? undefined
    : {
        command: 'dotnet run --project ..\\server\\Telae.Server.csproj --no-launch-profile --urls http://localhost:5015',
        url: 'http://localhost:5015/health',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
