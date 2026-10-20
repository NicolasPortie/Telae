import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { diagnosticSnapshot } from './diagnostics.ts'
import { befriend, watchFriend } from './friends.ts'
import { signUp } from './auth.ts'

const requestedViewers = process.env.TELAE_E2E_VIEWERS
const viewerCount = Number(requestedViewers)
const soakSeconds = Number(process.env.TELAE_E2E_SOAK_SECONDS ?? '60')
if (requestedViewers !== undefined && !['3', '6', '12'].includes(requestedViewers)) {
  throw new Error('TELAE_E2E_VIEWERS deve ser 3, 6 ou 12; omita para não executar carga.')
}
if (requestedViewers !== undefined && (!Number.isInteger(soakSeconds) || soakSeconds < 60)) {
  throw new Error('TELAE_E2E_SOAK_SECONDS deve ser inteiro >= 60 (3600 para uma hora).')
}

async function frameSnapshot(page: Page) {
  return page.getByLabel('Transmissão do seu amigo').evaluate(element => {
    const video = element as HTMLVideoElement
    const quality = video.getVideoPlaybackQuality()
    return {
      rendererTimeMs: performance.now(),
      totalVideoFrames: quality.totalVideoFrames,
      droppedVideoFrames: quality.droppedVideoFrames,
      width: video.videoWidth, height: video.videoHeight,
      readyState: video.readyState, paused: video.paused,
    }
  })
}

async function memorySnapshot(app: ElectronApplication) {
  return app.evaluate(({ app }) => ({
    capturedAt: new Date().toISOString(), memoryUnit: 'KiB', processes: app.getAppMetrics(),
  }))
}

async function joinUntilFirstPresentedFrame(page: Page, sharerName: string) {
  await page.evaluate(() => {
    const state = { clickMs: null as number | null, firstFrameMs: null as number | null }
    ;(window as Window & { __telaeLoadJoin?: typeof state }).__telaeLoadJoin = state
    const observer = new MutationObserver(watchVideo)
    let watching = false
    function watchVideo() {
      const video = document.querySelector('video[aria-label="Transmissão do seu amigo"]')
      if (!(video instanceof HTMLVideoElement) || watching) return
      watching = true
      observer.disconnect()
      video.requestVideoFrameCallback(() => { state.firstFrameMs = performance.now() })
    }
    document.addEventListener('click', function start(event) {
      const button = event.target instanceof Element ? event.target.closest('button') : null
      if (button?.textContent?.trim() !== 'Assistir') return
      state.clickMs = performance.now()
      document.removeEventListener('click', start, true)
      observer.observe(document.body, { childList: true, subtree: true })
      watchVideo()
    }, true)
  })
  await watchFriend(page, sharerName)
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { __telaeLoadJoin?: { firstFrameMs: number | null } }).__telaeLoadJoin?.firstFrameMs ?? null,
  ), { timeout: 60_000 }).not.toBeNull()
  return page.evaluate(() => {
    const state = (window as Window & { __telaeLoadJoin?: { clickMs: number | null; firstFrameMs: number | null } }).__telaeLoadJoin!
    if (state.clickMs === null || state.firstFrameMs === null) throw new Error('Medição de primeiro frame incompleta')
    return state.firstFrameMs - state.clickMs
  })
}

test.use({ trace: 'off' }) // An hour of snapshots would distort this measurement and produce huge traces.

