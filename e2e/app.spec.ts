import { expect, test } from '@playwright/test'

test('un pago incompleto queda pendiente y un pago mayor abona al capital', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Resumen del préstamo' })).toBeVisible()
  await page.getByRole('link', { name: 'Registrar pago' }).click()
  await expect(page.getByRole('heading', { name: 'Registrar pago' })).toBeVisible()

  const amount = page.getByLabel('Pago total realizado')
  await amount.fill('100000')
  await page.getByRole('button', { name: 'Revisar y guardar' }).click()
  await expect(page.getByRole('heading', { name: 'Confirmar pago' })).toBeVisible()
  await expect(page.getByText('Pendiente de esta cuota')).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()

  await amount.fill('300000')
  await page.getByRole('button', { name: 'Revisar y guardar' }).click()
  await expect(page.getByRole('heading', { name: 'Confirmar pago' })).toBeVisible()
  await expect(page.getByText('Se va a intereses')).toBeVisible()
  await expect(page.getByText('Se va a capital')).toBeVisible()
  await expect(page.getByText('Pendiente de esta cuota')).toHaveCount(0)
})
