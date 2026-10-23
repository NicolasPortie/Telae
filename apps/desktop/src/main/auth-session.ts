import type { AccountInfo, AuthErrorCode, AuthOutcome, RegisterOutcome } from '../shared/contracts.ts'
import { AuthError, type AuthServerClient, type ServerSession } from './auth-client.ts'

export type StoredSession = { refreshToken: string; account: AccountInfo }

/** Onde a sessão fica entre aberturas do app (cifrada com o cofre do sistema em produção). */
export type SessionStorage = {
  load(): StoredSession | null
  save(session: StoredSession): void
  clear(): void
}

/** Renova um pouco antes de expirar, para o SignalR nunca receber um token vencido. */
const RENEW_MARGIN_MS = 60_000

/**
 * Sessão de conta do processo principal: guarda o refresh token, mantém o token de acesso em memória
 * e o renova sob demanda. A interface só vê a conta; nenhum token passa por ela, exceto o de acesso, sob demanda.
 */
export class AuthSession {
  private account: AccountInfo | null = null
  private refreshToken: string | null = null
  private access: { token: string; expiresAt: number } | null = null
  private renewing: Promise<string | null> | null = null

  private readonly server: AuthServerClient
  private readonly storage: SessionStorage
  private readonly onChange: (account: AccountInfo | null) => void
  private readonly now: () => number

  constructor(
    server: AuthServerClient,
    storage: SessionStorage,
    onChange: (account: AccountInfo | null) => void,
    now: () => number = Date.now,
  ) {
    this.server = server
    this.storage = storage
    this.onChange = onChange
    this.now = now
    const stored = storage.load()
    if (stored) {
      this.account = stored.account
      this.refreshToken = stored.refreshToken
    }
  }

  getAccount(): AccountInfo | null {
    return this.account
  }

  /** Confirma a sessão guardada. Sem rede, mantém o usuário conectado localmente (a conexão falha depois, com aviso). */
  async restore(): Promise<AccountInfo | null> {
    if (!this.refreshToken) return null
    await this.getAccessToken()
    return this.account
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.refreshToken) return null
    if (this.access && this.access.expiresAt - this.now() > RENEW_MARGIN_MS) return this.access.token
    this.renewing ??= this.renew().finally(() => { this.renewing = null })
    return this.renewing
  }

  private async renew(): Promise<string | null> {
    const refreshToken = this.refreshToken
    if (!refreshToken) return null
    try {
      const session = await this.server.refresh(refreshToken)
      this.adopt(session, { notify: false })
      return session.accessToken
    } catch (error) {
      if (error instanceof AuthError && error.code === 'invalid_session') {
        this.clear()
        return null
      }
      // Rede ou servidor fora do ar: usa o token atual se ainda valer.
      return this.access && this.access.expiresAt > this.now() ? this.access.token : null
    }
  }

  private adopt(session: ServerSession, { notify }: { notify: boolean }): AccountInfo {
    const changed = notify || this.account?.id !== session.account.id || this.account?.displayName !== session.account.displayName
    this.account = session.account
    this.refreshToken = session.refreshToken
    this.access = { token: session.accessToken, expiresAt: Date.parse(session.accessTokenExpiresAt) }
    this.storage.save({ refreshToken: session.refreshToken, account: session.account })
    if (changed) this.onChange(session.account)
    return session.account
  }

  private clear() {
    this.account = null
    this.refreshToken = null
    this.access = null
    this.storage.clear()
    this.onChange(null)
  }

  // ── Operações expostas à interface ───────────────────────────────────

  private async outcome<T>(action: () => Promise<T>): Promise<AuthOutcome<T>> {
    try {
      return { ok: true, data: await action() }
    } catch (error) {
      const code: AuthErrorCode = error instanceof AuthError ? error.code : 'unknown'
      return { ok: false, code }
    }
  }

  register(input: { email: string; username: string; password: string; language: string }): Promise<AuthOutcome<RegisterOutcome>> {
    return this.outcome(async () => {
      const result = await this.server.register(input)
      const account = result.session ? this.adopt(result.session, { notify: true }) : null
      return { verificationRequired: result.verificationRequired, account }
    })
  }

  verifyEmail(identifier: string, code: string): Promise<AuthOutcome<AccountInfo>> {
    return this.outcome(async () => this.adopt(await this.server.verifyEmail(identifier, code), { notify: true }))
  }

  resendVerification(identifier: string): Promise<AuthOutcome> {
    return this.outcome(() => this.server.resendVerification(identifier))
  }

  login(identifier: string, password: string): Promise<AuthOutcome<AccountInfo>> {
    return this.outcome(async () => this.adopt(await this.server.login(identifier, password), { notify: true }))
  }

  async logout(): Promise<void> {
    const refreshToken = this.refreshToken
    this.clear()
    if (refreshToken) await this.server.logout(refreshToken).catch(() => undefined)
  }

  forgotPassword(identifier: string): Promise<AuthOutcome> {
    return this.outcome(() => this.server.forgotPassword(identifier))
  }

  resetPassword(identifier: string, code: string, newPassword: string): Promise<AuthOutcome> {
    return this.outcome(() => this.server.resetPassword(identifier, code, newPassword))
  }

  updateDisplayName(displayName: string): Promise<AuthOutcome<AccountInfo>> {
    return this.outcome(async () => {
      const token = await this.requireToken()
      const account = await this.server.updateDisplayName(token, displayName)
      this.account = account
      if (this.refreshToken) this.storage.save({ refreshToken: this.refreshToken, account })
      this.onChange(account)
      return account
    })
  }

  changePassword(currentPassword: string, newPassword: string): Promise<AuthOutcome> {
    return this.outcome(async () => {
      const token = await this.requireToken()
      // O servidor encerra as demais sessões e devolve uma nova para este dispositivo.
      this.adopt(await this.server.changePassword(token, currentPassword, newPassword), { notify: false })
    })
  }

  deleteAccount(password: string): Promise<AuthOutcome> {
    return this.outcome(async () => {
      const token = await this.requireToken()
      await this.server.deleteAccount(token, password)
      this.clear()
    })
  }

  private async requireToken(): Promise<string> {
    const token = await this.getAccessToken()
    if (!token) throw new AuthError(this.refreshToken ? 'network' : 'invalid_session')
    return token
  }
}
