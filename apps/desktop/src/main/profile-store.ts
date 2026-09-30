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

export function readLocalProfile(filePath: string): LocalProfile {
  let parsed: Partial<LocalProfile> = {}
  try { parsed = JSON.parse(readFileSync(filePath, 'utf8')) ?? {} } catch { /* Primeiro uso ou arquivo inválido. */ }
  const credentialValid = typeof parsed.deviceSecret === 'string' && /^[a-f0-9]{64}$/i.test(parsed.deviceSecret)
  return {
    // IDs legados são públicos: nunca aceitar que a primeira credencial reclame um deles.
    deviceId: credentialValid && typeof parsed.deviceId === 'string' && parsed.deviceId ? parsed.deviceId : randomUUID(),
    deviceSecret: credentialValid ? parsed.deviceSecret! : randomBytes(32).toString('hex'),
    displayName: typeof parsed.displayName === 'string' ? parsed.displayName.trim() : '',
    friendCodes: Array.isArray(parsed.friendCodes)
      ? parsed.friendCodes.filter((code): code is string => typeof code === 'string' && /^[A-Z2-9]{6}$/.test(code)) : [],
  }
}
