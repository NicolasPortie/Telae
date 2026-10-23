export type PasswordStrength = {
  /** 0 = curta demais, 1 = fraca, 2 = boa, 3 = forte. */
  score: 0 | 1 | 2 | 3
}

/**
 * Orientação visual para quem está criando a senha. Não substitui a validação do servidor,
 * que é quem decide o que é aceito (mínimo de 10 caracteres e lista de senhas óbvias).
 */
export function passwordStrength(password: string, username = ''): PasswordStrength {
  if (password.length < 10) return { score: 0 }

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(password)).length
  const unique = new Set(password).size
  const lower = password.toLowerCase()
  const handle = username.trim().toLowerCase().replace(/^@/, '')
  const weak = unique < 5 || (handle.length >= 3 && lower.includes(handle))

  let points = 1
  if (password.length >= 14) points += 1
  if (classes >= 3) points += 1
  if (weak) points = Math.min(points, 1)
  return { score: Math.min(points, 3) as 1 | 2 | 3 }
}
