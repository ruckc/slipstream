import { test, expect } from '../fixtures/auth'
import { DEV_ADMIN_NAMESPACE } from '../fixtures/auth'

const slug = process.env.E2E_PROJECT_SLUG ?? `e2e-processes-${Date.now()}`

test.describe.configure({ mode: 'serial' })

test.describe('processes', () => {
  test.beforeAll(async ({ browser }) => {
    if (process.env.E2E_PROJECT_SLUG) return
    const page = await browser.newPage()
    try {
      await page.goto('/auth/dev')
      await page.getByRole('button', { name: 'Login as Dev Admin' }).click()
      await page.waitForURL('/')
      await page.goto('/new')
      await page.getByLabel('Project slug').fill(slug)
      await page.getByLabel('Display name').fill('E2E Processes Test')
      await page.getByRole('button', { name: 'Create project' }).click()
      await expect(page).toHaveURL(`/${DEV_ADMIN_NAMESPACE}/${slug}`, { timeout: 10_000 })
      await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })
    } finally {
      await page.close()
    }
  })

  test.afterAll(async ({ browser }) => {
    if (process.env.E2E_PROJECT_SLUG) return
    const page = await browser.newPage()
    try {
      await page.goto('/auth/dev')
      await page.getByRole('button', { name: 'Login as Dev Admin' }).click()
      await page.waitForURL('/')
      await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}/settings`)
      await page.getByRole('button', { name: /delete/i }).click()
      const modal = page.locator('[role="dialog"]')
      await modal.getByRole('textbox').fill(slug)
      await modal.getByRole('button', { name: /delete/i }).click()
    } finally {
      await page.close()
    }
  })

  test('open processes pane', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}`)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })

    // Open the processes pane via the toolbar button
    await page.getByRole('button', { name: 'Processes' }).click()

    // Processes pane should appear with the title and empty state
    await expect(page.getByText('Persistent Processes')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('No persistent processes running.')).toBeVisible()
  })

  test('start a long-lived process (top) and verify it appears in the list', async ({
    authedPage: page,
  }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}`)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })

    await page.getByRole('button', { name: 'Processes' }).click()
    await expect(page.getByText('Persistent Processes')).toBeVisible({ timeout: 5_000 })

    // Click "New" to open the spawn form
    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.locator('#proc-name')).toBeVisible()

    // Fill in name and command
    await page.locator('#proc-name').fill('monitor')
    await page.locator('#proc-cmd').fill('top -b -d 5')

    // Click Start
    await page.getByRole('button', { name: 'Start' }).click()

    // The form should close and the session should appear in the list
    await expect(page.locator('#proc-name')).not.toBeVisible({ timeout: 5_000 })
    await expect(page.locator('.sessions-table')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('monitor')).toBeVisible()
  })

  test('start a persistent process and verify the pin badge', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}`)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })

    await page.getByRole('button', { name: 'Processes' }).click()
    await expect(page.getByText('Persistent Processes')).toBeVisible({ timeout: 5_000 })

    await page.getByRole('button', { name: 'New' }).click()
    await page.locator('#proc-name').fill('keepalive')
    await page.locator('#proc-cmd').fill('top -b -d 10')
    await page.locator('input[type="checkbox"]').check()
    await page.getByRole('button', { name: 'Start' }).click()

    // Wait for the session to appear with the star badge
    await expect(page.locator('#proc-name')).not.toBeVisible({ timeout: 5_000 })
    const keepaliveRow = page.locator('.sessions-table tbody tr').filter({ hasText: 'keepalive' })
    await expect(keepaliveRow).toBeVisible()
    await expect(keepaliveRow.locator('.pin-badge')).toBeVisible()
  })

  test('kill a process and verify it disappears', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}`)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })

    await page.getByRole('button', { name: 'Processes' }).click()
    await expect(page.getByText('Persistent Processes')).toBeVisible({ timeout: 5_000 })

    // Find the 'monitor' session row and kill it
    const monitorRow = page.locator('.sessions-table tbody tr').filter({ hasText: 'monitor' })
    await expect(monitorRow).toBeVisible({ timeout: 5_000 })

    await monitorRow.locator('.action-btn--kill').click()

    // The row should disappear
    await expect(monitorRow).not.toBeVisible({ timeout: 5_000 })
  })

  test('unpin a persistent process removes the pin badge', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}`)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })

    await page.getByRole('button', { name: 'Processes' }).click()
    await expect(page.getByText('Persistent Processes')).toBeVisible({ timeout: 5_000 })

    const keepaliveRow = page.locator('.sessions-table tbody tr').filter({ hasText: 'keepalive' })
    await expect(keepaliveRow).toBeVisible({ timeout: 5_000 })
    await expect(keepaliveRow.locator('.pin-badge')).toBeVisible()

    // Click the unpin button
    await keepaliveRow.locator('.action-btn--unpin').click()

    // The pin badge should disappear but the session stays
    await expect(keepaliveRow.locator('.pin-badge')).not.toBeVisible({ timeout: 5_000 })
    await expect(keepaliveRow).toBeVisible()
  })
})
