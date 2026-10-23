import { describe, expect, it } from 'vitest'
import { passwordStrength } from './password-strength'

describe('passwordStrength', () => {
  it('treats anything under 10 characters as too short', () => {
    expect(passwordStrength('').score).toBe(0)
    expect(passwordStrength('abc123XYZ').score).toBe(0)
  })

  it('rates a plain 10-character password as weak', () => {
    expect(passwordStrength('abcdefghij').score).toBe(1)
  })

  it('improves with length and variety', () => {
    expect(passwordStrength('uma-senha-longa-42').score).toBe(3)
    expect(passwordStrength('abcdefghijklmn').score).toBe(2)
    expect(passwordStrength('Abcdefghi1').score).toBe(2)
  })

  it('caps repetitive passwords and ones that contain the username', () => {
    expect(passwordStrength('aaaaaaaaaaaaaaaaaaaa').score).toBe(1)
    expect(passwordStrength('minha-ana-senha-42', 'ana').score).toBe(1)
    expect(passwordStrength('minha-ana-senha-42', '@Ana').score).toBe(1)
  })

  it('ignores a username that is too short to be meaningful', () => {
    expect(passwordStrength('uma-senha-longa-42', 'a').score).toBe(3)
  })
})
