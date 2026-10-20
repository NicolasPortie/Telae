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
      args: [path.resolve(import.meta.dirname, '..'), '--no-sandbox', '--lang=pt-BR', '--mute-audio', `--user-data-dir=${directory}`],
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
    // Keep the player and controls off the captured monitor on multi-display PCs.
    for (const app of apps) await app.evaluate(({ BrowserWindow, screen }) => {
      const other = screen.getAllDisplays().find(display => display.id !== screen.getPrimaryDisplay().id)
      if (other) BrowserWindow.getAllWindows()[0].setBounds({ x: other.workArea.x + 30, y: other.workArea.y + 30, width: 1220, height: 790 })
    })
    evidence.push({ displays: await senderApp.evaluate(({ screen }) => screen.getAllDisplays().map(display => ({
      size: display.size, scaleFactor: display.scaleFactor, displayFrequency: display.displayFrequency,
    }))) })
    const testSource = await senderApp.evaluate(async ({ BrowserWindow, screen, desktopCapturer }) => {
      const primary = screen.getPrimaryDisplay()
      const source = new BrowserWindow({ title: 'Telae QHD Test Pattern', width: 2560, height: 1440,
        x: primary.bounds.x, y: primary.bounds.y,
        frame: false, webPreferences: { backgroundThrottling: false } })
      // Windows limits normal windows to the work area (excluding the taskbar).
      source.setFullScreen(true)
      await source.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Telae QHD Test Pattern</title>
        <style>body{margin:0;background:#111}canvas{display:block;width:100vw;height:100vh}</style>
        <canvas width="2560" height="1440"></canvas><script>
        const c=document.querySelector('canvas'),x=c.getContext('2d');
        window.patternFrames=0;
        function draw(t){window.patternFrames++;x.fillStyle='#16324f';x.fillRect(0,0,2560,1440);
        x.fillStyle='#f7b538';x.fillRect((t/4)%2400,100,160,1200);
        x.fillStyle='white';x.font='80px sans-serif';x.fillText('2560 × 1440 · '+Math.round(t),100,100);
        for(let i=0;i<1440;i+=40){x.fillRect(0,i,2560,1)}
        x.font='32px sans-serif';x.fillText('Nitidez · 1080p e 1440p · texto e linhas finas',320,300);
        x.font='20px sans-serif';x.fillText('Leitura: ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789',320,350);
        x.font='16px sans-serif';x.fillText('Detalhes pequenos devem continuar legíveis em Full HD.',320,385);
        x.fillStyle='#00ffff';x.fillRect(2464,1344,96,96);
        x.fillStyle='#ff0000';x.fillRect(1080,650,32,32);
        requestAnimationFrame(draw)}requestAnimationFrame(draw);
        </script>`))
      const display = screen.getDisplayMatching(source.getBounds())
      const captures = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      const capture = captures.find(item => item.display_id === String(display.id))
      if (!capture) throw new Error('Monitor da fonte de teste ausente')
      return { bounds: source.getContentBounds(), fullscreen: source.isFullScreen(), captureName: capture.name }
    })
    evidence.push({ source: testSource })
    await sender.getByRole('button', { name: /Escolher tela/ }).click()
    await sender.getByRole('radio', { name: '1080p60', exact: true }).click()
    // DWM can trim a fullscreen window by two pixels when focus changes. Capture
    // the display for exact QHD dimensions; isolated window/audio capture has its own E2E.
    const source = sender.getByRole('radiogroup', { name: 'Telas', exact: true }).getByRole('radio', { name: testSource.captureName, exact: true })
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
      await senderApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Telae QHD Test Pattern')!.setAlwaysOnTop(false))
      if (await quality.inputValue() !== profile) await quality.selectOption(profile)
      await expect(quality).toHaveValue(profile)
      const width = profile.startsWith('1080p') ? 1920 : 2560
      const height = profile.startsWith('1080p') ? 1080 : 1440
      if (profile === '1080p60') await senderApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
      // Keep the animated source on the captured display. Otherwise the benchmark
      // captures the receiver and its own preview recursively instead of the pattern.
      await senderApp.evaluate(({ BrowserWindow }) => {
        const pattern = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Telae QHD Test Pattern')!
        pattern.setAlwaysOnTop(true)
        pattern.show()
        pattern.focus()
      })
      evidence.push({ profile, initialSender: await sample(sender), initialReceiver: await sample(receiver) })
      await expect.poll(() => video.evaluate(element => ({
        width: (element as HTMLVideoElement).videoWidth, height: (element as HTMLVideoElement).videoHeight,
      })), { timeout: 30_000 }).toEqual({ width, height })
      // Detect a wrong monitor or recursive capture before collecting evidence.
      await expect.poll(() => video.evaluate(element => {
        const video = element as HTMLVideoElement
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')!
        context.drawImage(video, video.videoWidth * 1096 / 2560, video.videoHeight * 666 / 1440, 1, 1, 0, 0, 1, 1)
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
        return red > 200 && green < 50 && blue < 50
      })).toBe(true)
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
      // Save decoded pixels at the actual resolution, independent of player size.
      const decodedPng = await video.evaluate(element => {
        const video = element as HTMLVideoElement
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth; canvas.height = video.videoHeight
        canvas.getContext('2d')!.drawImage(video, 0, 0)
        return canvas.toDataURL('image/png').split(',')[1]
      })
      const imagePath = test.info().outputPath(`decoded-${profile}.png`)
      await fs.writeFile(imagePath, Buffer.from(decodedPng, 'base64'))
      await test.info().attach(`Decoded ${profile}`, { path: imagePath, contentType: 'image/png' })
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
    await senderApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Telae QHD Test Pattern')!.hide())
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
