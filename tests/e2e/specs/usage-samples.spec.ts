import { test, expect } from '../fixtures/auth'
import { DEV_ADMIN_NAMESPACE } from '../fixtures/auth'

const slug = `e2e-usage-${Date.now()}`

test.describe.configure({ mode: 'serial' })

test.describe('usage_samples billing', () => {
  test('create project and wait for it to start', async ({ authedPage: page }) => {
    await page.goto('/new')

    await page.getByLabel('Project slug').fill(slug)
    await page.getByLabel('Display name').fill('E2E Usage Test')
    await page.getByRole('button', { name: 'Create project' }).click()

    await expect(page).toHaveURL(`/${DEV_ADMIN_NAMESPACE}/${slug}`, { timeout: 10_000 })

    // Wait for the pod to become healthy
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })
  })

  test('usage_samples appear in the admin billing report after a scrape cycle', async ({
    authedPage: page,
  }) => {
    // The metrics-collector DaemonSet scrapes every 60 s (chart default). Wait
    // 130 s to guarantee at least two full scrape cycles so rows exist in
    // usage_samples for this project regardless of where the pod's creation
    // falls relative to the collector's tick schedule.
    await page.waitForTimeout(130_000)

    // The billing page auto-runs the report on load with a date range of
    // start-of-month to today, which covers the newly created project.
    await page.goto('/admin/billing')

    // Wait for the report count to appear (report has resolved)
    const reportCount = page.locator('.report-count')
    await expect(reportCount).toBeVisible({ timeout: 30_000 })

    // The project should appear in the table
    const projectLink = page.locator('a.proj-link', { hasText: slug })
    await expect(projectLink).toBeVisible()

    // At least the namespace column should show the admin namespace
    const row = page.locator('tr', { has: projectLink })
    await expect(row.locator('a.ns-link', { hasText: DEV_ADMIN_NAMESPACE })).toBeVisible()
  })

  test('delete project via settings', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}/settings`)

    await page.getByRole('button', { name: /delete/i }).click()

    const modal = page.locator('[role="dialog"]')
    await modal.getByRole('textbox').fill(slug)
    await modal.getByRole('button', { name: /delete/i }).click()

    await expect(page).toHaveURL(`/${DEV_ADMIN_NAMESPACE}`, { timeout: 15_000 })
  })
})
