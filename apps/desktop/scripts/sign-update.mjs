import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const directory = path.resolve(process.argv[2] || 'dist')
const manifest = await readFile(path.join(directory, 'latest.yml'), 'utf8')
const version = /^version: (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\r?$/m.exec(manifest)?.[1]
if (!version) throw new Error('Invalid release version')
const pem = process.env.TELAE_UPDATE_PRIVATE_KEY_FILE
  ? await readFile(process.env.TELAE_UPDATE_PRIVATE_KEY_FILE)
  : Buffer.from(process.env.TELAE_UPDATE_PRIVATE_KEY || '', 'base64')
const key = createPrivateKey(pem)
if (key.asymmetricKeyType !== 'ed25519') throw new Error('Expected an Ed25519 release key')
const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64')
if (publicKey !== process.env.TELAE_UPDATE_PUBLIC_KEY) throw new Error('Signing key does not match the key embedded in the app')
const filename = `Telae-Setup-${version}.exe`
const installer = path.join(directory, filename)
const hash = createHash('sha512')
for await (const chunk of createReadStream(installer)) hash.update(chunk)
const sha512 = hash.digest('base64')
if (!manifest.includes(`sha512: ${sha512}`)) throw new Error('Installer does not match latest.yml')
const record = { version, filename, sha512, size: (await stat(installer)).size }
const payload = Buffer.from(JSON.stringify({ domain: 'telae/windows-update/v1', ...record }))
const signature = sign(null, payload, key).toString('base64')
await writeFile(installer + '.sig.json', JSON.stringify({ ...record, signature }) + '\n')
console.log(`Signed update ${version}; private key was not included in the installer.`)
