import { test, expect } from '@playwright/test'
import { loginAs, DEV_ADMIN_NAME } from '../fixtures/auth'

test.describe('dev auth', () => {
  test('shows dev login page', async ({ page }) => {
    await page.goto('/auth/dev')
    await expect(page.getByRole('heading', { name: 'Developer Login' })).toBeVisible()
    await expect(page.getByRole('button', { name: `Login as ${DEV_ADMIN_NAME}` })).toBeVisible()
  })

  test('logs in and redirects to dashboard', async ({ page }) => {
    await loginAs(page, DEV_ADMIN_NAME)
    await expect(page).toHaveURL('/')
  })

  test('logout redirects to login', async ({ page }) => {
    await loginAs(page, DEV_ADMIN_NAME)
    await page.evaluate(() =>
      fetch('/auth/logout', { method: 'POST', redirect: 'follow' })
    )
    await page.goto('/auth/login')
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
    // Confirm session is gone — navigating to a protected route redirects to login
    await page.goto('/')
    await expect(page).toHaveURL('/auth/login')
  })
})
