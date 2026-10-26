import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { signedUpdateVerifier, updateSignaturePayload, verifyUpdateInstaller } from './update-signature.ts'

const keys = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const bytes = Buffer.from('test Windows installer payload')
const version = '0.3.2'
const record = { version, filename: `Telae-Setup-${version}.exe`, sha512: createHash('sha512').update(bytes).digest('base64'), size: bytes.length }
const signed = { ...record, signature: sign(null, updateSignaturePayload(record), keys.privateKey).toString('base64') }
let directory: string
let installer: string
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'telae-signature-test-'))
  installer = path.join(directory, record.filename)
  await writeFile(installer, bytes)
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

it('accepts an authentic installer signed by the pinned release key', async () => {
  await expect(verifyUpdateInstaller(publicKey, version, installer, signed)).resolves.toBeUndefined()
})
it('rejects altered installer bytes even when an attacker supplies a matching unsigned checksum', async () => {
  await writeFile(installer, Buffer.from('X'.repeat(bytes.length)))
  await expect(verifyUpdateInstaller(publicKey, version, installer, signed)).rejects.toThrow('invalid_update_hash')
  await expect(verifyUpdateInstaller(publicKey, version, installer, { ...signed, sha512: createHash('sha512').update('X'.repeat(bytes.length)).digest('base64') })).rejects.toThrow('invalid_update_signature')
})
it('rejects a signature from a different key, a different version, missing signatures and changed sizes', async () => {
  const other = generateKeyPairSync('ed25519')
  await expect(verifyUpdateInstaller(publicKey, version, installer, { ...signed, signature: sign(null, updateSignaturePayload(record), other.privateKey).toString('base64') })).rejects.toThrow()
  await expect(verifyUpdateInstaller(publicKey, '0.3.3', installer, signed)).rejects.toThrow()
  await expect(verifyUpdateInstaller(publicKey, version, installer, record)).rejects.toThrow()
  await expect(verifyUpdateInstaller(publicKey, version, installer, { ...signed, size: record.size + 1 })).rejects.toThrow()
})
it('fetches only the version-specific signature from the pinned HTTPS feed and rejects oversized documents', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(signed)))
  await signedUpdateVerifier(publicKey, 'https://updates.example.com', fetcher)(version, installer)
  expect(String(fetcher.mock.calls[0][0])).toBe('https://updates.example.com/updates/windows/Telae-Setup-0.3.2.exe.sig.json')
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  fetcher.mockResolvedValueOnce(new Response(' '.repeat(8193)))
  await expect(signedUpdateVerifier(publicKey, 'https://updates.example.com', fetcher)(version, installer)).rejects.toThrow('too_large')
})
it('verifies the actual release signing script output', async () => {
  await writeFile(path.join(directory, 'latest.yml'), `version: ${version}\nsha512: ${record.sha512}\n`)
  execFileSync(process.execPath, [path.resolve('scripts/sign-update.mjs'), directory], {
    env: { ...process.env, TELAE_UPDATE_PRIVATE_KEY_FILE: '', TELAE_UPDATE_PRIVATE_KEY: Buffer.from(keys.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'), TELAE_UPDATE_PUBLIC_KEY: publicKey },
  })
  const { readFile } = await import('node:fs/promises')
  const document = JSON.parse(await readFile(installer + '.sig.json', 'utf8'))
  await expect(verifyUpdateInstaller(publicKey, version, installer, document)).resolves.toBeUndefined()
})
