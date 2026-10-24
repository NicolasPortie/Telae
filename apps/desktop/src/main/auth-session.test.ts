import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    expect(await session.verifyEmail('ana', '123456', 'senha')).toEqual({ ok: false, code: 'unknown' })
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

  it('cannot restore a session when a pending refresh completes after logout', async () => {
    const { server, storage, session } = harness({ refreshToken: 'refresh-1', account })
    let resolveRefresh!: (value: ServerSession) => void
    server.refresh.mockImplementation(() => new Promise<ServerSession>(resolve => { resolveRefresh = resolve }))
    server.logout.mockResolvedValue(undefined)
    const renewal = session.getAccessToken()
    await session.logout()
    resolveRefresh(serverSession({ refreshToken: 'rotated-after-logout' }))
    expect(await renewal).toBeNull()
    expect(storage.value).toBeNull()
    expect(session.getAccount()).toBeNull()
    expect(server.logout).toHaveBeenCalledWith('rotated-after-logout')
  })

  it.each(['login', 'verifyEmail', 'register', 'changePassword'] as const)('does not adopt a pending %s response after logout', async operation => {
    const { server, storage, session, changes } = harness()
    server.login.mockResolvedValue(serverSession())
    server.logout.mockResolvedValue(undefined)
    if (operation === 'changePassword') await session.login('ana', 'senha')
    let finish!: (value: unknown) => void
    server[operation].mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = operation === 'login' ? session.login('ana', 'senha')
      : operation === 'verifyEmail' ? session.verifyEmail('ana', '123456', 'senha')
      : operation === 'register' ? session.register({ email: 'ana@example.com', username: 'ana', password: 'senha', language: 'pt-BR' })
      : session.changePassword('senha', 'nova')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await session.logout()
    const late = serverSession({ refreshToken: 'late-refresh' })
    finish(operation === 'register' ? { verificationRequired: false, session: late } : late)
    expect(await pending).toEqual({ ok: false, code: 'invalid_session' })
    expect(storage.value).toBeNull()
    expect(changes.at(-1)).toBeNull()
    expect(server.logout).toHaveBeenCalledWith('late-refresh')
  })

  it('does not publish a pending profile edit after logout or erase a newer account after deletion', async () => {
    const { server, session, storage, changes } = harness()
    server.login.mockResolvedValue(serverSession())
    server.logout.mockResolvedValue(undefined)
    await session.login('ana', 'senha')
    let finishEdit!: (value: AccountInfo) => void
    server.updateDisplayName.mockImplementation(() => new Promise(resolve => { finishEdit = resolve }))
    const edit = session.updateDisplayName('Ana nova')
    await vi.waitFor(() => expect(finishEdit).toBeTypeOf('function'))
    await session.logout()
    finishEdit({ ...account, displayName: 'Ana nova' })
    expect(await edit).toEqual({ ok: false, code: 'invalid_session' })
    expect(storage.value).toBeNull()
    expect(changes.at(-1)).toBeNull()

    await session.login('ana', 'senha')
    let finishDelete!: () => void
    server.deleteAccount.mockImplementation(() => new Promise<void>(resolve => { finishDelete = resolve }))
    const deletion = session.deleteAccount('senha')
    await vi.waitFor(() => expect(finishDelete).toBeTypeOf('function'))
    const other = { ...account, id: 'other', username: 'bia' }
    server.login.mockResolvedValue(serverSession({ account: other, refreshToken: 'other-refresh' }))
    await session.login('bia', 'outra')
    finishDelete()
    expect(await deletion).toEqual({ ok: false, code: 'invalid_session' })
    expect(session.getAccount()).toEqual(other)
    expect(storage.value?.refreshToken).toBe('other-refresh')
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
    expect(init.redirect).toBe('error')
  })

  it('does not forward existing credentials when settings change to another server', async () => {
    let serverUrl = 'https://trusted.example.com'
    const fetchImpl = vi.fn().mockResolvedValue(json(200, serverSession()))
    const client = new AuthServerClient(() => serverUrl, fetchImpl as unknown as typeof fetch)
    serverUrl = 'https://attacker.example.com'
    await client.refresh('trusted-refresh-token')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://trusted.example.com/auth/refresh')
  })

  it('binds email verification to the password entered in the account flow', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, serverSession()))
    const client = new AuthServerClient(() => 'https://trusted.example.com', fetchImpl)
    await client.verifyEmail('ana@example.com', '123456', 'chosen-password')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ identifier: 'ana@example.com', code: '123456', password: 'chosen-password' })
  })

  it('rejects remote HTTP before a password or token can be sent', () => {
    const fetchImpl = vi.fn()
    expect(() => new AuthServerClient(() => 'http://remote.example.com', fetchImpl)).toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
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
    const storage = createSessionStorage(file(), () => cipher, 'https://telae.example.com')
    storage.save({ refreshToken: 'segredo-do-refresh', account })
    const raw = readFileSync(folders[0] + '/session.json', 'utf8')
    expect(raw).not.toContain('segredo-do-refresh')
    expect(storage.load()).toEqual({ refreshToken: 'segredo-do-refresh', account })
  })

  it('returns nothing for a missing, corrupt or undecryptable session and can clear it', () => {
    const target = file()
    const storage = createSessionStorage(target, () => cipher, 'https://telae.example.com')
    expect(storage.load()).toBeNull()
    storage.save({ refreshToken: 'x', account })
    expect(createSessionStorage(target, () => ({ encrypt: cipher.encrypt, decrypt: () => null }), 'https://telae.example.com').load()).toBeNull()
    storage.clear()
    expect(storage.load()).toBeNull()
    storage.clear()
  })

  it('never loads a token created for another server or an old unbound session', () => {
    const target = file()
    const storage = createSessionStorage(target, () => cipher, 'https://trusted.example.com')
    storage.save({ refreshToken: 'trusted-refresh-token', account })
    expect(createSessionStorage(target, () => cipher, 'https://attacker.example.com').load()).toBeNull()
    writeFileSync(target, JSON.stringify({ refreshTokenEnc: cipher.encrypt('old-token'), account }))
    expect(storage.load()).toBeNull()
  })

  it('never persists or loads a refresh token without an encryption vault', () => {
    const target = file()
    const storage = createSessionStorage(target, () => undefined, 'https://trusted.example.com')
    writeFileSync(target, JSON.stringify({ serverUrl: 'https://trusted.example.com', refreshToken: 'plaintext', account }))
    expect(storage.load()).toBeNull()
    storage.save({ refreshToken: 'new-secret', account })
    expect(existsSync(target)).toBe(false)
  })
})
