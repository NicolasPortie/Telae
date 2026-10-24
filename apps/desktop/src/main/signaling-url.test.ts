import { describe, expect, it } from 'vitest'
import { normalizeSignalingUrl, SignalingServerSettings } from './signaling-url.ts'
import { AuthServerClient } from './auth-client.ts'

describe('signaling URL trust boundary', () => {
  it('canonicalizes HTTPS URLs and preserves server prefixes', () => {
    expect(normalizeSignalingUrl(' HTTPS://TELAE.EXAMPLE.COM:443/app/ ')).toBe('https://telae.example.com/app')
  })

  it.each(['http://localhost:5015', 'http://127.0.0.1:5015', 'http://[::1]:5015'])('permits local development at %s', url => {
    expect(normalizeSignalingUrl(url)).toBe(url)
  })

  it.each(['http://telae.example.com', 'http://192.168.0.10:5015', 'http://localhost.attacker.com', 'http://127.0.0.1.attacker.com'])('rejects credentials over an insecure remote connection (%s)', url => {
    expect(() => normalizeSignalingUrl(url)).toThrow('Usa https://')
  })

  it.each([null, {}, 'https://user:pass@example.com', 'https://example.com?token=x', 'https://example.com#x', 'file:///app/index.html', 'https://' + 'a'.repeat(2048)])('rejects invalid server addresses (%j)', url => {
    expect(() => normalizeSignalingUrl(url)).toThrow()
  })

  it('keeps REST credentials and SignalR on the same active server until restart', async () => {
    let savedUrl = 'https://trusted.example.com'
    const settings = new SignalingServerSettings(savedUrl, url => { savedUrl = url })
    let recipient: string | undefined
    const client = new AuthServerClient(() => settings.activeUrl, async input => {
      recipient = String(input)
      return new Response('{}')
    })
    expect(settings.saveForRestart('https://attacker.example.com')).toBe('https://attacker.example.com')
    expect(savedUrl).toBe('https://attacker.example.com')
    await client.refresh('trusted-session')
    expect(recipient).toBe('https://trusted.example.com/auth/refresh')
    expect(settings.activeUrl).toBe('https://trusted.example.com')
    expect(new SignalingServerSettings(savedUrl, () => undefined).activeUrl).toBe('https://attacker.example.com')
  })
})
