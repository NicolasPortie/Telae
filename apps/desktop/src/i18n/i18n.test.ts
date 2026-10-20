import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { en } from './en.ts'
import { getLocale, resolveLocale, setLocale, t, tn } from './index.ts'

const SRC = path.resolve(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === 'i18n' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

const QUOTE = String.fromCharCode(39)
const DOUBLE = String.fromCharCode(34)
const BACKTICK = String.fromCharCode(96)

/** Lê um literal de string em `text` a partir de `start`; devolve o conteúdo e a posição seguinte. */
function readLiteral(text: string, start: number): { value: string; end: number } | null {
  const quote = text[start]
  if (quote !== QUOTE && quote !== DOUBLE && quote !== BACKTICK) return null
  let value = ''
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index]
    if (char === '\\') { value += text[index + 1]; index++; continue }
    if (char === quote) return { value, end: index + 1 }
    if (quote === BACKTICK && char === '$' && text[index + 1] === '{') return null
    value += char
  }
  return null
}

/** Textos-fonte passados a t() e tn() como literais. */
function usedKeys(): Map<string, string> {
  const found = new Map<string, string>()
  const call = /(?<![\w.])(tn?)\(\s*/g
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(call)) {
      const first = readLiteral(text, match.index + match[0].length)
      if (!first) continue
      found.set(first.value, path.relative(SRC, file))
      if (match[1] === 'tn') {
        const comma = /^\s*,\s*/.exec(text.slice(first.end))
        const second = comma ? readLiteral(text, first.end + comma[0].length) : null
        if (second) found.set(second.value, path.relative(SRC, file))
      }
    }
  }
  // Mensagens de domínio do servidor (TelaeDomainException) chegam ao cliente como texto e são traduzidas pelo catálogo.
  const serverDir = path.resolve(SRC, '../../server')
  const pattern = /TelaeDomainException\(\s*"[a-z_]+",\s*\$?"((?:[^"\\]|\\.)*)"/g
  for (const file of csFiles(serverDir)) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
      // O único texto interpolado é o limite de espectadores, que o cliente recebe já com o número.
      found.set(match[1].replace('{MaxViewersPerSession}', '12'), path.relative(serverDir, file))
    }
  }
  return found
}

function csFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    if (name === 'bin' || name === 'obj') return []
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return csFiles(full)
    return name.endsWith('.cs') ? [full] : []
  })
}

afterEach(() => setLocale('pt-BR'))

describe('i18n', () => {
  it('returns the source text for pt-BR and interpolates parameters', () => {
    expect(t('Olá, {name}.', { name: 'Ana' })).toBe('Olá, Ana.')
  })

  it('translates to English and falls back to the source text', () => {
    setLocale('en')
    expect(t('Salvar')).toBe('Save')
    expect(t('Texto sem tradução {n}', { n: 2 })).toBe('Texto sem tradução 2')
  })

  it('picks singular or plural', () => {
    setLocale('en')
    expect(tn('{count} pessoa assistindo', '{count} pessoas assistindo', 1)).toBe('1 person watching')
    expect(tn('{count} pessoa assistindo', '{count} pessoas assistindo', 3)).toBe('3 people watching')
  })

  it('resolves the automatic language from the system locale', () => {
    expect(resolveLocale('auto', 'pt-BR')).toBe('pt-BR')
    expect(resolveLocale('auto', 'en-US')).toBe('en')
    expect(resolveLocale(undefined, 'de-DE')).toBe('en')
    expect(resolveLocale('en', 'pt-BR')).toBe('en')
    expect(getLocale()).toBe('pt-BR')
  })

  it('has an English translation for every text used in the code, and no stale ones', () => {
    const used = usedKeys()
    const missing = [...used].filter(([key]) => !(key in en)).map(([key, file]) => `${file}: ${key}`)
    expect(missing).toEqual([])
    const unused = Object.keys(en).filter(key => !used.has(key))
    expect(unused).toEqual([])
  })
})
