import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, unlinkSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs'
import type { LocalProfile } from '../shared/contracts.ts'

export function writeJsonAtomically(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    const file = openSync(temporaryPath, 'wx', 0o600)
    try {
      writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
      fsyncSync(file)
    } finally {
      closeSync(file)
    }
    renameSync(temporaryPath, filePath)
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
  }
}

/** Cifra a credencial do dispositivo com o cofre do sistema (DPAPI no Windows). */
export type SecretCipher = {
  encrypt(plain: string): string
  /** `null` quando o texto cifrado não pode mais ser aberto (outro usuário do Windows, perfil copiado). */
  decrypt(encoded: string): string | null
}

const CREDENTIAL_PATTERN = /^[a-f0-9]{64}$/i

type StoredProfile = Partial<LocalProfile> & { deviceSecretEnc?: string }

export function readLocalProfile(filePath: string, cipher?: SecretCipher): LocalProfile {
  let parsed: StoredProfile = {}
  try { parsed = JSON.parse(readFileSync(filePath, 'utf8')) ?? {} } catch { /* Primeiro uso ou arquivo inválido. */ }
  // Perfis antigos guardam a credencial em texto; ela é migrada para o cofre no próximo salvamento.
  const secret = typeof parsed.deviceSecretEnc === 'string' && cipher ? cipher.decrypt(parsed.deviceSecretEnc) : parsed.deviceSecret
  const credentialValid = typeof secret === 'string' && CREDENTIAL_PATTERN.test(secret)
  return {
    // IDs legados são públicos: nunca aceitar que a primeira credencial reclame um deles.
    deviceId: credentialValid && typeof parsed.deviceId === 'string' && parsed.deviceId ? parsed.deviceId : randomUUID(),
    deviceSecret: credentialValid ? secret : randomBytes(32).toString('hex'),
    displayName: typeof parsed.displayName === 'string' ? parsed.displayName.trim() : '',
    friendCodes: Array.isArray(parsed.friendCodes)
      ? parsed.friendCodes.filter((code): code is string => typeof code === 'string' && /^[A-Z2-9]{6}$/.test(code)) : [],
    ...(typeof parsed.accountId === 'string' && parsed.accountId ? { accountId: parsed.accountId } : {}),
  }
}

export function writeLocalProfile(filePath: string, profile: LocalProfile, cipher?: SecretCipher): void {
  if (!cipher) return writeJsonAtomically(filePath, profile)
  const { deviceSecret, ...rest } = profile
  writeJsonAtomically(filePath, { ...rest, deviceSecretEnc: cipher.encrypt(deviceSecret) })
}
