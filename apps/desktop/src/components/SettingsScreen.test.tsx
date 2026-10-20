// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppSettings, TelaeDesktopApi } from '../shared/contracts'
import { SettingsScreen } from './SettingsScreen'

const settings: AppSettings = { language: 'pt-BR', notifyFriendLive: true, launchAtLogin: false }
let api: Pick<TelaeDesktopApi, 'getSettings' | 'updateSettings' | 'getEnvironment' | 'setSignalingUrl'>

beforeEach(() => {
  api = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch })),
    getEnvironment: vi.fn().mockResolvedValue({ version: '1.0.0', platform: 'win32', isPackaged: true, signalingUrl: 'https://telae.example.com' }),
    setSignalingUrl: vi.fn().mockImplementation(async (signalingUrl: string) => ({ version: '1.0.0', platform: 'win32', isPackaged: true, signalingUrl })),
  }
  Object.defineProperty(window, 'telae', { value: api, configurable: true })
})
afterEach(cleanup)

function renderScreen() {
  render(<SettingsScreen name="Ana" onNameChange={vi.fn()} onSaveName={vi.fn()} nameBusy={false} nameError={null} version="1.0.0" deviceId="0123456789abcdef" onBack={vi.fn()} />)
}

it('loads stored preferences and persists a toggle', async () => {
  renderScreen()
  const launch = screen.getByRole('switch', { name: 'Abrir com o Windows' })
  await waitFor(() => expect(launch).toBeEnabled())
  expect(launch).toHaveAttribute('aria-checked', 'false')
  await userEvent.click(launch)
  expect(api.updateSettings).toHaveBeenCalledWith({ launchAtLogin: true })
  await waitFor(() => expect(launch).toHaveAttribute('aria-checked', 'true'))
})

it('saves a new server address only when it changed', async () => {
  renderScreen()
  const input = await screen.findByLabelText('Endereço')
  await waitFor(() => expect(input).toHaveValue('https://telae.example.com'))
  const save = screen.getAllByRole('button', { name: 'Salvar' })[1]
  expect(save).toBeDisabled()
  await userEvent.clear(input)
  await userEvent.type(input, 'https://meu-servidor.dev')
  await userEvent.click(save)
  expect(api.setSignalingUrl).toHaveBeenCalledWith('https://meu-servidor.dev')
  expect(await screen.findByRole('status')).toHaveTextContent('Reinicie o Telae')
})

it('explains that there is no account and shows a shortened device id', () => {
  renderScreen()
  expect(screen.getByText('01234567…')).toBeInTheDocument()
  expect(screen.getByText(/Não existe conta nem senha/)).toBeInTheDocument()
})
