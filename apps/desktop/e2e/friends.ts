import { expect, type Page } from '@playwright/test'

/** O @usuário da conta, como aparece no trilho de amigos (sem o @). */
export async function friendCodeOf(page: Page): Promise<string> {
  const handle = page.getByTestId('my-handle')
  await expect(handle).toHaveText(/^@[a-z0-9_]{3,20}$/, { timeout: 30_000 })
  return ((await handle.textContent()) ?? '').trim().replace(/^@/, '')
}

/** Digita o @ no formulário de adicionar amigo e envia. */
export async function submitFriend(page: Page, username: string) {
  await page.getByRole('button', { name: 'Adicionar', exact: true }).first().click()
  await page.getByLabel('@ do amigo').fill(username)
  await page.getByLabel('@ do amigo').locator('xpath=ancestor::form').getByRole('button', { name: 'Adicionar', exact: true }).click()
}

/** Adiciona um amigo pelo @usuário a partir da Home. */
export async function addFriend(page: Page, username: string, displayName: string) {
  await submitFriend(page, username)
  await expect(page.getByRole('status').filter({ hasText: `${displayName} adicionado!` })).toBeVisible({ timeout: 30_000 })
}

/** Amizade mútua: cada lado adiciona o @ do outro (a amizade só vale quando ambos adicionam). */
export async function befriend(first: { page: Page; name: string }, second: { page: Page; name: string }) {
  const firstHandle = await friendCodeOf(first.page)
  const secondHandle = await friendCodeOf(second.page)
  await addFriend(first.page, secondHandle, second.name)
  await addFriend(second.page, firstHandle, first.name)
}

/** Assiste a um amigo que está ao vivo, pela lista da Home ou pela troca rápida no player. */
export async function watchFriend(page: Page, friendName: string) {
  const row = page.getByRole('listitem').filter({ hasText: friendName })
  await row.getByRole('button', { name: 'Assistir', exact: true }).click()
}
