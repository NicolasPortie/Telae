import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readLocalProfile, writeJsonAtomically, writeLocalProfile, type SecretCipher } from './profile-store.ts'

const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })
function profilePath() {
  const folder = mkdtempSync(path.join(tmpdir(), 'telae-profile-test-'))
  folders.push(folder)
  return path.join(folder, 'profile.json')
}

it('rotates legacy public identity while preserving name and friends', () => {
  const file = profilePath()
  writeFileSync(file, JSON.stringify({ deviceId: 'legacy', displayName: 'Nicolas', friendCodes: ['ABC234'] }))
  const profile = readLocalProfile(file)
  expect(profile.deviceId).not.toBe('legacy')
  expect(profile.deviceSecret).toMatch(/^[a-f0-9]{64}$/)
  expect(profile).toMatchObject({ displayName: 'Nicolas', friendCodes: ['ABC234'] })
  writeJsonAtomically(file, profile)
  expect(readLocalProfile(file)).toEqual(profile)
  expect(readdirSync(path.dirname(file))).toEqual(['profile.json'])
})

it('preserves the existing file if serialization fails before atomic replacement', () => {
  const file = profilePath()
  writeJsonAtomically(file, { displayName: 'original' })
  const circular: Record<string, unknown> = {}
  circular.self = circular
  expect(() => writeJsonAtomically(file, circular)).toThrow()
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ displayName: 'original' })
  expect(readdirSync(path.dirname(file))).toEqual(['profile.json'])
})

const reversingCipher: SecretCipher = {
  encrypt: plain => `enc:${[...plain].reverse().join('')}`,
  decrypt: encoded => (encoded.startsWith('enc:') ? [...encoded.slice(4)].reverse().join('') : null),
}

it('keeps the device credential out of the file when a cipher is available and round-trips it', () => {
  const file = profilePath()
  const profile = readLocalProfile(file, reversingCipher)
  writeLocalProfile(file, { ...profile, displayName: 'Ana' }, reversingCipher)
  const onDisk = readFileSync(file, 'utf8')
  expect(onDisk).not.toContain(profile.deviceSecret)
  expect(onDisk).toContain('deviceSecretEnc')
  expect(readLocalProfile(file, reversingCipher)).toEqual({ ...profile, displayName: 'Ana' })
})

it('migrates a plaintext credential into the cipher without changing identity', () => {
  const file = profilePath()
  const plain = readLocalProfile(file)
  writeLocalProfile(file, plain)
  const migrated = readLocalProfile(file, reversingCipher)
  expect(migrated.deviceId).toBe(plain.deviceId)
  writeLocalProfile(file, migrated, reversingCipher)
  expect(readFileSync(file, 'utf8')).not.toContain(plain.deviceSecret)
  expect(readLocalProfile(file, reversingCipher).deviceId).toBe(plain.deviceId)
})

it('rotates identity when the encrypted credential can no longer be opened', () => {
  const file = profilePath()
  const profile = readLocalProfile(file, reversingCipher)
  writeLocalProfile(file, profile, reversingCipher)
  const locked: SecretCipher = { encrypt: reversingCipher.encrypt, decrypt: () => null }
  expect(readLocalProfile(file, locked).deviceId).not.toBe(profile.deviceId)
})
