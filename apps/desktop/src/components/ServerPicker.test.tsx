// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TelaeDesktopApi } from '../shared/contracts'
import { ServerPicker } from './ServerPicker'

let api: Pick<TelaeDesktopApi, 'getEnvironment' | 'setSignalingUrl'>
const environment = (signalingUrl: string) => ({ version: '1.0.0', platform: 'win32', isPackaged: true, signalingUrl })

beforeEach(() => {
  api = {
    getEnvironment: vi.fn().mockResolvedValue(environment('https://telae.example.com')),
    setSignalingUrl: vi.fn().mockImplementation(async (url: string) => environment(url)),
  }
  Object.defineProperty(window, 'telae', { value: api, configurable: true })
})
afterEach(cleanup)

it('shows which server the app uses', async () => {
  render(<ServerPicker />)
  expect(await screen.findByText('telae.example.com')).toBeInTheDocument()
})

it('saves another server before signing in', async () => {
  render(<ServerPicker />)
  await userEvent.click(await screen.findByRole('button', { name: 'Alterar' }))
  const field = screen.getByLabelText('Endereço do servidor')
  await userEvent.clear(field)
  await userEvent.type(field, 'https://meu.servidor.dev')
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  expect(api.setSignalingUrl).toHaveBeenCalledWith('https://meu.servidor.dev')
  expect(await screen.findByRole('status')).toHaveTextContent('Reinicia o Telaê')
  expect(screen.getByText('meu.servidor.dev')).toBeInTheDocument()
})

it('explains an invalid address instead of saving it', async () => {
  api.setSignalingUrl = vi.fn().mockRejectedValue(new Error('Esse endereço não parece válido.'))
  Object.defineProperty(window, 'telae', { value: api, configurable: true })
  render(<ServerPicker />)
  await userEvent.click(await screen.findByRole('button', { name: 'Alterar' }))
  await userEvent.type(screen.getByLabelText('Endereço do servidor'), 'x')
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('não parece válido')
})

it('renders nothing when the desktop API is missing', () => {
  Object.defineProperty(window, 'telae', { value: undefined, configurable: true })
  const { container } = render(<ServerPicker />)
  expect(container).toBeEmptyDOMElement()
})
