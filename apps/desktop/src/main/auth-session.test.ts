import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountInfo } from '../shared/contracts.ts'
import { AuthError, AuthServerClient, type ServerSession } from './auth-client.ts'
import { AuthSession, type SessionStorage, type StoredSession } from './auth-session.ts'
import { createSessionStorage } from './auth-store.ts'
import type { SecretCipher } from './profile-store.ts'

const account: AccountInfo = { id: 'acc-1', username: 'ana', displayName: 'Ana', email: 'ana@example.com' }
const NOW = 1_800_000_000_000

function serverSession(overrides: Partial<ServerSession> = {}): ServerSession {
  return {
    accessToken: 'access-1',
    accessTokenExpiresAt: new Date(NOW + 15 * 60_000).toISOString(),
    refreshToken: 'refresh-1',
    account,
    ...overrides,
  }
}

function memoryStorage(initial: StoredSession | null = null): SessionStorage & { value: StoredSession | null } {
  const storage = {
    value: initial,
    load: () => storage.value,
    save: (session: StoredSession) => { storage.value = session },
    clear: () => { storage.value = null },
  }
  return storage
}

function harness(initial: StoredSession | null = null) {
  const server = {
    register: vi.fn(), verifyEmail: vi.fn(), resendVerification: vi.fn(), login: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    forgotPassword: vi.fn(), resetPassword: vi.fn(), updateDisplayName: vi.fn(), changePassword: vi.fn(), deleteAccount: vi.fn(),
  }
  const storage = memoryStorage(initial)
  const changes: Array<AccountInfo | null> = []
  let now = NOW
  const session = new AuthSession(server as unknown as AuthServerClient, storage, change => changes.push(change), () => now)
  return { server, storage, changes, session, advance: (ms: number) => { now += ms } }
}

describe('AuthSession', () => {
  it('signs in, stores the session and reuses the access token until it nears expiry', async () => {
    const { server, storage, changes, session, advance } = harness()
    server.login.mockResolvedValue(serverSession())
    expect(await session.login('ana', 'senha')).toEqual({ ok: true, data: account })
    expect(storage.value).toEqual({ refreshToken: 'refresh-1', account })
    expect(changes).toEqual([account])

    expect(await session.getAccessToken()).toBe('access-1')
    expect(server.refresh).not.toHaveBeenCalled()

    server.refresh.mockResolvedValue(serverSession({ accessToken: 'access-2', refreshToken: 'refresh-2' }))
    advance(15 * 60_000 - 30_000)
    expect(await session.getAccessToken()).toBe('access-2')
    expect(storage.value?.refreshToken).toBe('refresh-2')
  })

  it('shares one renewal between concurrent callers', async () => {
    const { server, session } = harness({ refreshToken: 'refresh-1', account })
    server.refresh.mockResolvedValue(serverSession({ accessToken: 'fresh' }))
    const tokens = await Promise.all([session.getAccessToken(), session.getAccessToken(), session.getAccessToken()])
    expect(tokens).toEqual(['fresh', 'fresh', 'fresh'])
    expect(server.refresh).toHaveBeenCalledTimes(1)
  })

  it('drops the session when the server rejects the refresh token', async () => {
    const { server, storage, changes, session } = harness({ refreshToken: 'stale', account })
    server.refresh.mockRejectedValue(new AuthError('invalid_session'))
    expect(await session.restore()).toBeNull()
    expect(storage.value).toBeNull()
    expect(changes).toEqual([null])
  })

  it('keeps the stored session when the server is unreachable at startup', async () => {
    const { server, storage, session } = harness({ refreshToken: 'refresh-1', account })
    server.refresh.mockRejectedValue(new AuthError('network'))
    expect(await session.restore()).toEqual(account)
    expect(storage.value).not.toBeNull()
    expect(await session.getAccessToken()).toBeNull()
  })

  it('reports server errors as codes instead of throwing', async () => {
    const { server, session } = harness()
    server.login.mockRejectedValue(new AuthError('invalid_credentials'))
    expect(await session.login('ana', 'errada')).toEqual({ ok: false, code: 'invalid_credentials' })
    server.verifyEmail.mockRejectedValue(new Error('boom'))
    expect(await session.verifyEmail('ana', '123456')).toEqual({ ok: false, code: 'unknown' })
  })

  it('registers without a session when verification is required, and with one when it is not', async () => {
    const { server, session, changes } = harness()
    server.register.mockResolvedValueOnce({ verificationRequired: true, session: null })
    expect(await session.register({ email: 'a@b.co', username: 'ana', password: 'x', language: 'pt-BR' }))
      .toEqual({ ok: true, data: { verificationRequired: true, account: null } })
    expect(changes).toEqual([])
    server.register.mockResolvedValueOnce({ verificationRequired: false, session: serverSession() })
    expect(await session.register({ email: 'a@b.co', username: 'ana', password: 'x', language: 'pt-BR' }))
      .toEqual({ ok: true, data: { verificationRequired: false, account } })
    expect(changes).toEqual([account])
  })

  it('logs out locally even when the server call fails', async () => {
    const { server, storage, changes, session } = harness({ refreshToken: 'refresh-1', account })
    server.logout.mockRejectedValue(new AuthError('network'))
    await session.logout()
    expect(storage.value).toBeNull()
    expect(changes).toEqual([null])
    expect(server.logout).toHaveBeenCalledWith('refresh-1')
    expect(await session.getAccessToken()).toBeNull()
  })

  it('updates the display name, rotates tokens on password change and clears on deletion', async () => {
    const { server, storage, changes, session } = harness()
    server.login.mockResolvedValue(serverSession())
    await session.login('ana', 'senha')

    server.updateDisplayName.mockResolvedValue({ ...account, displayName: 'Ana Souza' })
    expect(await session.updateDisplayName('Ana Souza')).toEqual({ ok: true, data: { ...account, displayName: 'Ana Souza' } })
    expect(storage.value?.account.displayName).toBe('Ana Souza')

    server.changePassword.mockResolvedValue(serverSession({ accessToken: 'access-9', refreshToken: 'refresh-9' }))
    expect(await session.changePassword('a', 'b')).toEqual({ ok: true, data: undefined })
    expect(storage.value?.refreshToken).toBe('refresh-9')

    server.deleteAccount.mockResolvedValue(undefined)
    expect(await session.deleteAccount('senha')).toEqual({ ok: true, data: undefined })
    expect(storage.value).toBeNull()
    expect(changes.at(-1)).toBeNull()
  })
})

