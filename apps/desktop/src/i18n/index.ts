import { en } from './en.ts'

/** Idiomas disponíveis. O texto-fonte do código é pt-BR; os demais idiomas traduzem esse texto. */
export type Locale = 'pt-BR' | 'en'
export type Language = Locale | 'auto'

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'en', label: 'English' },
  { value: 'auto', label: 'Automático / Automatic' },
]

const catalogs: Record<Locale, Record<string, string> | null> = { 'pt-BR': null, en }

let current: Locale = 'pt-BR'
const listeners = new Set<() => void>()

/** `auto` segue o idioma do sistema: português para `pt*`, inglês para o resto. */
export function resolveLocale(language: Language | undefined, systemLocale: string | undefined): Locale {
  if (language === 'pt-BR' || language === 'en') return language
  if (language !== 'auto' || !systemLocale) return 'pt-BR'
  return systemLocale?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'
}

export function getLocale(): Locale {
  return current
}

export function setLocale(locale: Locale): void {
  if (locale === current) return
  current = locale
  for (const listener of listeners) listener()
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/** Traduz um texto escrito em pt-BR. Sem tradução, devolve o próprio texto. */
export function t(source: string, params?: Record<string, string | number>): string {
  return interpolate(catalogs[current]?.[source] ?? source, params)
}

/** Singular ou plural conforme `count`; o texto recebe `{count}`. */
export function tn(one: string, other: string, count: number): string {
  return t(count === 1 ? one : other, { count })
}

/** Etiqueta BCP 47 para formatar números e datas. */
export function numberLocale(): string {
  return current === 'en' ? 'en-US' : 'pt-BR'
}
