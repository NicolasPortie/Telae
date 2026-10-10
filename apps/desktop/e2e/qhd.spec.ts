import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { befriend, watchFriend } from './friends.ts'

// Real Windows display capture, product signaling, encoder and receiver. No fake media.
test('QHD: captura real, 30/60 fps e troca de perfil sem desconectar', async () => {
  test.skip(process.env.TELAE_E2E_MEDIA !== '1', 'Exige Windows com display e TELAE_E2E_MEDIA=1')
  test.setTimeout(180_000)
  const directories: string[] = []
  const apps: ElectronApplication[] = []
  const evidence: unknown[] = []
  async function launch() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telae-qhd-'))
    directories.push(directory)
    const app = await electron.launch({
      args: [path.resolve(import.meta.dirname, '..'), '--no-sandbox', '--mute-audio', `--user-data-dir=${directory}`],
      env: { ...process.env, TELAE_SIGNALING_URL: process.env.TELAE_E2E_SIGNALING_URL || 'http://localhost:5015' },
    })
    apps.push(app)
    return app
  }
  async function enter(page: Page, name: string) {
    await page.getByLabel('Seu nome').fill(name)
    await page.getByRole('button', { name: 'Continuar' }).click()
    await expect(page.getByRole('heading', { name: /Compartilhar a tela ficou simples/ })).toBeVisible()
    await page.evaluate(() => {
      const target = window as unknown as { qhdPeers: RTCPeerConnection[] }
      target.qhdPeers = []
      const NativePeer = window.RTCPeerConnection
      window.RTCPeerConnection = class extends NativePeer {
        constructor(config?: RTCConfiguration) {
          super(config)
          target.qhdPeers.push(this)
        }
      }
    })
  }
  async function sample(page: Page) {
    return page.evaluate(async () => {
      const peers = (window as unknown as { qhdPeers: RTCPeerConnection[] }).qhdPeers
      return Promise.all(peers.map(async peer => ({
        state: peer.connectionState,
        senders: peer.getSenders().filter(sender => sender.track?.kind === 'video').map(sender => ({
          settings: sender.track!.getSettings(), parameters: sender.getParameters(),
        })),
        stats: Array.from((await peer.getStats()).values()).filter(report =>
          ['outbound-rtp', 'inbound-rtp', 'remote-inbound-rtp', 'codec', 'candidate-pair', 'media-source'].includes(report.type)),
      })))
    })
  }
  try {
    const senderApp = await launch()
    const receiverApp = await launch()
    const sender = await senderApp.firstWindow()
    const receiver = await receiverApp.firstWindow()
    const enabledFeatures = await senderApp.evaluate(({ app }) => app.commandLine.getSwitchValue('enable-features').split(','))
    expect(enabledFeatures).toEqual(expect.arrayContaining(['ZeroCopyDesktopCapture', 'WebRtcAllowWgcUsingTexture']))
    evidence.push({ captureFeatures: enabledFeatures })
    await enter(sender, 'QhdSender')
    await enter(receiver, 'QhdReceiver')
    await befriend({ page: sender, name: 'QhdSender' }, { page: receiver, name: 'QhdReceiver' })
    evidence.push({ displays: await senderApp.evaluate(({ screen }) => screen.getAllDisplays().map(display => ({
      size: display.size, scaleFactor: display.scaleFactor, displayFrequency: display.displayFrequency,
    }))) })
    evidence.push({ source: await senderApp.evaluate(async ({ BrowserWindow }) => {
      const source = new BrowserWindow({ title: 'Telae QHD Test Pattern', width: 2560, height: 1440,
        frame: false, webPreferences: { backgroundThrottling: false } })
      // Windows limits normal windows to the work area (excluding the taskbar).
      source.setFullScreen(true)
      await source.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><title>Telae QHD Test Pattern</title>
        <style>body{margin:0;background:#111}canvas{display:block;width:100vw;height:100vh}</style>
        <canvas width="2560" height="1440"></canvas><script>
        const c=document.querySelector('canvas'),x=c.getContext('2d');
        window.patternFrames=0;
        function draw(t){window.patternFrames++;x.fillStyle='#16324f';x.fillRect(0,0,2560,1440);
        x.fillStyle='#f7b538';x.fillRect((t/4)%2400,100,160,1200);
        x.fillStyle='white';x.font='80px sans-serif';x.fillText('2560 × 1440 · '+Math.round(t),100,100);
        for(let i=0;i<1440;i+=40){x.fillRect(0,i,2560,1)}requestAnimationFrame(draw)}requestAnimationFrame(draw);
        </script>`))
      return { bounds: source.getContentBounds(), fullscreen: source.isFullScreen() }
    }) })
    await sender.getByRole('button', { name: /Escolher tela/ }).click()
    await sender.getByRole('radio', { name: '1080p60', exact: true }).click()
    // DWM can trim a fullscreen window by two pixels when focus changes. Capture
    // the display for exact QHD dimensions; isolated window/audio capture has its own E2E.
    const source = sender.getByRole('radiogroup', { name: 'Telas', exact: true }).getByRole('radio').first()
    await expect(source).toBeVisible({ timeout: 15_000 })
    await source.click()
    await sender.getByRole('button', { name: 'Começar a compartilhar' }).click()
    await expect(sender.getByRole('heading', { name: /Você está compartilhando/ })).toBeVisible({ timeout: 60_000 })
    await watchFriend(receiver, 'QhdSender')
    const video = receiver.getByLabel('Transmissão do seu amigo')
    await expect(video).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames),
      { timeout: 60_000 }).toBeGreaterThan(0)
    const quality = sender.getByRole('combobox', { name: 'Qualidade da transmissão' })
    // Healthy paths preserve resolution in both detail and motion modes.
    for (const profile of ['1080p60', '1440p30', '1440p60', '1080p60', '1080p30', '1440p30'] as const) {
      if (await quality.inputValue() !== profile) await quality.selectOption(profile)
      await expect(quality).toHaveValue(profile)
      const width = profile.startsWith('1080p') ? 1920 : 2560
      const height = profile.startsWith('1080p') ? 1080 : 1440
      if (profile === '1080p60') await senderApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
      // Keep the animated source on the captured display. Otherwise the benchmark
      // captures the receiver and its own preview recursively instead of the pattern.
      await senderApp.evaluate(({ BrowserWindow }) => {
        const pattern = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Telae QHD Test Pattern')!
        pattern.show()
        pattern.focus()
      })
      evidence.push({ profile, initialSender: await sample(sender), initialReceiver: await sample(receiver) })
      await expect.poll(() => video.evaluate(element => ({
        width: (element as HTMLVideoElement).videoWidth, height: (element as HTMLVideoElement).videoHeight,
      })), { timeout: 30_000 }).toEqual({ width, height })
      const start = await video.evaluate(element => ({ time: performance.now(), frames: (element as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames }))
      const sourceStart = await senderApp.evaluate(async ({ BrowserWindow }) => {
        const pattern = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Telae QHD Test Pattern')!
        return pattern.webContents.executeJavaScript('({ time: performance.now(), frames: window.patternFrames })') as Promise<{ time: number; frames: number }>
      })
      // Bounded measurement interval, with raw encoder/decoder telemetry preserved.
      for (let i = 0; i < 3; i++) {
        await receiver.waitForTimeout(5000)
        evidence.push({ profile, sender: await sample(sender), receiver: await sample(receiver) })
      }
      const end = await video.evaluate(element => ({ time: performance.now(), frames: (element as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames }))
      const sourceEnd = await senderApp.evaluate(async ({ BrowserWindow }) => {
        const pattern = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Telae QHD Test Pattern')!
        return pattern.webContents.executeJavaScript('({ time: performance.now(), frames: window.patternFrames })') as Promise<{ time: number; frames: number }>
      })
      evidence.push({ profile, sourceRenderedFps: (sourceEnd.frames - sourceStart.frames) * 1000 / (sourceEnd.time - sourceStart.time) })
      evidence.push({ profile, presentedFps: (end.frames - start.frames) * 1000 / (end.time - start.time) })
      if (profile === '1080p60') {
        expect((end.frames - start.frames) * 1000 / (end.time - start.time)).toBeGreaterThan(45)
        await senderApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
      }
      expect(end.frames).toBeGreaterThan(start.frames)
      await expect(sender.getByRole('heading', { name: /Você está compartilhando/ })).toBeVisible()
      expect((await sample(sender))[0].state).toBe('connected')
      const settings = (await sample(sender))[0].senders[0].settings
      expect(settings.width).toBe(width)
      expect(settings.height).toBe(height)
      expect((await sample(sender))[0].senders[0].parameters.encodings[0].maxFramerate).toBe(profile.endsWith('60') ? 60 : 30)
    }
    await sender.getByRole('button', { name: 'Parar transmissão' }).click()
    await expect(receiver.getByRole('heading', { name: 'Transmissão terminada' })).toBeVisible()
  } finally {
    const evidencePath = test.info().outputPath('qhd-telemetry.json')
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2))
    await test.info().attach('QHD telemetry', { path: evidencePath, contentType: 'application/json' })
    for (const app of apps.reverse()) await app.close()
    for (const directory of directories) {
      if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('telae-qhd-')) {
        await fs.rm(directory, { recursive: true, force: true })
      }
    }
  }
})
