import { expect, test, type ElectronApplication, type Page, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { diagnosticSnapshot } from './diagnostics.ts'
import { signUp } from './auth.ts'
import { addFriend, befriend, friendCodeOf, submitFriend, watchFriend } from './friends.ts'

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
  const args = [APP_DIR, '--no-sandbox', '--lang=pt-BR', `--user-data-dir=${userDataDir}`]
  if (muteAudioOutput) args.push('--mute-audio')
  const app = await electron.launch({
    args,
    env: signalingUrl
      ? { ...env, TELAE_SIGNALING_URL: signalingUrl }
      : env,
  })
  if (!WITH_MEDIA) {
    await app.evaluate(({ ipcMain }) => {
      for (const channel of ['audio:start', 'audio:start-screen']) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, () => { throw new Error('Captura física de áudio desativada neste teste.') })
      }
    })
  }
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
  if (!WITH_MEDIA) {
    // Os fluxos de contas e privacidade usam frames locais, sem depender do monitor do runner.
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 320
        canvas.height = 180
        const context = canvas.getContext('2d')!
        let frame = 0
        const draw = () => {
          context.fillStyle = '#18251b'
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.fillStyle = '#8cc63f'
          context.fillRect(frame++ % canvas.width, 60, 24, 24)
        }
        draw()
        const stream = canvas.captureStream(15)
        const timer = window.setInterval(() => {
          if (stream.getVideoTracks()[0].readyState === 'ended') window.clearInterval(timer)
          else draw()
        }, 1000 / 15)
        return stream
      }
    })
  }
  return page
}

const enterWithName = signUp

