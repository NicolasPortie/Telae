// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AccountInfo, TelaeAuthApi } from '../shared/contracts'
import { AuthScreen } from './AuthScreen'

const account: AccountInfo = { id: 'acc-1', username: 'ana', displayName: 'ana', email: 'ana@example.com' }
let auth: { [K in 'login' | 'register' | 'verifyEmail' | 'resendVerification' | 'forgotPassword' | 'resetPassword']: ReturnType<typeof vi.fn> }

beforeEach(() => {
  auth = {
    login: vi.fn(), register: vi.fn(), verifyEmail: vi.fn(), resendVerification: vi.fn(), forgotPassword: vi.fn(), resetPassword: vi.fn(),
  }
  Object.defineProperty(window, 'telae', { value: { auth: auth as unknown as TelaeAuthApi }, configurable: true })
})
afterEach(cleanup)

const onAuthenticated = vi.fn()
const renderScreen = () => render(<AuthScreen desktopApiAvailable onAuthenticated={onAuthenticated} />)

it('signs in with email or username and hands the account to the app', async () => {
  auth.login.mockResolvedValue({ ok: true, data: account })
  renderScreen()
  const submit = screen.getByRole('button', { name: 'Entrar' })
  expect(submit).toBeDisabled()
  await userEvent.type(screen.getByLabelText('E-mail ou usuário'), 'ana')
  await userEvent.type(screen.getByLabelText('Senha'), 'uma-senha-bem-longa-42')
  await userEvent.click(submit)
  expect(auth.login).toHaveBeenCalledWith('ana', 'uma-senha-bem-longa-42')
  await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(account))
})

it('shows a translated message for a server error code', async () => {
  auth.login.mockResolvedValue({ ok: false, code: 'invalid_credentials' })
  renderScreen()
  await userEvent.type(screen.getByLabelText('E-mail ou usuário'), 'ana')
  await userEvent.type(screen.getByLabelText('Senha'), 'errada-errada-1')
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('errados')
})

it('reveals and hides the password on demand', async () => {
  renderScreen()
  const field = screen.getByLabelText('Senha')
  expect(field).toHaveAttribute('type', 'password')
  await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }))
  expect(field).toHaveAttribute('type', 'text')
  await userEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }))
  expect(field).toHaveAttribute('type', 'password')
})

it('creates an account, then confirms the email with the 6-digit code', async () => {
  auth.register.mockResolvedValue({ ok: true, data: { verificationRequired: true, account: null } })
  auth.verifyEmail.mockResolvedValue({ ok: true, data: account })
  renderScreen()
  await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
  const create = screen.getByRole('button', { name: 'Criar conta' })
  expect(create).toBeDisabled()
  await userEvent.type(screen.getByLabelText('E-mail'), 'ana@example.com')
  await userEvent.type(screen.getByLabelText('Nome de usuário'), 'Ana')
  await userEvent.type(screen.getByLabelText('Senha'), 'uma-senha-bem-longa-42')
  await userEvent.click(create)
  expect(auth.register).toHaveBeenCalledWith({ email: 'ana@example.com', username: 'ana', password: 'uma-senha-bem-longa-42', language: 'pt-BR' })

  expect(await screen.findByRole('heading', { name: 'Olha seu e-mail' })).toBeInTheDocument()
  const confirm = screen.getByRole('button', { name: 'Confirmar' })
  expect(confirm).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Código'), '12a3456')
  expect(screen.getByLabelText('Código')).toHaveValue('123456')
  await userEvent.click(confirm)
  expect(auth.verifyEmail).toHaveBeenCalledWith('ana@example.com', '123456')
  await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(account))
})

it('goes to email confirmation when signing in with an unverified account', async () => {
  auth.login.mockResolvedValue({ ok: false, code: 'email_not_verified' })
  renderScreen()
  await userEvent.type(screen.getByLabelText('E-mail ou usuário'), 'ana@example.com')
  await userEvent.type(screen.getByLabelText('Senha'), 'uma-senha-bem-longa-42')
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
  expect(await screen.findByRole('heading', { name: 'Olha seu e-mail' })).toBeInTheDocument()
})

it('recovers a password with the emailed code', async () => {
  auth.forgotPassword.mockResolvedValue({ ok: true, data: undefined })
  auth.resetPassword.mockResolvedValue({ ok: true, data: undefined })
  renderScreen()
  await userEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }))
  await userEvent.type(screen.getByLabelText('E-mail ou usuário'), 'ana')
  await userEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
  expect(auth.forgotPassword).toHaveBeenCalledWith('ana')

  expect(await screen.findByRole('heading', { name: 'Senha nova' })).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Código'), '654321')
  await userEvent.type(screen.getByLabelText('Nova senha'), 'outra-senha-bem-longa-7')
  await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
  expect(auth.resetPassword).toHaveBeenCalledWith('ana', '654321', 'outra-senha-bem-longa-7')
  expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Senha trocada')
})

it('limits resending the code with a countdown', async () => {
  auth.register.mockResolvedValue({ ok: true, data: { verificationRequired: true, account: null } })
  renderScreen()
  await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
  await userEvent.type(screen.getByLabelText('E-mail'), 'ana@example.com')
  await userEvent.type(screen.getByLabelText('Nome de usuário'), 'ana')
  await userEvent.type(screen.getByLabelText('Senha'), 'uma-senha-bem-longa-42')
  await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
  expect(await screen.findByRole('button', { name: /Reenviar código em \d+s/ })).toBeDisabled()
})
