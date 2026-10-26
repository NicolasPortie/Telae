import { createHash, createPublicKey, verify } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

export type UpdateSignature = { version: string; filename: string; sha512: string; size: number; signature: string }
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function updateSignaturePayload(record: Omit<UpdateSignature, 'signature'>): Buffer {
  return Buffer.from(JSON.stringify({ domain: 'telae/windows-update/v1', version: record.version, filename: record.filename, sha512: record.sha512, size: record.size }))
}

export async function verifyUpdateInstaller(publicKey: string, version: string, filename: string, document: unknown): Promise<void> {
  if (!VERSION.test(version) || !document || typeof document !== 'object') throw new Error('invalid_update_signature')
  const record = document as UpdateSignature
  if (record.version !== version || record.filename !== `Telae-Setup-${version}.exe` ||
      typeof record.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(record.sha512) ||
      typeof record.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(record.signature) ||
      !Number.isSafeInteger(record.size) || record.size <= 0 || record.size > 1024 * 1024 * 1024) throw new Error('invalid_update_signature')
  const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), type: 'spki', format: 'der' })
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, updateSignaturePayload(record), key, Buffer.from(record.signature, 'base64'))) {
    throw new Error('invalid_update_signature')
  }
  if ((await stat(filename)).size !== record.size) throw new Error('invalid_update_size')
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  if (hash.digest('base64') !== record.sha512) throw new Error('invalid_update_hash')
}

export function signedUpdateVerifier(publicKey: string, serverUrl: string, fetchSignature: typeof fetch): (version: string, filename: string) => Promise<void> {
  const server = new URL(serverUrl)
  if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash) throw new Error('invalid_update_feed')
  const feed = new URL('updates/windows/', server.toString().replace(/\/+$/, '') + '/')
  return async (version, filename) => {
    if (!VERSION.test(version)) throw new Error('invalid_update_version')
    const response = await fetchSignature(new URL(`Telae-Setup-${version}.exe.sig.json`, feed), { redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok || !response.body) throw new Error('update_signature_unavailable')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 8192) throw new Error('update_signature_too_large')
        chunks.push(value)
      }
    } finally { await reader.cancel() }
    await verifyUpdateInstaller(publicKey, version, filename, JSON.parse(Buffer.concat(chunks).toString('utf8')))
  }
}
