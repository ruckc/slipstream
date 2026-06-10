import { test, expect } from '../fixtures/auth'
import { DEV_ADMIN_NAMESPACE } from '../fixtures/auth'

const slug = `e2e-files-${Date.now()}`

test.describe.configure({ mode: 'serial' })

test.describe('file browser', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/auth/dev')
    await page.getByRole('button', { name: 'Login as Dev Admin' }).click()
    await page.waitForURL('/')
    await page.goto('/new')
    await page.getByLabel('Project slug').fill(slug)
    await page.getByLabel('Display name').fill('E2E Files Test')
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page).toHaveURL(`/${DEV_ADMIN_NAMESPACE}/${slug}`, { timeout: 10_000 })
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/auth/dev')
    await page.getByRole('button', { name: 'Login as Dev Admin' }).click()
    await page.waitForURL('/')
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}/settings`)
    await page.getByRole('button', { name: /delete/i }).click()
    const modal = page.locator('[role="dialog"]')
    await modal.getByRole('textbox').fill(slug)
    await modal.getByRole('button', { name: /delete/i }).click()
    await page.close()
  })

  test('create file via terminal and verify it appears in the tree', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}`)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })

    // The project auto-opens a terminal — click to focus, wait for shell prompt
    const xtermRows = page.locator('.xterm-rows')
    await expect(xtermRows).toBeVisible({ timeout: 15_000 })
    await page.locator('.xterm-screen').click()
    await expect(xtermRows).toContainText('$', { timeout: 15_000 })

    // Create a file
    await page.keyboard.type('echo "hello from playwright" > /workspace/hello.txt')
    await page.keyboard.press('Enter')

    // Wait for command to complete (prompt returns)
    await expect(xtermRows).toContainText('$', { timeout: 10_000 })

    // Refresh the file browser and wait for the file to appear
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByRole('button', { name: 'hello.txt' })).toBeVisible({ timeout: 10_000 })
  })

  test('download file via context menu', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}`)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })

    await expect(page.getByRole('button', { name: 'hello.txt' })).toBeVisible({ timeout: 15_000 })

    // Observe the podFetch download response without intercepting (preserves Auth header)
    const responsePromise = page.waitForResponse('**/fs/download**', { timeout: 10_000 })

    // Trigger download via context menu
    await page.getByRole('button', { name: 'hello.txt' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Download' }).click()

    const response = await responsePromise
    expect(response.status()).toBe(200)
    const content = await response.text()
    expect(content.trim()).toBe('hello from playwright')
  })
})
