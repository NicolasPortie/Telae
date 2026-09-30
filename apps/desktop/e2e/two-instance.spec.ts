import { expect, test, type ElectronApplication, type Page, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const WITH_MEDIA = process.env.TELAE_E2E_MEDIA === '1'

async function launchApp(muteAudioOutput = false): Promise<ElectronApplication> {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telae-e2e-'))
  const signalingUrl = process.env.TELAE_E2E_SIGNALING_URL?.trim()
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  ) as Record<string, string>
  const args = [APP_DIR, '--no-sandbox', `--user-data-dir=${userDataDir}`]
  if (muteAudioOutput) args.push('--mute-audio')
  const app = await electron.launch({
    args,
    env: signalingUrl
      ? { ...env, TELAE_SIGNALING_URL: signalingUrl }
      : env,
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
    const viewerApp = await launchApp(true)
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
    const viewerApp = await launchApp(true)
    try {
      const sharer = await firstWindow(sharerApp)
      const viewer = await firstWindow(viewerApp)

      await enterWithName(sharer, 'SharerE2E')
      await enterWithName(viewer, 'ViewerE2E')

      await sharer.getByRole('button', { name: /Share screen/ }).click()
      const firstSource = sharer.getByRole('radio').first()
      await firstSource.click()
      await sharer.getByLabel(/Incluir áudio do sistema/).check()
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
      await expect.poll(async () => remoteVideo.evaluate((video) => {
        const stream = (video as HTMLVideoElement).srcObject
        return stream instanceof MediaStream ? stream.getAudioTracks().length : 0
      }), { timeout: 60_000 }).toBeGreaterThan(0)
      await expect.poll(async () => remoteVideo.evaluate((video) => {
        const stream = (video as HTMLVideoElement).srcObject
        const track = stream instanceof MediaStream ? stream.getAudioTracks()[0] : undefined
        return track ? { readyState: track.readyState, muted: track.muted } : null
      }), { timeout: 30_000 }).toEqual({ readyState: 'live', muted: false })

      await viewer.keyboard.press('Escape')
      await expect(viewer.getByRole('heading', { name: /Mostre sua tela/ })).toBeVisible()
    } finally {
      await sharerApp.close()
      await viewerApp.close()
    }
  })
})
