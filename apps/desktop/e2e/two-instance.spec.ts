import { expect, test, type ElectronApplication, type Page, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const WITH_MEDIA = process.env.TELAE_E2E_MEDIA === '1'
const WITH_RELAY = process.env.TELAE_E2E_RELAY === '1'

async function expectRenderedFrames(page: Page) {
  const video = page.getByLabel('Transmissão do seu amigo')
  await expect(video).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => video.evaluate((element) => {
    const media = element as HTMLVideoElement
    return media.getVideoPlaybackQuality().totalVideoFrames
  }), { timeout: 60_000 }).toBeGreaterThan(0)
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
  return video
}

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
      await windowChoices.first().focus()
      await windowChoices.first().press('End')
      await expect(windowChoices.last()).toBeFocused()
      await expect(windowChoices.last()).toHaveAttribute('aria-checked', 'true')
      await windowChoices.last().press('ArrowRight')
      await expect(windowChoices.first()).toBeFocused()
      await expect(windowChoices.first()).toHaveAttribute('aria-checked', 'true')
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
      if (WITH_MEDIA && firstWindowSource) {
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
      await expectRenderedFrames(viewer)
      await expect(viewer.locator('header').getByText(/Ao vivo ·|Assistindo/)).toBeVisible()
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

      const controls = viewer.getByRole('group', { name: 'Controles da transmissão' })
      await viewer.mouse.move(0, 0)
      await expect(controls).toHaveCSS('opacity', '0', { timeout: 6000 })
      await remoteVideo.hover()
      await expect(controls).toHaveCSS('opacity', '1')
      await expect(controls).toHaveCSS('opacity', '0', { timeout: 6000 })
      await remoteVideo.hover({ position: { x: 50, y: 50 } })
      await expect(controls).toHaveCSS('opacity', '1')

      // A wide desktop must use the viewer's available area without cropping the stream.
      for (const bounds of [{ width: 1600, height: 900 }, { width: 900, height: 1100 }]) {
        await viewerApp.evaluate(({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0].setBounds(size)
        }, bounds)
        await expect.poll(() => remoteVideo.evaluate((video) => {
          const rect = video.getBoundingClientRect()
          const header = document.querySelector('header')!.getBoundingClientRect()
          return {
            fit: getComputedStyle(video).objectFit,
            fullWidth: Math.abs(rect.width - (window.innerWidth - 26)) < 2,
            fullHeight: Math.abs(rect.height - (window.innerHeight - header.height - 26)) < 2,
            noOverflow: document.documentElement.scrollHeight <= window.innerHeight,
          }
        })).toEqual({ fit: 'contain', fullWidth: true, fullHeight: true, noOverflow: true })
      }
      await viewer.getByRole('button', { name: 'Preencher', exact: true }).click()
      await expect.poll(() => remoteVideo.evaluate((video) => getComputedStyle(video).objectFit)).toBe('cover')
      await viewer.getByRole('button', { name: 'Ajustar', exact: true }).click()
      await expect.poll(() => remoteVideo.evaluate((video) => getComputedStyle(video).objectFit)).toBe('contain')

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
      }))).toEqual(expect.objectContaining({ fullscreen: true, fit: 'contain' }))
      await expect.poll(() => remoteVideo.evaluate((video) => Math.round(video.getBoundingClientRect().height / window.innerHeight))).toBe(1)
      await expect.poll(() => remoteVideo.evaluate((video) => Math.abs(video.getBoundingClientRect().width - window.innerWidth) < 2)).toBe(true)
      await expect(viewer.getByRole('button', { name: 'Sair da tela cheia' })).toBeVisible()
      await remoteVideo.hover({ position: { x: 50, y: 50 } })
      await expect(controls).toHaveCSS('opacity', '0', { timeout: 6000 })
      await expect(remoteVideo).toHaveCSS('cursor', 'none')
      await remoteVideo.hover({ position: { x: 80, y: 80 } })
      await expect(controls).toHaveCSS('opacity', '1')
      await expect(remoteVideo).not.toHaveCSS('cursor', 'none')
      await volume.focus()
      await volume.press('ArrowRight')
      await viewer.waitForTimeout(3300)
      await expect(controls).toHaveCSS('opacity', '1')
      await expect(remoteVideo).not.toHaveCSS('cursor', 'none')
      await viewer.keyboard.press('Escape')
      await expect(remoteVideo).toBeVisible()
      await expect.poll(() => viewer.evaluate(() => document.fullscreenElement === null)).toBe(true)
      await viewer.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
      await remoteVideo.hover({ position: { x: 50, y: 50 } })
      await expect(controls).toHaveCSS('opacity', '0', { timeout: 6000 })
      await expect(remoteVideo).not.toHaveCSS('cursor', 'none')

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
      await expectRenderedFrames(secondViewer)

      await sharer.evaluate(() => window.scrollTo(0, 0))
      await sharer.screenshot({ path: test.info().outputPath('sharer-ui.png'), fullPage: true, mask: [sharer.getByLabel(/Código de convite/), sharer.locator('video')] })
      await expect(sharer.getByText('2 pessoas conectadas')).toBeVisible()

      const liveQuality = sharer.getByRole('combobox', { name: 'Qualidade da transmissão' })
      await liveQuality.selectOption('720p60')
      await expect(liveQuality).toHaveValue('720p60')
      const contentMode = sharer.getByRole('combobox', { name: 'Conteúdo da transmissão' })
      await contentMode.selectOption('motion')
      await expect(contentMode).toHaveValue('motion')
      const upload = sharer.getByRole('spinbutton', { name: 'Limite de vídeo (Mbps)' })
      await upload.fill('12')
      await upload.press('Tab')
      await expect(upload).toHaveValue('12')
      await expect(sharer.getByLabel(/Código de convite/)).toContainText(code)
      await sharer.getByRole('button', { name: 'Silenciar transmissão', exact: true }).click()
      await expect(sharer.getByRole('button', { name: 'Ativar áudio da transmissão', exact: true })).toBeVisible()
      await sharer.getByRole('button', { name: 'Ativar áudio da transmissão', exact: true }).click()
      await expect(sharer.getByRole('button', { name: 'Silenciar transmissão', exact: true })).toBeVisible()
      await expectRenderedFrames(secondViewer)

      await sharer.getByRole('button', { name: 'Remover ViewerE2E', exact: true }).click()
      await expect(viewer.getByRole('heading', { name: 'Transmissão terminada' })).toBeVisible()
      await expect(viewer.getByRole('button', { name: 'Exportar diagnóstico (JSON)', exact: true })).toBeVisible()
      await expect(sharer.getByRole('button', { name: 'Remover ViewerE2E', exact: true })).toHaveCount(0)
      await expect(secondVideo).toBeVisible()
      await sharer.getByRole('button', { name: 'Parar transmissão' }).click()
      await expect(sharer.getByRole('heading', { name: /Compartilhar a tela ficou simples/ })).toBeVisible()
      await expect(secondViewer.getByRole('heading', { name: 'Transmissão terminada' })).toBeVisible()
      await expect(sharer.getByRole('button', { name: 'Exportar diagnóstico da última transmissão', exact: true })).toBeVisible()
    } finally {
      await sharerApp.close()
      await viewerApp.close()
      await secondViewerApp.close()
    }
  })

  test('relay obrigatório recebe frames reais via TURN', async () => {
    test.skip(!WITH_RELAY, 'Ative TELAE_E2E_MEDIA=1 e TELAE_E2E_RELAY=1 com TURN funcional')
    const sharerApp = await launchApp()
    const viewerApp = await launchApp(true)
    try {
      const sharer = await firstWindow(sharerApp)
      const viewer = await firstWindow(viewerApp)
      for (const page of [sharer, viewer]) {
        const environment = await page.evaluate(() => window.telae.getEnvironment())
        expect(environment).toHaveProperty('forceRelay', true)
      }
      await enterWithName(sharer, 'RelaySender')
      await enterWithName(viewer, 'RelayReceiver')
      await sharer.getByRole('button', { name: /Escolher tela/ }).click()
      await sharer.getByRole('radio').first().click()
      await sharer.getByRole('button', { name: /Compartilhar e gerar convite/ }).click()
      const invite = sharer.getByLabel(/Código de convite/)
      await expect(invite).toBeVisible({ timeout: 60_000 })
      const code = (await invite.textContent())?.trim() ?? ''
      expect(code).toMatch(/^[A-Z2-9]{8}$/)
      await viewer.getByLabel('Código de convite').fill(code)
      await viewer.getByRole('button', { name: 'Entrar', exact: true }).click()
      await expectRenderedFrames(viewer)
      await sharer.getByText('Detalhes da conexão', { exact: true }).click()
      // The selected candidate pair must report relay, not just a configured TURN URL.
      await expect(sharer.locator('dl > div').filter({ has: sharer.locator('dt', { hasText: /^Conexão$/ }) }).locator('dd')).toHaveText('Via servidor', { timeout: 30_000 })
      await viewer.getByText('Detalhes da conexão', { exact: true }).click()
      await expect(viewer.locator('dl > div').filter({ has: viewer.locator('dt', { hasText: /^Conexão$/ }) }).locator('dd')).toHaveText('Via servidor', { timeout: 30_000 })
      await sharer.getByRole('button', { name: 'Parar transmissão' }).click()
    } finally {
      await sharerApp.close()
      await viewerApp.close()
    }
  })
})
