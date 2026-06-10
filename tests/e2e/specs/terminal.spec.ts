import { test, expect } from '../fixtures/auth'
import { DEV_ADMIN_NAMESPACE } from '../fixtures/auth'

const slug = process.env.E2E_PROJECT_SLUG ?? 'e2e-terminal-test'

test.describe.configure({ mode: 'serial' })

test.describe('terminal', () => {
  test.beforeAll(async ({ browser }) => {
    if (process.env.E2E_PROJECT_SLUG) return
    const page = await browser.newPage()
    await page.goto('/auth/dev')
    await page.getByRole('button', { name: 'Login as Dev Admin' }).click()
    await page.waitForURL('/')
    await page.goto('/new')
    await page.getByLabel('Project slug').fill(slug)
    await page.getByLabel('Display name').fill('E2E Terminal Test')
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page).toHaveURL(`/${DEV_ADMIN_NAMESPACE}/${slug}`, { timeout: 10_000 })
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    if (process.env.E2E_PROJECT_SLUG) return
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

  test('open terminal, run a command, and see output', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}`)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })

    // Open a new terminal session (WorkspaceGroup "New terminal" button, always visible in the tab bar)
    await page.getByRole('button', { name: 'New terminal' }).first().click()

    // Wait for the active terminal pane to render xterm and show a shell prompt
    const activePane = page.locator('.workspace-pane--active')
    const xtermRows = activePane.locator('.xterm-rows')
    await expect(xtermRows).toBeVisible({ timeout: 15_000 })
    await expect(xtermRows).toContainText('$', { timeout: 15_000 })

    // Click the active pane to ensure keyboard focus lands on the terminal
    await activePane.click({ force: true })

    // Type a command and press Enter
    await page.keyboard.type('echo playwright-ok')
    await page.keyboard.press('Enter')

    // xterm.js renders output as text nodes inside .xterm-rows spans
    await expect(xtermRows).toContainText('playwright-ok', { timeout: 15_000 })
  })
})
