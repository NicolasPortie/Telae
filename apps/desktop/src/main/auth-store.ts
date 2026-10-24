import { readFileSync, unlinkSync } from 'node:fs'
import type { AccountInfo } from '../shared/contracts.ts'
import type { StoredSession } from './auth-session.ts'
import { writeJsonAtomically, type SecretCipher } from './profile-store.ts'

type OnDisk = { serverUrl?: string; refreshTokenEnc?: string; account?: Partial<AccountInfo> }

function isAccount(value: Partial<AccountInfo> | undefined): value is AccountInfo {
  return !!value && typeof value.id === 'string' && typeof value.username === 'string'
    && typeof value.displayName === 'string' && typeof value.email === 'string'
}

/**
 * Sessão em arquivo. O refresh token é cifrado com o cofre do sistema (DPAPI no Windows);
 * Sem cofre disponível, a sessão dura apenas até o app fechar.
 */
export function createSessionStorage(filePath: string, cipher: () => SecretCipher | undefined, serverUrl: string) {
  return {
    load(): StoredSession | null {
      let parsed: OnDisk
      try { parsed = JSON.parse(readFileSync(filePath, 'utf8')) as OnDisk } catch { return null }
      if (!cipher() || (parsed && typeof parsed === 'object' && 'refreshToken' in parsed)) {
        this.clear()
        return null
      }
      if (!parsed || parsed.serverUrl !== serverUrl) return null
      const refreshToken = typeof parsed.refreshTokenEnc === 'string' ? cipher()?.decrypt(parsed.refreshTokenEnc) : null
      if (typeof refreshToken !== 'string' || !refreshToken || !isAccount(parsed.account)) return null
      return { refreshToken, account: parsed.account }
    },
    save(session: StoredSession): void {
      const protector = cipher()
      if (!protector) {
        this.clear()
        return
      }
      writeJsonAtomically(filePath, { serverUrl, refreshTokenEnc: protector.encrypt(session.refreshToken), account: session.account })
    },
    clear(): void {
      try { unlinkSync(filePath) } catch { /* já não existe */ }
    },
  }
}
