import { expect, type Page } from '@playwright/test'

const PASSWORD = 'e2e-senha-bem-longa-42'

function uniqueUsername(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'user'
  const random = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  return `${base}_${random}`.slice(0, 20)
}

/**
 * Cria uma conta pela interface e define o nome de exibição. O servidor de teste dispensa o código por e-mail
 * (`Auth__RequireEmailVerification=false`), então o cadastro já entra na tela inicial.
 */
export async function signUp(page: Page, displayName: string): Promise<{ username: string; password: string }> {
  const username = uniqueUsername(displayName)
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await page.getByLabel('E-mail', { exact: true }).fill(`${username}@e2e.test`)
  await page.getByLabel('Nome de usuário').fill(username)
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 })

  // O nome de exibição começa igual ao usuário; os testes usam nomes legíveis.
  await page.getByRole('button', { name: 'Abrir configurações' }).click()
  await page.getByLabel('Nome de exibição').fill(displayName)
  await page.getByRole('button', { name: 'Salvar', exact: true }).first().click()
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 })
  return { username, password: PASSWORD }
}
