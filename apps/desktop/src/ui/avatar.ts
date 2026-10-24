import { getLocale } from '../i18n'

// Fundos escuros com matiz próprio: cada pessoa ganha uma cor estável, sem competir com o lima da marca.
const TONES = ['#1D4A35', '#2E3F66', '#5B3426', '#1F4F5C', '#4D4319', '#4A2D52', '#3D2F24', '#24463F']

export function avatarInitial(name: string) {
  return name.trim().slice(0, 1).toLocaleUpperCase(getLocale()) || '?'
}

/** Cor do avatar derivada do nome, igual em todas as telas. */
export function avatarTone(name: string) {
  let hash = 0
  for (const char of name.trim().toLocaleLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) | 0
  return TONES[Math.abs(hash) % TONES.length]
}
