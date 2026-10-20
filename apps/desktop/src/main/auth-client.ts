import type { AccountInfo, AuthErrorCode } from '../shared/contracts.ts'

export class AuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode) {
    super(code)
    this.code = code
  }
}

export type ServerSession = {
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  account: AccountInfo
}

type RegisterResponse = { verificationRequired: boolean; session: ServerSession | null }

const KNOWN_CODES = new Set<string>([
  'invalid_credentials', 'email_not_verified', 'invalid_code', 'weak_password', 'invalid_username', 'username_reserved',
  'username_taken', 'invalid_email', 'email_taken', 'account_locked', 'code_cooldown', 'rate_limited', 'email_unavailable',
  'invalid_session', 'invalid_display_name',
])

const REQUEST_TIMEOUT_MS = 15_000

/** Chamadas REST de conta ao servidor. Feitas pelo processo principal para que tokens nunca passem pela interface. */
export class AuthServerClient {
  private readonly baseUrl: () => string
  private readonly fetchImpl: typeof fetch

  constructor(baseUrl: () => string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl
    this.fetchImpl = fetchImpl
  }

  private async request<T>(method: string, path: string, body?: unknown, accessToken?: string): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl().replace(/\/+$/, '')}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new AuthError('network')
    }
    if (response.status === 204) return undefined as T

    let payload: unknown
    try { payload = JSON.parse(await response.text()) } catch { payload = undefined }
    if (!response.ok) {
      const code = (payload as { code?: unknown } | undefined)?.code
      if (typeof code === 'string' && KNOWN_CODES.has(code)) throw new AuthError(code as AuthErrorCode)
      if (response.status === 401) throw new AuthError('invalid_session')
      throw new AuthError(response.status === 429 ? 'rate_limited' : 'unknown')
    }
    return payload as T
  }

  register(input: { email: string; username: string; password: string; language: string }) {
    return this.request<RegisterResponse>('POST', '/auth/register', input)
  }

  verifyEmail(identifier: string, code: string) {
    return this.request<ServerSession>('POST', '/auth/verify-email', { identifier, code })
  }

  resendVerification(identifier: string) {
    return this.request<void>('POST', '/auth/resend-verification', { identifier })
  }

  login(identifier: string, password: string) {
    return this.request<ServerSession>('POST', '/auth/login', { identifier, password })
  }

  refresh(refreshToken: string) {
    return this.request<ServerSession>('POST', '/auth/refresh', { refreshToken })
  }

  logout(refreshToken: string) {
    return this.request<void>('POST', '/auth/logout', { refreshToken })
  }

  forgotPassword(identifier: string) {
    return this.request<void>('POST', '/auth/forgot-password', { identifier })
  }

  resetPassword(identifier: string, code: string, newPassword: string) {
    return this.request<void>('POST', '/auth/reset-password', { identifier, code, newPassword })
  }

  updateDisplayName(accessToken: string, displayName: string) {
    return this.request<AccountInfo>('PATCH', '/auth/me', { displayName }, accessToken)
  }

  changePassword(accessToken: string, currentPassword: string, newPassword: string) {
    return this.request<ServerSession>('POST', '/auth/change-password', { currentPassword, newPassword }, accessToken)
  }

  deleteAccount(accessToken: string, password: string) {
    return this.request<void>('POST', '/auth/delete-account', { password }, accessToken)
  }
}
