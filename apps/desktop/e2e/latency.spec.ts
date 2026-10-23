import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { befriend, watchFriend } from './friends.ts'
import { diagnosticSnapshot } from './diagnostics.ts'
import { signUp } from './auth.ts'

// Local, real window/process-loopback capture. The source encodes wall time in
// large black/white cells; a simultaneous flash and quiet tone measure A/V offset.
// This is not an internet benchmark or a measurement of the physical speakers.
test('latência: movimento com áudio não acumula atraso após uma pausa do emissor', async () => {
  test.skip(process.env.TELAE_E2E_MEDIA !== '1', 'Exige Windows com display e saída de áudio')
  test.setTimeout(120_000)
  const apps: ElectronApplication[] = []
  const directories: string[] = []
  const evidence: unknown[] = []
  async function launch(name: string, muted: boolean) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telae-latency-'))
    directories.push(directory)
    const app = await electron.launch({
      args: [path.resolve(import.meta.dirname, '..'), '--no-sandbox', '--lang=pt-BR', `--user-data-dir=${directory}`, ...(muted ? ['--mute-audio'] : [])],
      env: { ...process.env, TELAE_SIGNALING_URL: process.env.TELAE_E2E_SIGNALING_URL || 'http://localhost:5015' },
    })
    apps.push(app)
    const page = await app.firstWindow()
    await signUp(page, name)
    return { app, page, name }
  }
  async function measure(page: Page) {
    return page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('video[aria-label="Transmissão do seu amigo"]')!
      if (!video?.srcObject) throw new Error('Playback ausente')
      const context = new AudioContext({ latencyHint: 'interactive' })
      const source = context.createMediaStreamSource(video.srcObject as MediaStream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const waveform = new Float32Array(analyser.fftSize)
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 2
      const pixels = canvas.getContext('2d', { willReadFrequently: true })!
      const data = { latencyMs: [] as number[], audioAt: [] as number[], videoAt: [] as number[] }
      let lastAudio = false
      let lastVideo = false
      let lastSampleAt = 0
      let callback = 0
      let stopped = false
      const draw = () => {
        if (stopped) return
        const now = Date.now()
        pixels.drawImage(video, 0, video.videoHeight * 40 / 720, video.videoWidth, 1, 0, 0, 16, 1)
        pixels.drawImage(video, 0, video.videoHeight * 680 / 720, video.videoWidth, 1, 0, 1, 16, 1)
        const rgba = pixels.getImageData(0, 0, 16, 2).data
        let encoded = 0
        for (let bit = 0; bit < 16; bit++) encoded |= (rgba[bit * 4] > 128 ? 1 : 0) << bit
        if (now - lastSampleAt >= 100) {
          data.latencyMs.push((((Math.floor(now / 10) & 65535) - encoded) + 65536) % 65536 * 10)
          lastSampleAt = now
        }
        const flash = rgba[16 * 4 + 4] > 128
        if (flash && !lastVideo) data.videoAt.push(now)
        lastVideo = flash
        callback = video.requestVideoFrameCallback(draw)
      }
      callback = video.requestVideoFrameCallback(draw)
      const timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(waveform)
        const sound = waveform.some(value => Math.abs(value) > 0.001)
        if (sound && !lastAudio) data.audioAt.push(Date.now())
        lastAudio = sound
      }, 5)
      const target = window as unknown as { latencyMeasurement: { stop(): Promise<typeof data> } }
      target.latencyMeasurement = { async stop() {
        stopped = true
        clearInterval(timer)
        video.cancelVideoFrameCallback(callback)
        source.disconnect()
        await context.close()
        return data
      } }
    })
  }
  try {
    const sender = await launch('LatencySender', false)
    const receiver = await launch('LatencyReceiver', true)
    await befriend(sender, receiver)
    await sender.app.evaluate(async ({ BrowserWindow }) => {
      const pattern = new BrowserWindow({ title: 'Telae Latency Pattern', width: 1280, height: 720,
        useContentSize: true, frame: false, show: false, webPreferences: { backgroundThrottling: false } })
      await pattern.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><title>Telae Latency Pattern</title>
        <style>body{margin:0;background:black}canvas{display:block;width:100vw;height:100vh}</style>
        <canvas width="1280" height="720"></canvas><script>
        const c=document.querySelector('canvas'),x=c.getContext('2d');
        const a=new AudioContext({latencyHint:'interactive'}),o=a.createOscillator(),g=a.createGain();
        o.frequency.value=500;g.gain.value=0;o.connect(g).connect(a.destination);o.start();a.resume();
        let pulse=0;
        setInterval(()=>{const next=Math.ceil((Date.now()+250)/2000)*2000;if(next===pulse)return;pulse=next;
          const at=a.currentTime+(next-Date.now())/1000;g.gain.setValueAtTime(0.008,at);g.gain.setValueAtTime(0,at+0.08)},100);
        window.patternFrames=0;function draw(){window.patternFrames++;const now=Date.now(),stamp=Math.floor(now/10)&65535;
          x.fillStyle='#16324f';x.fillRect(0,80,1280,560);
          for(let i=0;i<24;i++){x.fillStyle='hsl('+((now/20+i*15)%360)+' 70% 50%)';x.fillRect((now/5+i*53)%1280,100+i*22,130,20)}
          for(let bit=0;bit<16;bit++){x.fillStyle=(stamp&(1<<bit))?'white':'black';x.fillRect(bit*80,0,80,80)}
          x.fillStyle=now%2000<80?'white':'black';x.fillRect(0,640,1280,80);requestAnimationFrame(draw)}draw();
        </script>`))
      pattern.showInactive()
    })
    await sender.page.getByRole('button', { name: /Escolher tela/ }).click()
    await sender.page.getByRole('radio', { name: '720p', exact: true }).click()
    const source = sender.page.getByRole('radiogroup', { name: 'Janelas', exact: true }).getByRole('radio', { name: /Telae Latency Pattern/ })
    await expect(source).toBeVisible({ timeout: 15_000 })
    await source.click()
    await sender.page.getByRole('button', { name: 'Começar a transmitir' }).click()
    await expect(sender.page.getByRole('heading', { name: /Você está transmitindo/ })).toBeVisible({ timeout: 30_000 })
    await watchFriend(receiver.page, sender.name)
    const video = receiver.page.getByLabel('Transmissão do seu amigo')
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames), { timeout: 30_000 }).toBeGreaterThan(10)
    await sender.app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      const pattern = windows.find(window => window.getTitle() === 'Telae Latency Pattern')!
      pattern.setAlwaysOnTop(true)
      pattern.showInactive()
    })
    await receiver.page.waitForTimeout(5000)
    await measure(receiver.page)
    for (let sample = 0; sample < 6; sample++) {
      if (sample === 2) {
        await sender.app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().find(window => window.getTitle() !== 'Telae Latency Pattern')!.minimize())
        // The AudioWorklet keeps running while renderer IPC delivery pauses.
        await sender.page.evaluate(() => { const until = performance.now() + 180; while (performance.now() < until) { /* delivery stall */ } })
      }
      await receiver.page.waitForTimeout(5000)
      const pattern = await sender.app.evaluate(async ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Telae Latency Pattern')!.webContents.executeJavaScript(
          '({frames:window.patternFrames,visibility:document.visibilityState})'))
      const captureVideo = await sender.page.evaluate(() => [...document.querySelectorAll('video')].map(video => ({
        hidden: video.style.opacity, paused: video.paused, time: video.currentTime, frames: video.getVideoPlaybackQuality(),
        settings: (video.srcObject as MediaStream | null)?.getVideoTracks()[0]?.getSettings(),
      })))
      evidence.push({ pattern, captureVideo, sender: await diagnosticSnapshot(sender.page), receiver: await diagnosticSnapshot(receiver.page) })
    }
    const measurements = await receiver.page.evaluate(() =>
      (window as unknown as { latencyMeasurement: { stop(): Promise<{ latencyMs: number[]; audioAt: number[]; videoAt: number[] }> } }).latencyMeasurement.stop())
    const offsets = measurements.audioAt.map(audio => {
      const video = measurements.videoAt.reduce((best, at) => Math.abs(audio - at) < Math.abs(audio - best) ? at : best, Infinity)
      return audio - video
    }).filter(offset => Number.isFinite(offset) && Math.abs(offset) < 1000)
    const sorted = [...measurements.latencyMs].sort((a, b) => a - b)
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    const summary = { p95VideoMs: sorted[Math.floor(sorted.length * 0.95)],
      medianAvOffsetMs: median(offsets), avOffsetStartMs: median(offsets.slice(0, 4)), avOffsetEndMs: median(offsets.slice(-4)),
      audioPulses: measurements.audioAt.length, videoPulses: measurements.videoAt.length }
    evidence.push({ measurements, offsets, summary })
    expect(measurements.latencyMs.length).toBeGreaterThan(100)
    expect(offsets.length).toBeGreaterThan(8)
    expect(summary.p95VideoMs).toBeLessThan(300)
    expect(Math.abs(summary.medianAvOffsetMs)).toBeLessThan(150)
    expect(Math.abs(summary.avOffsetEndMs - summary.avOffsetStartMs)).toBeLessThan(100)
    await sender.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Telae Latency Pattern')!.close()
      BrowserWindow.getAllWindows()[0].restore()
    })
  } finally {
    const evidencePath = test.info().outputPath('latency-telemetry.json')
    await fs.mkdir(path.dirname(evidencePath), { recursive: true })
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2))
    await test.info().attach('Latency telemetry', { path: evidencePath, contentType: 'application/json' })
    for (const app of apps.reverse()) await app.close()
    for (const directory of directories) {
      if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('telae-latency-')) {
        await fs.rm(directory, { recursive: true, force: true })
      }
    }
  }
})
