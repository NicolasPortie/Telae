import { expect, test, type ElectronApplication, type Page, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const WITH_MEDIA = process.env.TELAE_E2E_MEDIA === '1'

async function launchApp(): Promise<ElectronApplication> {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telae-e2e-'))
  const app = await electron.launch({
    args: [APP_DIR, '--no-sandbox', `--user-data-dir=${userDataDir}`],
  })
  app.on('window', (page) => {
    page.on('pageerror', (error) => {
      throw new Error(`Renderer pageerror: ${error.message}`)
    })
  })
  return app
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return page
}

async function enterWithName(page: Page, name: string) {
  const nameInput = page.getByLabel('Seu nome')
  await nameInput.fill(name)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: /Mostre sua tela/ })).toBeVisible({ timeout: 30_000 })
}

test.describe('duas instâncias Telae', () => {
  test('convite inválido falha com motivo específico', async () => {
    const sharerApp = await launchApp()
    const viewerApp = await launchApp()
    try {
      const sharer = await firstWindow(sharerApp)
      const viewer = await firstWindow(viewerApp)

      await enterWithName(sharer, 'SharerE2E')
      await enterWithName(viewer, 'ViewerE2E')

      await sharer.getByRole('button', { name: /Share screen/ }).click()
      await expect(sharer.getByRole('heading', { name: /O que você quer compartilhar/ })).toBeVisible()

      await viewer.getByLabel('Código de convite').fill('ZZZZZZZZ')
      await viewer.getByRole('button', { name: 'Join', exact: true }).click()
      await expect(viewer.getByRole('alert')).toContainText(/não existe/, { timeout: 30_000 })
    } finally {
      await sharerApp.close()
      await viewerApp.close()
    }
  })

  test('sharer gera convite e viewer assiste (mídia real)', async () => {
    test.skip(!WITH_MEDIA, 'Exige display e captura real: rode com TELAE_E2E_MEDIA=1')
    const sharerApp = await launchApp()
    const viewerApp = await launchApp()
    try {
      const sharer = await firstWindow(sharerApp)
      const viewer = await firstWindow(viewerApp)

      await enterWithName(sharer, 'SharerE2E')
      await enterWithName(viewer, 'ViewerE2E')

      await sharer.getByRole('button', { name: /Share screen/ }).click()
      const firstSource = sharer.getByRole('radio').first()
      await firstSource.click()
      // O ambiente de teste pode não oferecer áudio do sistema na fonte;
      // o fluxo de mídia aqui valida vídeo (áudio tem cobertura unitária + manual).
      await sharer.getByLabel(/Incluir áudio do sistema/).uncheck()
      await sharer.getByRole('button', { name: /Compartilhar e gerar convite/ }).click()
      const invite = sharer.getByLabel(/Código de convite/)
      await expect(invite).toBeVisible({ timeout: 60_000 })
      const code = (await invite.textContent())?.trim() ?? ''
      expect(code).toMatch(/^[A-Z2-9]{8}$/)

      await viewer.getByLabel('Código de convite').fill(code)
      await viewer.getByRole('button', { name: 'Join', exact: true }).click()
      const remoteVideo = viewer.getByLabel('Transmissão do Sharer')
      await expect(remoteVideo).toBeVisible({ timeout: 60_000 })
      await viewer.waitForFunction(
        (selector) => {
          const video = document.querySelector(selector)
          return video instanceof HTMLVideoElement && video.readyState >= 2 && !video.paused
        },
        'video[aria-label="Transmissão do Sharer"]',
        { timeout: 60_000 },
      )

      await viewer.keyboard.press('Escape')
      await expect(viewer.getByRole('heading', { name: /Mostre sua tela/ })).toBeVisible()
    } finally {
      await sharerApp.close()
      await viewerApp.close()
    }
  })
})