// Playwright requires an object pattern even when no browser fixture is requested.
// eslint-disable-next-line no-empty-pattern
test('carga e endurance opt-in com evidência de múltiplos espectadores', async ({}, testInfo) => {
  test.skip(requestedViewers === undefined, 'Ative TELAE_E2E_VIEWERS=3|6|12 e TELAE_E2E_MEDIA=1')
  expect(process.env.TELAE_E2E_MEDIA, 'Carga exige mídia real').toBe('1')
  test.setTimeout((soakSeconds + viewerCount * 120 + 180) * 1000)
  const instances: Array<{ app: ElectronApplication; page: Page; directory: string }> = []
  const evidence: Record<string, unknown> = {
    schemaVersion: 1, startedAt: new Date().toISOString(), status: 'running',
    requestedViewers: viewerCount, requestedSoakSeconds: soakSeconds,
    relayRequested: process.env.TELAE_E2E_RELAY === '1',
    commit: process.env.GITHUB_SHA ?? null,
    host: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, totalMemoryBytes: os.totalmem() },
    measurement: 'Same-host headed Electron; click-to-requestVideoFrameCallback in each renderer. Sequential joins.',
    unmeasured: ['glass-to-glass', 'A/V synchronization', 'audible audio', 'remote-network throughput'],
  }
  const joins: Array<{ viewer: number; joinFirstFrameMs: number | null; outcome: string }> = []
  const samples: unknown[] = []
  evidence.joins = joins
  evidence.samples = samples
  const evidencePath = testInfo.outputPath(`load-${viewerCount}-${soakSeconds}s.json`)
  await fs.mkdir(path.dirname(evidencePath), { recursive: true })
  async function saveEvidence() { await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2)) }
  async function launch(name: string, muted: boolean) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telae-load-'))
    const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) as Record<string, string>
    if (process.env.TELAE_E2E_SIGNALING_URL) env.TELAE_SIGNALING_URL = process.env.TELAE_E2E_SIGNALING_URL
    const app = await electron.launch({ args: [path.resolve(import.meta.dirname, '..'), '--no-sandbox', '--lang=pt-BR', `--user-data-dir=${directory}`, ...(muted ? ['--mute-audio'] : [])], env })
    const page = await app.firstWindow()
    instances.push({ app, page, directory })
    await signUp(page, name)
    await expect(page.getByRole('heading', { name: /Compartilhar a tela ficou simples/ })).toBeVisible({ timeout: 30_000 })
    return { app, page }
  }
  try {
    const sharer = await launch('LoadSender', false)
    await sharer.page.getByRole('button', { name: /Escolher tela/ }).click()
    await sharer.page.getByRole('radio').first().click()
    await sharer.page.getByRole('button', { name: 'Começar a compartilhar', exact: true }).click()
    await expect(sharer.page.getByRole('heading', { name: /Você está compartilhando/ })).toBeVisible({ timeout: 60_000 })
    for (let index = 1; index <= viewerCount; index++) {
      const viewer = await launch(`LoadViewer${index}`, true)
      await befriend({ page: sharer.page, name: 'LoadSender' }, { page: viewer.page, name: `LoadViewer${index}` })
      const join = { viewer: index, joinFirstFrameMs: null as number | null, outcome: 'pending' }
      joins.push(join)
      try { join.joinFirstFrameMs = await joinUntilFirstPresentedFrame(viewer.page, 'LoadSender'); join.outcome = 'presented' }
      catch (error) { join.outcome = 'failed'; throw error }
      await saveEvidence()
    }
    await expect(sharer.page.getByRole('region', { name: 'Espectadores', exact: true }).getByRole('button', { name: /^Remover LoadViewer/ })).toHaveCount(viewerCount)
    const viewers = instances.slice(1)
    evidence.memoryStart = await Promise.all(instances.map(async (instance, index) => ({ instance: index, ...await memorySnapshot(instance.app) })))
    evidence.diagnosticsStart = await Promise.all(instances.map(instance => diagnosticSnapshot(instance.page)))
    let previous = await Promise.all(viewers.map(viewer => frameSnapshot(viewer.page)))
    const initialFrames = previous
    const soakStarted = performance.now()
    evidence.soakStartedAt = new Date().toISOString()
    while (performance.now() - soakStarted < soakSeconds * 1000) {
      await delay(Math.min(5000, Math.max(1, soakSeconds * 1000 - (performance.now() - soakStarted))))
      const current = await Promise.all(viewers.map(viewer => frameSnapshot(viewer.page)))
      samples.push({ elapsedMs: performance.now() - soakStarted, viewers: current.map((frame, index) => ({
        viewer: index + 1, ...frame,
        playbackFps: (frame.totalVideoFrames - previous[index].totalVideoFrames) / ((frame.rendererTimeMs - previous[index].rendererTimeMs) / 1000),
      })) })
      previous = current
      await saveEvidence()
    }
    evidence.actualSoakSeconds = (performance.now() - soakStarted) / 1000
    evidence.memoryEnd = await Promise.all(instances.map(async (instance, index) => ({ instance: index, ...await memorySnapshot(instance.app) })))
    // Internal telemetry includes RTC framesDecoded/FPS and one-hour samples; playback counters above are separately named.
    const diagnosticsEnd = await Promise.all(instances.map(instance => diagnosticSnapshot(instance.page)))
    evidence.diagnosticsEnd = diagnosticsEnd
    evidence.receiverRtcEnd = diagnosticsEnd.slice(1).map((exported, index) => ({
      viewer: index + 1,
      framesDecoded: exported.snapshot.diagnostics.framesDecoded ?? null,
      framesPerSecond: exported.snapshot.diagnostics.framesPerSecond,
      transportPath: exported.snapshot.diagnostics.transportPath,
    }))
    if (process.env.TELAE_E2E_RELAY === '1') {
      for (const exported of diagnosticsEnd.slice(1)) {
        expect(exported.snapshot.diagnostics.transportPath, 'Carga relay exige par ICE relay em cada receptor').toBe('relay')
      }
    }
    for (let index = 0; index < viewers.length; index++) {
      expect(previous[index].totalVideoFrames, `Viewer ${index + 1} deve continuar recebendo frames`).toBeGreaterThan(initialFrames[index].totalVideoFrames)
      expect(previous[index].paused).toBe(false)
    }
    const sorted = joins.map(join => join.joinFirstFrameMs!).sort((a, b) => a - b)
    evidence.joinFirstFrameP95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1]
    evidence.p95Caveat = 'Only 3/6/12 sequential same-host joins; insufficient for release p95 claims. Repeat >=30 independent joins per scenario.'
    const sharerImage = testInfo.outputPath('sharer-controls.png')
    await sharer.page.screenshot({ path: sharerImage, fullPage: true })
    await testInfo.attach('sharer-controls', { path: sharerImage, contentType: 'image/png' })
    const viewerImage = testInfo.outputPath('viewer.png')
    await viewers[0].page.getByLabel('Transmissão do seu amigo').hover()
    await viewers[0].page.screenshot({ path: viewerImage, fullPage: true })
    await testInfo.attach('viewer', { path: viewerImage, contentType: 'image/png' })
    await sharer.page.getByRole('button', { name: 'Parar transmissão', exact: true }).click()
    evidence.status = 'passed'
  } catch (error) {
    evidence.status = 'failed'
    evidence.failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    evidence.finishedAt = new Date().toISOString()
    await saveEvidence()
    await testInfo.attach('load-evidence', { path: evidencePath, contentType: 'application/json' })
    await Promise.allSettled(instances.map(instance => instance.app.close()))
    // Unique directories created by this test only; preserve unrelated profiles.
    await Promise.allSettled(instances.map(instance => {
      const absolute = path.resolve(instance.directory)
      const relative = path.relative(path.resolve(os.tmpdir()), absolute)
      if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(absolute).startsWith('telae-load-')) {
        throw new Error('Diretório temporário fora do escopo da carga; limpeza bloqueada')
      }
      return fs.rm(absolute, { recursive: true, force: true })
    }))
  }
})