test.describe('duas instâncias Telae', () => {
  test('janela captura apenas o áudio do aplicativo escolhido', async () => {
    test.skip(!WITH_MEDIA, 'Exige captura real de janela no Windows')
    const app = await launchApp(true)
    try {
      const page = await firstWindow(app)
      await enterWithName(page, 'JanelaE2E')
      await expect(page.locator('header svg:not([data-brand])')).toHaveCount(1) // Fora a marca, só o ícone de configurações.
      await expect(page.locator('header').getByText(/Pronto|Aguardando seu amigo/)).toHaveCount(0)
      await page.getByRole('button', { name: /Escolher tela/ }).click()
      await expect(page.getByRole('heading', { name: /O que você quer mostrar/ })).toBeVisible()
      await page.getByRole('tab', { name: /Janelas/ }).click()
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
      await page.getByRole('button', { name: 'Começar a transmitir' }).click()
      await expect(page.getByRole('heading', { name: /Você está transmitindo/ })).toBeVisible({ timeout: 60_000 })
      await expect(page.getByText('O Windows não disponibilizou áudio desta fonte.')).toHaveCount(0)
      await page.getByRole('button', { name: 'Parar transmissão' }).click()
    } finally {
      await app.close()
    }
  })

  test('@ inexistente falha com motivo específico', async () => {
    const sharerApp = await launchApp()
    const viewerApp = await launchApp(true)
    try {
      const sharer = await firstWindow(sharerApp)
      const viewer = await firstWindow(viewerApp)

      await enterWithName(sharer, 'SharerE2E')
      await enterWithName(viewer, 'ViewerE2E')

      const installedVersion = (await sharer.evaluate(() => window.telae.getEnvironment())).version
      await expect(sharer.getByLabel('Versão instalada')).toHaveText(`v${installedVersion}`)
      await expect(sharer.getByRole('button', { name: 'Buscar atualização', exact: true })).toBeVisible()
      for (const size of [{ width: 1220, height: 790 }, { width: 980, height: 650 }]) {
        await sharerApp.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), size)
        await expect.poll(() => sharer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        // Primary actions stay above the fold without scrolling; the friends section may extend below it.
        for (const control of [
          sharer.getByRole('button', { name: /Escolher tela/ }),
          sharer.getByRole('heading', { name: 'Amigos', exact: true }),
        ]) {
          await expect.poll(() => control.evaluate(element => {
            const rect = element.getBoundingClientRect()
            return rect.top >= 0 && rect.bottom <= window.innerHeight
          })).toBe(true)
        }
        await sharer.screenshot({ path: test.info().outputPath(`layout-home-${size.width}x${size.height}.png`) })
      }
      await sharerApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 760, height: 650 }))
      await expect.poll(() => sharer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await sharer.getByRole('button', { name: 'Buscar atualização', exact: true }).scrollIntoViewIfNeeded()
      await expect(sharer.getByRole('button', { name: 'Buscar atualização', exact: true })).toBeInViewport()
      await sharerApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1220, height: 790 }))

      await sharer.screenshot({ path: test.info().outputPath('layout-home.png'), fullPage: true })
      await sharer.getByRole('button', { name: /Escolher tela/ }).click()
      await expect(sharer.getByRole('heading', { name: /O que você quer mostrar/ })).toBeVisible()
      const qualityOptions = sharer.getByRole('radiogroup', { name: 'Qualidade da imagem' })
      await expect(qualityOptions).toBeVisible({ timeout: 15_000 }) // A enumeração nativa de fontes termina antes de mostrar a qualidade.
      await expect(qualityOptions.getByRole('radio', { name: 'Auto', exact: true })).toHaveCount(0)
      await expect(qualityOptions.getByRole('radio', { name: '1080p', exact: true })).toHaveAttribute('aria-checked', 'true')
      await expect(qualityOptions.getByRole('radio')).toHaveCount(5)
      await sharer.screenshot({ path: test.info().outputPath('layout-picker.png'), fullPage: true, mask: [sharer.locator('img')] })
      await sharerApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 980, height: 650 }))
      await expect.poll(() => sharer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const shareAction = sharer.getByRole('button', { name: 'Começar a transmitir' })
      const insideViewport = () => shareAction.evaluate(button => {
        const rect = button.getBoundingClientRect()
        return rect.top >= 0 && rect.bottom <= window.innerHeight
      })
      await expect.poll(insideViewport).toBe(true)
      const sourceRegion = sharer.getByRole('region', { name: 'Fontes disponíveis' })
      await sourceRegion.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(insideViewport).toBe(true)
      await expect.poll(() => sharer.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
      await sharerApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('update:status', { phase: 'downloading', version: '0.1.17', percent: 45 }))
      const progress = sharer.getByRole('progressbar', { name: 'Download da atualização' })
      await expect(progress).toHaveAttribute('value', '45')
      await expect(sharer.getByLabel('Versão instalada')).toHaveText(`v${installedVersion}`)
      await expect.poll(insideViewport).toBe(true)
      await sharer.screenshot({ path: test.info().outputPath('layout-update-download.png'), style: 'img { visibility: hidden !important; }' })
      await sharer.emulateMedia({ reducedMotion: 'reduce' })
      await expect(sharer.locator('.telae-update-spinner')).toHaveCSS('animation-name', 'none')
      await sharer.emulateMedia({ reducedMotion: 'no-preference' })
      await sharerApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('update:status', { phase: 'installing', version: '0.1.17' }))
      await expect(progress).toHaveCount(0)
      await expect(sharer.getByRole('status')).toContainText('O Telaê reabre sozinho.')
      await sharerApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('update:status', { phase: 'error', version: '0.1.16', message: 'Falha de conexão durante a atualização.' }))
      await expect(sharer.getByRole('button', { name: 'Tentar de novo', exact: true })).toBeVisible()
      await expect.poll(insideViewport).toBe(true)
      await sharerApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('update:status', { phase: 'current', version: '0.1.16' }))
      await sharer.screenshot({ path: test.info().outputPath('layout-picker-minimum.png'), fullPage: true, style: 'img { visibility: hidden !important; }' })
      for (const size of [{ width: 760, height: 560 }, { width: 640, height: 560 }]) {
        await sharerApp.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), size)
        await expect.poll(insideViewport).toBe(true)
        await expect.poll(() => sourceRegion.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(0)
        await expect.poll(() => sharer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await sharer.screenshot({ path: test.info().outputPath(`layout-picker-${size.width}x${size.height}.png`), mask: [sharer.locator('img')] })
      }
      const windowSources = await sharer.evaluate(() => window.telae.listCaptureSources())
      const firstWindowSource = windowSources.find((source: { kind: string; id: string }) => source.kind === 'window')
      if (WITH_MEDIA && firstWindowSource) {
        await sharer.evaluate((sourceId) => window.telae.selectCaptureSource(sourceId), firstWindowSource.id)
        const processId = await sharer.evaluate((sourceId) => window.telae.resolveWindowAudioProcess(sourceId), firstWindowSource.id)
        expect(processId).toBeGreaterThan(0)
      }

      await submitFriend(viewer, 'ninguem_aqui')
      await expect(viewer.getByRole('alert')).toContainText(/Não deu pra achar ninguém/, { timeout: 30_000 })
    } finally {
      await sharerApp.close()
      await viewerApp.close()
    }
  })

  test('pedido de amizade aparece e aceitar torna mútuo', async () => {
    const anaApp = await launchApp()
    const biaApp = await launchApp(true)
    try {
      const ana = await firstWindow(anaApp)
      const bia = await firstWindow(biaApp)
      await enterWithName(ana, 'AnaE2E')
      await enterWithName(bia, 'BiaE2E')

      // Só Ana adicionou: Bia vê o pedido sem ter feito nada; Ana não vê pedido nenhum.
      await addFriend(ana, await friendCodeOf(bia), 'BiaE2E')
      await expect(bia.getByRole('heading', { name: 'Pedidos de amizade' })).toBeVisible({ timeout: 30_000 })
      await expect(bia.getByRole('listitem').filter({ hasText: 'AnaE2E' }).getByRole('button', { name: 'Aceitar' })).toBeVisible()
      await expect(ana.getByRole('heading', { name: 'Pedidos de amizade' })).toHaveCount(0)

      // Bia aceita: o pedido some e Ana entra na lista dela.
      await bia.getByRole('listitem').filter({ hasText: 'AnaE2E' }).getByRole('button', { name: 'Aceitar' }).click()
      await expect(bia.getByRole('heading', { name: 'Pedidos de amizade' })).toHaveCount(0, { timeout: 30_000 })
      await expect(bia.getByRole('listitem').filter({ hasText: 'AnaE2E' })).toBeVisible({ timeout: 30_000 })
    } finally {
      await anaApp.close()
      await biaApp.close()
    }
  })

  test('amigos escolhidos: só o escolhido vê; marcar outro amigo no meio da transmissão libera a ele', async () => {
    const anaApp = await launchApp()
    const biaApp = await launchApp(true)
    const caioApp = await launchApp(true)
    try {
      const [ana, bia, caio] = [await firstWindow(anaApp), await firstWindow(biaApp), await firstWindow(caioApp)]
      await enterWithName(ana, 'AnaE2E')
      await enterWithName(bia, 'BiaE2E')
      await enterWithName(caio, 'CaioE2E')
      await befriend({ page: ana, name: 'AnaE2E' }, { page: bia, name: 'BiaE2E' })
      await befriend({ page: ana, name: 'AnaE2E' }, { page: caio, name: 'CaioE2E' })

      // Ana escolhe a tela e, antes de começar, só a Bia.
      await ana.getByRole('button', { name: /Escolher tela/ }).click()
      await ana.getByRole('radio').first().click()
      await ana.getByRole('button', { name: /Quem pode ver/ }).click()
      await ana.getByRole('radio', { name: /Amigos escolhidos/ }).click()
      await ana.getByRole('checkbox', { name: /BiaE2E/ }).click()
      await expect(ana.getByRole('button', { name: /Quem pode ver/ })).toContainText('1 amigo escolhido')
      // Não existe "pedir pra entrar" nem um controle separado de prévia.
      await expect(ana.getByText(/pedir pra entrar|aprovar/i)).toHaveCount(0)
      await expect(ana.getByRole('switch', { name: /Prévia no Início/ })).toHaveCount(0)
      // A escolha é gravada no computador (o processo principal recusava essas chaves antes).
      await expect.poll(() => ana.evaluate(() => (window as unknown as { telae: { getSettings(): Promise<unknown> } }).telae.getSettings()))
        .toMatchObject({ shareAudienceMode: 'selected', shareSelectedUsernames: [expect.any(String)] })
      await ana.getByRole('button', { name: /Começar a transmitir/ }).click()
      await expect(ana.getByRole('heading', { name: /Você está transmitindo/ })).toBeVisible({ timeout: 60_000 })

      // Bia vê o cartão com "Assistir"; Caio, amigo fora da lista, não vê nada.
      await expect(liveCard(bia, 'AnaE2E').getByRole('button', { name: 'Assistir AnaE2E', exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(liveCard(caio, 'AnaE2E')).toHaveCount(0)
      await expect(caio.getByRole('heading', { name: 'Ninguém transmitindo agora' })).toBeVisible()

      // No meio da transmissão, Ana marca o Caio: ele passa a ver, mas ninguém é colocado lá dentro sozinho.
      const panel = ana.getByRole('complementary', { name: 'Quem está assistindo' })
      await panel.getByRole('button', { name: 'Alterar' }).click()
      await panel.getByRole('radio', { name: /Amigos escolhidos/ }).click()
      await panel.getByRole('checkbox', { name: /CaioE2E/ }).click()
      await expect(panel.getByText(/saem? da transmissão ao aplicar/)).toHaveCount(0)
      await panel.getByRole('button', { name: 'Aplicar' }).click()
      await expect(panel.getByText(/2 amigos escolhidos/)).toBeVisible({ timeout: 30_000 })

      await expect(liveCard(caio, 'AnaE2E')).toBeVisible({ timeout: 30_000 })
      await expect(panel.getByText('CaioE2E')).toHaveCount(0)
      await watchFriend(caio, 'AnaE2E')
      await expect(caio.getByLabel('Transmissão do seu amigo')).toBeVisible({ timeout: 60_000 })
      await expect(panel.getByText('CaioE2E')).toBeVisible({ timeout: 30_000 })
    } finally {
      await anaApp.close(); await biaApp.close(); await caioApp.close()
    }
  })

  /** Começa a transmitir a primeira fonte; `configure` mexe nas opções de quem pode ver antes de começar. */
  async function startSharing(page: Page, configure?: () => Promise<void>) {
    await page.getByRole('button', { name: /Escolher tela/ }).click()
    await page.getByRole('radio').first().click()
    if (configure) {
      await page.getByRole('button', { name: /Quem pode ver/ }).click()
      await configure()
    }
    await page.getByRole('button', { name: /Começar a transmitir/ }).click()
    await expect(page.getByRole('heading', { name: /Você está transmitindo/ })).toBeVisible({ timeout: 60_000 })
  }

  const liveCard = (page: Page, name: string) => page.getByRole('article', { name: `${name} está ao vivo` })

  test('todos os amigos: todos veem e entram com um clique, com prévia no Início', async () => {
    const anaApp = await launchApp()
    const biaApp = await launchApp(true)
    const caioApp = await launchApp(true)
    try {
      const [ana, bia, caio] = [await firstWindow(anaApp), await firstWindow(biaApp), await firstWindow(caioApp)]
      await enterWithName(ana, 'AnaE2E')
      await enterWithName(bia, 'BiaE2E')
      await enterWithName(caio, 'CaioE2E')
      await befriend({ page: ana, name: 'AnaE2E' }, { page: bia, name: 'BiaE2E' })
      await befriend({ page: ana, name: 'AnaE2E' }, { page: caio, name: 'CaioE2E' })

      await startSharing(ana)

      for (const friend of [bia, caio]) {
        await expect(liveCard(friend, 'AnaE2E')).toBeVisible({ timeout: 30_000 })
        // O botão é "Assistir": um clique entra (o cartão do palco e a linha da lista têm o mesmo botão).
        await expect(liveCard(friend, 'AnaE2E').getByRole('button', { name: 'Assistir AnaE2E', exact: true })).toBeVisible()
        await expect(friend.getByRole('button', { name: /Pedir pra entrar/ })).toHaveCount(0)
        // A prévia ligada chega ao Início de quem pode ver.
        await expect(liveCard(friend, 'AnaE2E').locator('img')).toBeVisible({ timeout: 30_000 })
      }

      await watchFriend(bia, 'AnaE2E')
      await expect(bia.getByLabel('Transmissão do seu amigo')).toBeVisible({ timeout: 60_000 })
      await expect(ana.getByRole('complementary', { name: 'Quem está assistindo' }).getByText('BiaE2E')).toBeVisible({ timeout: 30_000 })
    } finally {
      await anaApp.close(); await biaApp.close(); await caioApp.close()
    }
  })

  test('ocultar: o amigo oculto nunca vê a transmissão e volta a ver depois de mostrar de novo', async () => {
    const anaApp = await launchApp()
    const biaApp = await launchApp(true)
    const caioApp = await launchApp(true)
    try {
      const [ana, bia, caio] = [await firstWindow(anaApp), await firstWindow(biaApp), await firstWindow(caioApp)]
      await enterWithName(ana, 'AnaE2E')
      await enterWithName(bia, 'BiaE2E')
      await enterWithName(caio, 'CaioE2E')
      await befriend({ page: ana, name: 'AnaE2E' }, { page: bia, name: 'BiaE2E' })
      await befriend({ page: ana, name: 'AnaE2E' }, { page: caio, name: 'CaioE2E' })

      // O ícone de olho aparece ao passar o mouse na linha do amigo.
      const caioRow = ana.getByRole('listitem').filter({ hasText: 'CaioE2E' })
      await caioRow.hover()
      await caioRow.getByRole('button', { name: 'Ocultar minhas transmissões de CaioE2E' }).click()
      await expect(ana.getByRole('status').filter({ hasText: 'CaioE2E não vê mais suas transmissões.' })).toBeVisible({ timeout: 30_000 })
      await expect(caioRow.getByText('oculto')).toBeVisible()

      await startSharing(ana)
      await expect(liveCard(bia, 'AnaE2E')).toBeVisible({ timeout: 30_000 })
      // Caio continua vendo Ana online (sem pista de que foi ocultado), mas nunca ao vivo.
      await expect(caio.getByRole('listitem').filter({ hasText: 'AnaE2E' })).toBeVisible({ timeout: 30_000 })
      await caio.waitForTimeout(3000)
      await expect(liveCard(caio, 'AnaE2E')).toHaveCount(0)
      await expect(caio.getByRole('button', { name: /Assistir AnaE2E|Pedir pra entrar/ })).toHaveCount(0)
      // Parar, mostrar de novo em Configurações > Privacidade e transmitir outra vez.
      await ana.getByRole('button', { name: 'Parar transmissão' }).click()
      await expect(ana.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 })
      await ana.getByRole('button', { name: 'Abrir configurações' }).click()
      await ana.getByRole('tab', { name: 'Privacidade' }).click()
      await expect(ana.getByText('@', { exact: false }).filter({ hasText: /^@/ }).first()).toBeVisible()
      await ana.screenshot({ path: test.info().outputPath('privacy-tab.png') })
      await ana.getByRole('button', { name: 'Mostrar de novo' }).click()
      await expect(ana.getByText(/Ninguém oculto/)).toBeVisible({ timeout: 30_000 })
      await ana.getByRole('button', { name: 'Voltar' }).click()
      await expect(ana.getByTestId('home-screen')).toBeVisible()

      await startSharing(ana)
      await expect(liveCard(caio, 'AnaE2E')).toBeVisible({ timeout: 30_000 })
    } finally {
      await anaApp.close(); await biaApp.close(); await caioApp.close()
    }
  })

  test('mudar para escolhidos no meio da transmissão: quem assiste vem marcado e o app diz quem sai', async () => {
    const anaApp = await launchApp()
    const biaApp = await launchApp(true)
    const caioApp = await launchApp(true)
    try {
      const [ana, bia, caio] = [await firstWindow(anaApp), await firstWindow(biaApp), await firstWindow(caioApp)]
      await enterWithName(ana, 'AnaE2E')
      await enterWithName(bia, 'BiaE2E')
      await enterWithName(caio, 'CaioE2E')
      await befriend({ page: ana, name: 'AnaE2E' }, { page: bia, name: 'BiaE2E' })
      await befriend({ page: ana, name: 'AnaE2E' }, { page: caio, name: 'CaioE2E' })

      await startSharing(ana)
      await watchFriend(bia, 'AnaE2E')
      await watchFriend(caio, 'AnaE2E')
      await expect(bia.getByLabel('Transmissão do seu amigo')).toBeVisible({ timeout: 60_000 })
      await expect(caio.getByLabel('Transmissão do seu amigo')).toBeVisible({ timeout: 60_000 })
      const panel = ana.getByRole('complementary', { name: 'Quem está assistindo' })
      await expect(panel.getByText('BiaE2E')).toBeVisible({ timeout: 30_000 })
      await expect(panel.getByText('CaioE2E')).toBeVisible({ timeout: 30_000 })

      // Passar para "escolhidos" parte de quem já assiste: os dois vêm marcados, com a etiqueta, e ninguém sai ainda.
      await panel.getByRole('button', { name: 'Alterar' }).click()
      await panel.getByRole('radio', { name: /Amigos escolhidos/ }).click()
      for (const name of [/BiaE2E/, /CaioE2E/]) {
        await expect(panel.getByRole('checkbox', { name })).toHaveAttribute('aria-checked', 'true')
        await expect(panel.getByRole('checkbox', { name }).getByText('Assistindo')).toBeVisible()
      }
      await expect(panel.getByText(/saem? da transmissão ao aplicar/)).toHaveCount(0)
      await ana.screenshot({ path: test.info().outputPath('audience-editor-marcados.png') })

      // Desmarcar o Caio: o aviso diz o nome dele, e ele só sai depois de Aplicar.
      await panel.getByRole('checkbox', { name: /CaioE2E/ }).click()
      await expect(panel.getByText('CaioE2E sai da transmissão ao aplicar.')).toBeVisible()
      await ana.screenshot({ path: test.info().outputPath('audience-editor-saindo.png') })
      await expect(caio.getByLabel('Transmissão do seu amigo')).toBeVisible()
      await panel.getByRole('button', { name: 'Aplicar' }).click()

      await expect(caio.locator('p', { hasText: 'A transmissão acabou, ou você foi removido dela.' })).toBeVisible({ timeout: 30_000 })
      await expect(bia.getByLabel('Transmissão do seu amigo')).toBeVisible()
      await expect(panel.getByText('CaioE2E')).toHaveCount(0, { timeout: 30_000 })
      await expect(panel.getByText('BiaE2E')).toBeVisible()
      await expect(panel.getByText(/1 amigo escolhido/)).toBeVisible()

      // Caio volta ao Início e já não vê a transmissão.
      await caio.getByRole('button', { name: 'Voltar ao início' }).click()
      await expect(liveCard(caio, 'AnaE2E')).toHaveCount(0, { timeout: 30_000 })

      // Ana marca o Caio de novo: ele volta a ver o cartão (sem ser recolocado sozinho).
      await panel.getByRole('button', { name: 'Alterar' }).click()
      await panel.getByRole('checkbox', { name: /CaioE2E/ }).click()
      await panel.getByRole('button', { name: 'Aplicar' }).click()
      await expect(liveCard(caio, 'AnaE2E')).toBeVisible({ timeout: 30_000 })
      await expect(panel.getByText('CaioE2E')).toHaveCount(0)

    } finally {
      await anaApp.close(); await biaApp.close(); await caioApp.close()
    }
  })

  test('amigo ao vivo continua na lista de amigos, no alto, e dá pra assistir por ali', async () => {
    const anaApp = await launchApp()
    const biaApp = await launchApp(true)
    try {
      const [ana, bia] = [await firstWindow(anaApp), await firstWindow(biaApp)]
      await enterWithName(ana, 'AnaE2E')
      await enterWithName(bia, 'BiaE2E')
      await befriend({ page: ana, name: 'AnaE2E' }, { page: bia, name: 'BiaE2E' })

      await startSharing(ana)
      const rail = bia.getByRole('complementary', { name: 'Amigos' })
      await expect(rail.getByRole('heading', { name: /^Ao vivo/ })).toBeVisible({ timeout: 30_000 })
      // O contador do alto bate com as linhas: a Ana está ao vivo e continua listada.
      await expect(rail.locator('#friends-title + span')).toHaveText('1')
      await expect(rail.getByRole('listitem')).toHaveCount(1)
      await expect(rail.getByRole('listitem').first()).toContainText('AnaE2E')
      await expect(rail.getByRole('listitem').first()).toContainText('Ao vivo')

      const liveRow = rail.getByRole('listitem').first()
      await liveRow.hover()
      const hide = liveRow.getByRole('button', { name: 'Ocultar minhas transmissões de AnaE2E' })
      await expect(hide).toBeVisible()
      const hideBounds = await hide.boundingBox()
      const watchBounds = await liveRow.getByRole('button', { name: 'Assistir AnaE2E' }).boundingBox()
      expect(hideBounds!.x + hideBounds!.width).toBeLessThanOrEqual(watchBounds!.x)
      await hide.click()
      await liveRow.getByRole('button', { name: 'Mostrar minhas transmissões pra AnaE2E' }).click()
      await expect(liveRow.getByRole('button', { name: 'Remover AnaE2E', exact: true })).toBeVisible()
      await bia.screenshot({ path: test.info().outputPath('lista-ao-vivo.png') })

      await rail.getByRole('button', { name: 'Assistir AnaE2E' }).click()
      await expect(bia.getByLabel('Transmissão do seu amigo')).toBeVisible({ timeout: 60_000 })
    } finally {
      await anaApp.close(); await biaApp.close()
    }
  })

  test('amigos mútuos: sharer compartilha e viewers assistem pela lista (mídia real)', async () => {
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
      await befriend({ page: sharer, name: 'SharerE2E' }, { page: viewer, name: 'ViewerE2E' })
      await befriend({ page: sharer, name: 'SharerE2E' }, { page: secondViewer, name: 'Viewer2E2E' })

      await sharer.getByRole('button', { name: /Escolher tela/ }).click()
      const firstSource = sharer.getByRole('radio').first()
      await firstSource.click()
      await sharer.getByRole('button', { name: /Começar a transmitir/ }).click()
      await expect(sharer.getByRole('heading', { name: /Você está transmitindo/ })).toBeVisible({ timeout: 60_000 })
      await expect(sharer.locator('header').getByText(/Pronto|Aguardando seu amigo|Ao vivo/)).toHaveCount(0)
      const preview = sharer.getByLabel(/Pré-visualização de/)
      for (const bounds of [{ width: 2560, height: 1392 }, { width: 1600, height: 900 }, { width: 1220, height: 790 }, { width: 980, height: 650 }, { width: 640, height: 560 }]) {
        await sharerApp.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setBounds(size), bounds)
        await expect.poll(() => sharer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await expect(preview).toBeVisible()
        await sharer.screenshot({ path: test.info().outputPath(`sharer-${bounds.width}x${bounds.height}.png`) })
        if (bounds.width >= 960) {
          await expect.poll(() => preview.evaluate(video => video.getBoundingClientRect().width / innerWidth)).toBeGreaterThan(.55)
          for (const control of [sharer.getByRole('button', { name: 'Parar transmissão' }), sharer.getByLabel('Qualidade da transmissão'), sharer.getByRole('button', { name: 'Parar transmissão', exact: true })]) {
            await expect.poll(() => control.evaluate(element => ({ bottom: element.getBoundingClientRect().bottom, viewport: innerHeight })).then(rect => rect.bottom - rect.viewport), { message: `${bounds.width}x${bounds.height}: ${await control.textContent()}` }).toBeLessThanOrEqual(0)
          }
        } else {
          await sharer.getByRole('button', { name: 'Parar transmissão', exact: true }).scrollIntoViewIfNeeded()
          await expect(sharer.getByRole('button', { name: 'Parar transmissão', exact: true })).toBeInViewport()
        }
        await sharer.screenshot({ path: test.info().outputPath(`sharer-${bounds.width}x${bounds.height}.png`) })
      }
      await sharerApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1220, height: 790 }))

      await viewerApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
      await watchFriend(viewer, 'SharerE2E')
      const remoteVideo = viewer.getByLabel('Transmissão do seu amigo')
      await expect(remoteVideo).toBeVisible({ timeout: 60_000 })
      await expectRenderedFrames(viewer)
      // O diagnóstico é amostrado a cada 1s: espera até dois ciclos após o primeiro frame renderizado.
      await expect.poll(async () => (await diagnosticSnapshot(viewer)).snapshot.diagnostics.framesDecoded ?? 0,
        { timeout: 30_000 }).toBeGreaterThan(0)
      await expect(viewer.getByText('Detalhes da conexão', { exact: true })).toHaveCount(0)
      await expect(viewer.locator('header').getByText(/Ao vivo ·|Assistindo|Aguardando seu amigo|Pronto/)).toHaveCount(0)
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
          const frame = video.closest('.telae-viewer-canvas')!.getBoundingClientRect()
          return {
            fit: getComputedStyle(video).objectFit,
            // O vídeo preenche a moldura do player, e a moldura usa a largura da janela (menos as margens).
            fullWidth: Math.abs(rect.width - frame.width) < 4 && frame.width >= window.innerWidth - 56,
            fullHeight: Math.abs(rect.height - frame.height) < 4 && frame.height > window.innerHeight * 0.45,
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
      await expect(sharer.getByText('A transmissão segue no ar durante a troca.')).toBeVisible()
      await expect(sharer.getByRole('button', { name: 'Abrir configurações' })).toBeDisabled()
      await sharer.getByRole('button', { name: /Voltar/ }).click()
      await expect(sharer.getByRole('button', { name: 'Parar transmissão' })).toBeVisible()

      await sharer.getByRole('button', { name: 'Trocar fonte' }).click()
      await sharer.getByRole('button', { name: 'Trocar fonte agora' }).click()
      await expect(sharer.getByRole('button', { name: 'Parar transmissão' })).toBeVisible()
      await expect(remoteVideo).toBeVisible()

      await watchFriend(secondViewer, 'SharerE2E')
      const secondVideo = secondViewer.getByLabel('Transmissão do seu amigo')
      await expect(secondVideo).toBeVisible({ timeout: 60_000 })
      await expectRenderedFrames(secondViewer)

      await sharer.evaluate(() => window.scrollTo(0, 0))
      await sharer.screenshot({ path: test.info().outputPath('sharer-ui.png'), fullPage: true, mask: [sharer.locator('video')] })
      await expect(sharer.getByText('2 pessoas assistindo')).toBeVisible()

      const liveQuality = sharer.getByRole('combobox', { name: 'Qualidade da transmissão' })
      await liveQuality.selectOption('720p60')
      await expect(liveQuality).toHaveValue('720p60')
      await expect(sharer.getByRole('combobox')).toHaveCount(1)
      await expect(sharer.getByRole('spinbutton')).toHaveCount(0)
      await expect(sharer.getByText('Detalhes da conexão', { exact: true })).toHaveCount(0)
      await expect(sharer.getByRole('button', { name: 'Silenciar transmissão', exact: true })).toHaveCount(0)
      await expect(sharer.getByRole('button', { name: 'Parar transmissão' })).toBeVisible()
      await expectRenderedFrames(secondViewer)

      await sharer.getByRole('button', { name: 'Remover ViewerE2E', exact: true }).click()
      await expect(viewer.getByRole('heading', { name: 'A transmissão acabou.' })).toBeVisible()
      await expect(viewer.getByRole('button', { name: /Exportar diagnóstico/ })).toHaveCount(0)
      await expect(sharer.getByRole('button', { name: 'Remover ViewerE2E', exact: true })).toHaveCount(0)
      await expect(secondVideo).toBeVisible()
      await sharer.getByRole('button', { name: 'Parar transmissão' }).click()
      await expect(sharer.getByTestId('home-screen')).toBeVisible()
      await expect(secondViewer.getByRole('heading', { name: 'A transmissão acabou.' })).toBeVisible()
      await expect(sharer.getByRole('button', { name: /Exportar diagnóstico/ })).toHaveCount(0)
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
      await befriend({ page: sharer, name: 'RelaySender' }, { page: viewer, name: 'RelayReceiver' })
      await sharer.getByRole('button', { name: /Escolher tela/ }).click()
      await sharer.getByRole('radio').first().click()
      await sharer.getByRole('button', { name: /Começar a transmitir/ }).click()
      await expect(sharer.getByRole('heading', { name: /Você está transmitindo/ })).toBeVisible({ timeout: 60_000 })
      await watchFriend(viewer, 'RelaySender')
      await expectRenderedFrames(viewer)
      // The selected candidate pair must report relay, not just a configured TURN URL.
      for (const page of [sharer, viewer]) {
        await expect.poll(async () => (await diagnosticSnapshot(page)).snapshot.diagnostics.transportPath, { timeout: 30_000 }).toBe('relay')
      }
      await sharer.getByRole('button', { name: 'Parar transmissão' }).click()
    } finally {
      await sharerApp.close()
      await viewerApp.close()
    }
  })
})
