import { test as base, type Page } from '@playwright/test'

export const DEV_ADMIN_NAME = 'Dev Admin'
export const DEV_ADMIN_NAMESPACE = 'dev-admin'

export async function loginAs(page: Page, displayName: string) {
  await page.goto('/auth/dev')
  await page.getByRole('button', { name: `Login as ${displayName}` }).click()
  await page.waitForURL('/')
}

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await loginAs(page, DEV_ADMIN_NAME)
    await use(page)
  },
})

export { expect } from '@playwright/test'