describe('AuthServerClient', () => {
  const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status })

  it('maps known error codes, status fallbacks and network failures', async () => {
    const fetchImpl = vi.fn()
    const client = new AuthServerClient(() => 'https://telae.example.com/', fetchImpl as unknown as typeof fetch)

    fetchImpl.mockResolvedValueOnce(json(401, { code: 'invalid_credentials' }))
    await expect(client.login('a', 'b')).rejects.toMatchObject({ code: 'invalid_credentials' })
    fetchImpl.mockResolvedValueOnce(json(401))
    await expect(client.refresh('x')).rejects.toMatchObject({ code: 'invalid_session' })
    fetchImpl.mockResolvedValueOnce(json(429))
    await expect(client.login('a', 'b')).rejects.toMatchObject({ code: 'rate_limited' })
    fetchImpl.mockResolvedValueOnce(json(500, { code: 'codigo_inventado' }))
    await expect(client.login('a', 'b')).rejects.toMatchObject({ code: 'unknown' })
    fetchImpl.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(client.login('a', 'b')).rejects.toMatchObject({ code: 'network' })
  })

  it('sends JSON to the configured server and the bearer token when needed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { id: 'x' }))
    const client = new AuthServerClient(() => 'https://telae.example.com/', fetchImpl as unknown as typeof fetch)
    await client.updateDisplayName('token-1', 'Ana')
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://telae.example.com/auth/me')
    expect(init.method).toBe('PATCH')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
    expect(JSON.parse(init.body as string)).toEqual({ displayName: 'Ana' })
  })
})

describe('session storage', () => {
  const folders: string[] = []
  afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })
  const file = () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'telae-session-'))
    folders.push(folder)
    return path.join(folder, 'session.json')
  }
  const cipher: SecretCipher = {
    encrypt: plain => `enc:${[...plain].reverse().join('')}`,
    decrypt: encoded => (encoded.startsWith('enc:') ? [...encoded.slice(4)].reverse().join('') : null),
  }

  it('keeps the refresh token encrypted on disk and round-trips it', () => {
    const storage = createSessionStorage(file(), () => cipher)
    storage.save({ refreshToken: 'segredo-do-refresh', account })
    const raw = readFileSync(folders[0] + '/session.json', 'utf8')
    expect(raw).not.toContain('segredo-do-refresh')
    expect(storage.load()).toEqual({ refreshToken: 'segredo-do-refresh', account })
  })

  it('returns nothing for a missing, corrupt or undecryptable session and can clear it', () => {
    const target = file()
    const storage = createSessionStorage(target, () => cipher)
    expect(storage.load()).toBeNull()
    storage.save({ refreshToken: 'x', account })
    expect(createSessionStorage(target, () => ({ encrypt: cipher.encrypt, decrypt: () => null })).load()).toBeNull()
    storage.clear()
    expect(storage.load()).toBeNull()
    storage.clear()
  })
})
