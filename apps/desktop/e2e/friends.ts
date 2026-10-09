import { expect, type Page } from '@playwright/test'

/** Código de amigo exibido na Home (6 caracteres, sem ambiguidade). */
export async function friendCodeOf(page: Page): Promise<string> {
  const code = page.getByLabel('Copiar seu código de amigo').locator('xpath=preceding-sibling::span[1]')
  await expect(code).toHaveText(/^[A-Z2-9]{6}$/)
  return ((await code.textContent()) ?? '').trim()
}

/** Adiciona um amigo pelo código de 6 caracteres a partir da Home. */
export async function addFriend(page: Page, friendCode: string, displayName: string) {
  await page.getByRole('button', { name: 'Adicionar', exact: true }).first().click()
  await page.getByLabel('Código do amigo (6 caracteres)').fill(friendCode)
  await page.getByRole('button', { name: 'Adicionar', exact: true }).last().click()
  await expect(page.getByRole('status').filter({ hasText: `Amigo ${displayName} adicionado!` })).toBeVisible({ timeout: 30_000 })
}

/** Amizade mútua: cada lado adiciona o código do outro (a amizade só vale quando ambos declaram). */
export async function befriend(first: { page: Page; name: string }, second: { page: Page; name: string }) {
  const firstCode = await friendCodeOf(first.page)
  const secondCode = await friendCodeOf(second.page)
  await addFriend(first.page, secondCode, second.name)
  await addFriend(second.page, firstCode, first.name)
}

/** Assiste a um amigo que está ao vivo, pela lista da Home ou pela troca rápida no player. */
export async function watchFriend(page: Page, friendName: string) {
  const row = page.getByRole('listitem').filter({ hasText: friendName })
  await row.getByRole('button', { name: 'Assistir', exact: true }).click()
}
