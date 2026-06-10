import { test, expect } from '../fixtures/auth'
import { DEV_ADMIN_NAMESPACE } from '../fixtures/auth'

const slug = `e2e-test-${Date.now()}`

test.describe.configure({ mode: 'serial' })

test.describe('project lifecycle', () => {
  test('create project and wait for it to start', async ({ authedPage: page }) => {
    await page.goto('/new')

    await page.getByLabel('Project slug').fill(slug)
    await page.getByLabel('Display name').fill('E2E Test Project')
    await page.getByRole('button', { name: 'Create project' }).click()

    await expect(page).toHaveURL(`/${DEV_ADMIN_NAMESPACE}/${slug}`, { timeout: 10_000 })

    // Wait for starting overlay to go away (pod becomes healthy)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })
  })

  test('delete project via settings', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}/settings`)

    await page.getByRole('button', { name: /delete/i }).click()

    // Confirm deletion in the modal — type the slug and confirm
    const modal = page.locator('[role="dialog"]')
    await modal.getByRole('textbox').fill(slug)
    await modal.getByRole('button', { name: /delete/i }).click()

    await expect(page).toHaveURL(`/${DEV_ADMIN_NAMESPACE}`, { timeout: 15_000 })
  })
})
