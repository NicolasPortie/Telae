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
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { name: /Compartilhar a tela ficou simples/ })).toBeVisible({ timeout: 30_000 })
}

test.describe('duas instâncias Telae', () => {
  test('janela captura apenas o áudio do aplicativo escolhido', async () => {
    test.skip(!WITH_MEDIA, 'Exige captura real de janela no Windows')
    const app = await launchApp(true)
    try {
      const page = await firstWindow(app)
      await enterWithName(page, 'JanelaE2E')
      await page.getByRole('button', { name: /Escolher tela/ }).click()
      await expect(page.getByRole('heading', { name: /O que você quer compartilhar/ })).toBeVisible()
      await expect(page.getByRole('radiogroup', { name: 'Janelas' })).toBeVisible({ timeout: 15_000 })
      const windowChoices = page.getByRole('radiogroup', { name: 'Janelas' }).getByRole('radio')
      await windowChoices.first().click()
      await page.getByRole('button', { name: 'Compartilhar e gerar convite' }).click()
      await expect(page.getByLabel(/Código de convite/)).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText('O Windows não disponibilizou áudio desta fonte.')).toHaveCount(0)
      await page.getByRole('button', { name: 'Parar transmissão' }).click()
    } finally {
      await app.close()
    }
  })

  test('convite inválido falha com motivo específico', async () => {
    const sharerApp = await launchApp()
    const viewerApp = await launchApp(true)
    try {
      const sharer = await firstWindow(sharerApp)
      const viewer = await firstWindow(viewerApp)

      await enterWithName(sharer, 'SharerE2E')
      await enterWithName(viewer, 'ViewerE2E')

      await sharer.getByRole('button', { name: /Escolher tela/ }).click()
      await expect(sharer.getByRole('heading', { name: /O que você quer compartilhar/ })).toBeVisible()
      const windowSources = await sharer.evaluate(() => window.telae.listCaptureSources())
      const firstWindowSource = windowSources.find((source: { kind: string; id: string }) => source.kind === 'window')
      if (firstWindowSource) {
        await sharer.evaluate((sourceId) => window.telae.selectCaptureSource(sourceId), firstWindowSource.id)
        const processId = await sharer.evaluate((sourceId) => window.telae.resolveWindowAudioProcess(sourceId), firstWindowSource.id)
        expect(processId).toBeGreaterThan(0)
      }

      await viewer.getByLabel('Código de convite').fill('ZZZZZZZZ')
      await viewer.getByRole('button', { name: 'Entrar', exact: true }).click()
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
    const secondViewerApp = await launchApp(true)
    try {
      const sharer = await firstWindow(sharerApp)
      const viewer = await firstWindow(viewerApp)
      const secondViewer = await firstWindow(secondViewerApp)

      await enterWithName(sharer, 'SharerE2E')
      await enterWithName(viewer, 'ViewerE2E')
      await enterWithName(secondViewer, 'Viewer2E2E')

      await sharer.getByRole('button', { name: /Escolher tela/ }).click()
      const firstSource = sharer.getByRole('radio').first()
      await firstSource.click()
      await sharer.getByRole('button', { name: /Compartilhar e gerar convite/ }).click()
      const invite = sharer.getByLabel(/Código de convite/)
      await expect(invite).toBeVisible({ timeout: 60_000 })
      const code = (await invite.textContent())?.trim() ?? ''
      expect(code).toMatch(/^[A-Z2-9]{8}$/)

      await viewer.getByLabel('Código de convite').fill(code)
      await viewer.getByRole('button', { name: 'Entrar', exact: true }).click()
      const remoteVideo = viewer.getByLabel('Transmissão do seu amigo')
      await expect(remoteVideo).toBeVisible({ timeout: 60_000 })
      await viewer.waitForFunction(
        (selector) => {
          const video = document.querySelector(selector)
          return video instanceof HTMLVideoElement && video.readyState >= 2 && !video.paused
        },
        'video[aria-label="Transmissão do seu amigo"]',
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

      const volume = viewer.getByRole('slider', { name: 'Volume da transmissão' })
      await volume.focus()
      await volume.press('Home')
      await volume.press('ArrowRight')
      await expect(volume).toHaveValue('1')
      await expect.poll(() => remoteVideo.evaluate((video) => (video as HTMLVideoElement).volume)).toBe(0.01)
      await viewer.getByRole('button', { name: 'Silenciar' }).click()
      await expect.poll(() => remoteVideo.evaluate((video) => (video as HTMLVideoElement).muted)).toBe(true)
      await expect(viewer.getByRole('button', { name: 'Tela cheia' })).toBeVisible()
      await viewer.getByRole('button', { name: 'Tela cheia' }).click()
      await expect.poll(() => remoteVideo.evaluate((video) => ({
        fullscreen: document.fullscreenElement !== null,
        height: Math.round(video.getBoundingClientRect().height),
        viewport: window.innerHeight,
        fit: getComputedStyle(video).objectFit,
      }))).toEqual(expect.objectContaining({ fullscreen: true, fit: 'cover' }))
      await expect.poll(() => remoteVideo.evaluate((video) => Math.round(video.getBoundingClientRect().height / window.innerHeight))).toBe(1)
      await viewer.keyboard.press('Escape')
      await expect(remoteVideo).toBeVisible()

      await sharer.getByRole('button', { name: 'Trocar fonte' }).click()
      await expect(sharer.getByText('A transmissão e o código continuam ativos durante a troca.')).toBeVisible()
      await expect(sharer.getByRole('button', { name: 'Abrir perfil' })).toBeDisabled()
      await sharer.getByRole('button', { name: /Voltar/ }).click()
      await expect(sharer.getByRole('button', { name: 'Parar transmissão' })).toBeVisible()
      await expect(sharer.getByLabel(/Código de convite/)).toContainText(code)

      await sharer.getByRole('button', { name: 'Trocar fonte' }).click()
      await sharer.getByRole('button', { name: 'Trocar fonte agora' }).click()
      await expect(sharer.getByLabel(/Código de convite/)).toContainText(code)
      await expect(remoteVideo).toBeVisible()

      await secondViewer.getByLabel('Código de convite').fill(code)
      await secondViewer.getByRole('button', { name: 'Entrar', exact: true }).click()
      const secondVideo = secondViewer.getByLabel('Transmissão do seu amigo')
      await expect(secondVideo).toBeVisible({ timeout: 60_000 })
      await expect(sharer.getByText('2 pessoas conectadas')).toBeVisible()

      await viewer.getByRole('button', { name: 'Sair' }).click()
      await expect(viewer.getByRole('heading', { name: /Compartilhar a tela ficou simples/ })).toBeVisible()
      await expect(secondVideo).toBeVisible()
      await sharer.getByRole('button', { name: 'Parar transmissão' }).click()
      await expect(sharer.getByRole('heading', { name: /Compartilhar a tela ficou simples/ })).toBeVisible()
      await expect(secondViewer.getByRole('heading', { name: 'Transmissão terminada' })).toBeVisible()
    } finally {
      await sharerApp.close()
      await viewerApp.close()
      await secondViewerApp.close()
    }
  })
})
