import { test, expect } from '../fixtures/auth'
import { DEV_ADMIN_NAMESPACE } from '../fixtures/auth'

// Registry e2e tests require an active Harbor instance and registry.enabled=true.
// Skip the entire suite when the env var is absent so non-registry CI runs stay green.
const REGISTRY_HOST = process.env.E2E_REGISTRY_HOST
const slug = process.env.E2E_PROJECT_SLUG ?? `e2e-registry-${Date.now()}`

test.describe.configure({ mode: 'serial' })

test.describe('registry', () => {
  test.skip(!REGISTRY_HOST, 'E2E_REGISTRY_HOST is not set — skipping registry tests')

  test.beforeAll(async ({ browser }) => {
    if (process.env.E2E_PROJECT_SLUG) return
    const page = await browser.newPage()
    try {
      await page.goto('/auth/dev')
      await page.getByRole('button', { name: 'Login as Dev Admin' }).click()
      await page.waitForURL('/')
      await page.goto('/new')
      await page.getByLabel('Project slug').fill(slug)
      await page.getByLabel('Display name').fill('E2E Registry Test')
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

  test('buildkit sidecar is ready — docker buildx ls works', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}`)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })

    await page.getByRole('button', { name: 'New terminal' }).first().click()

    const dialog = page.locator('[role="dialog"]')
    if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await dialog.getByRole('button', { name: 'Start' }).click()
    }

    const activePane = page.locator('.workspace-pane--active')
    const xtermRows = activePane.locator('.xterm-rows')
    await expect(xtermRows).toBeVisible({ timeout: 15_000 })
    await expect(xtermRows).toContainText('$', { timeout: 15_000 })

    await activePane.locator('.xterm-screen').click()

    // Wait for buildkitd to be ready (sidecar may still be starting)
    await page.keyboard.type('until docker buildx ls 2>/dev/null; do sleep 2; done && echo buildx-ok')
    await page.keyboard.press('Enter')
    await expect(xtermRows).toContainText('buildx-ok', { timeout: 60_000 })
  })

  test('docker buildx build and push a hello-world image', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}`)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })

    await page.getByRole('button', { name: 'New terminal' }).first().click()

    const dialog = page.locator('[role="dialog"]')
    if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await dialog.getByRole('button', { name: 'Start' }).click()
    }

    const activePane = page.locator('.workspace-pane--active')
    const xtermRows = activePane.locator('.xterm-rows')
    await expect(xtermRows).toBeVisible({ timeout: 15_000 })
    await expect(xtermRows).toContainText('$', { timeout: 15_000 })

    await activePane.locator('.xterm-screen').click()

    // Write a minimal Dockerfile and build + push it
    const image = `${REGISTRY_HOST}/${DEV_ADMIN_NAMESPACE}/${slug}/hello:e2e`
    await page.keyboard.type(
      `mkdir -p /tmp/e2e-build && printf 'FROM scratch\\nCOPY /etc/hostname /hello\\n' > /tmp/e2e-build/Dockerfile && docker buildx build -t ${image} --push /tmp/e2e-build && echo push-ok`,
    )
    await page.keyboard.press('Enter')
    await expect(xtermRows).toContainText('push-ok', { timeout: 120_000 })
  })

  test('registry pane shows the pushed image', async ({ authedPage: page }) => {
    await page.goto(`/${DEV_ADMIN_NAMESPACE}/${slug}`)
    await expect(page.locator('.starting-overlay')).not.toBeVisible({ timeout: 120_000 })

    // Open the registry pane via the toolbar button
    await page.getByRole('button', { name: /registry/i }).first().click()

    const activePane = page.locator('.workspace-pane--active')
    // The pane should list the repository we just pushed
    await expect(activePane.locator('text=hello')).toBeVisible({ timeout: 30_000 })
    // And show the push example command
    await expect(activePane.locator('text=docker buildx build')).toBeVisible()
  })
})
