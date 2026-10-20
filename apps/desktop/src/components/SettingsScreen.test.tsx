// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AccountInfo, AppSettings, TelaeDesktopApi } from '../shared/contracts'
import { SettingsScreen } from './SettingsScreen'

const settings: AppSettings = { language: 'pt-BR', notifyFriendLive: true, launchAtLogin: false }
const account: AccountInfo = { id: 'acc-1', username: 'ana', displayName: 'Ana', email: 'ana@example.com' }
let api: Pick<TelaeDesktopApi, 'getSettings' | 'updateSettings' | 'getEnvironment' | 'setSignalingUrl'> & {
  auth: Pick<TelaeDesktopApi['auth'], 'changePassword' | 'deleteAccount'>
}

beforeEach(() => {
  api = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockImplementation(async (patch: Partial<AppSettings>) => ({ ...settings, ...patch })),
    getEnvironment: vi.fn().mockResolvedValue({ version: '1.0.0', platform: 'win32', isPackaged: true, signalingUrl: 'https://telae.example.com' }),
    setSignalingUrl: vi.fn().mockImplementation(async (signalingUrl: string) => ({ version: '1.0.0', platform: 'win32', isPackaged: true, signalingUrl })),
    auth: {
      changePassword: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
      deleteAccount: vi.fn().mockResolvedValue({ ok: false, code: 'invalid_credentials' }),
    },
  }
  Object.defineProperty(window, 'telae', { value: api, configurable: true })
})
afterEach(cleanup)

function renderScreen(onSignOut = vi.fn()) {
  render(<SettingsScreen name="Ana" onNameChange={vi.fn()} onSaveName={vi.fn()} nameBusy={false} nameError={null} version="1.0.0" account={account} onSignOut={onSignOut} onBack={vi.fn()} />)
}

it('loads stored preferences and persists a toggle', async () => {
  renderScreen()
  await userEvent.click(screen.getByRole('tab', { name: 'Geral' }))
  const launch = screen.getByRole('switch', { name: 'Abrir com o Windows' })
  await waitFor(() => expect(launch).toBeEnabled())
  expect(launch).toHaveAttribute('aria-checked', 'false')
  await userEvent.click(launch)
  expect(api.updateSettings).toHaveBeenCalledWith({ launchAtLogin: true })
  await waitFor(() => expect(launch).toHaveAttribute('aria-checked', 'true'))
})

it('saves a new server address only when it changed', async () => {
  renderScreen()
  await userEvent.click(screen.getByRole('tab', { name: 'Servidor' }))
  const input = await screen.findByLabelText('Endereço')
  await waitFor(() => expect(input).toHaveValue('https://telae.example.com'))
  const save = screen.getAllByRole('button', { name: 'Salvar' }).at(-1)!
  expect(save).toBeDisabled()
  await userEvent.clear(input)
  await userEvent.type(input, 'https://meu-servidor.dev')
  await userEvent.click(save)
  expect(api.setSignalingUrl).toHaveBeenCalledWith('https://meu-servidor.dev')
  expect(await screen.findByRole('status')).toHaveTextContent('Reinicie o Telae')
})

it('shows who is signed in and lets the user sign out', async () => {
  const onSignOut = vi.fn()
  renderScreen(onSignOut)
  expect(screen.getByText('@ana', { selector: 'dd' })).toBeInTheDocument()
  expect(screen.getByText('ana@example.com')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Sair da conta' }))
  expect(onSignOut).toHaveBeenCalledOnce()
})

it('requires a long enough new password before changing it, and reports success', async () => {
  renderScreen()
  await userEvent.click(screen.getByRole('tab', { name: 'Segurança' }))
  const change = screen.getByRole('button', { name: 'Alterar senha' })
  await userEvent.type(screen.getByLabelText('Senha atual'), 'senha-antiga-1')
  await userEvent.type(screen.getByLabelText('Nova senha'), 'curta')
  expect(change).toBeDisabled()
  await userEvent.clear(screen.getByLabelText('Nova senha'))
  await userEvent.type(screen.getByLabelText('Nova senha'), 'uma-senha-bem-longa-42')
  await userEvent.click(change)
  expect(api.auth.changePassword).toHaveBeenCalledWith('senha-antiga-1', 'uma-senha-bem-longa-42')
  expect(await screen.findByText(/Senha trocada/)).toBeInTheDocument()
})

it('asks for the password before deleting the account and shows the server error', async () => {
  renderScreen()
  await userEvent.click(screen.getByRole('tab', { name: 'Segurança' }))
  await userEvent.click(screen.getByRole('button', { name: 'Excluir minha conta' }))
  const confirm = screen.getByRole('button', { name: 'Excluir definitivamente' })
  expect(confirm).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Confirme com sua senha'), 'errada')
  await userEvent.click(confirm)
  expect(api.auth.deleteAccount).toHaveBeenCalledWith('errada')
  expect(await screen.findByRole('alert')).toHaveTextContent('errados')
})
