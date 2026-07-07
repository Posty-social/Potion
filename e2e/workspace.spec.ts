import { expect, test } from '@playwright/test'

// Vite dev keeps an SSE/HMR connection open, so `networkidle` never settles.
// Retry the first click after a full page load until it takes effect.
async function clickUntil(
  click: () => Promise<void>,
  settled: () => Promise<void>,
) {
  await expect(async () => {
    await click()
    await settled()
  }).toPass({ timeout: 20_000 })
}

test.describe('workspace', () => {
  test('signs up and drives a Notion-style database end to end', async ({
    page,
  }) => {
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => pageErrors.push(e.message))

    const email = `e2e-${Date.now()}@example.com`

    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)

    // Register.
    const signupToggle = page.getByRole('button', { name: 'Sign up' })
    await clickUntil(
      async () => {
        if (await signupToggle.isVisible()) await signupToggle.click()
      },
      async () => {
        await expect(page.getByLabel('Name')).toBeVisible({ timeout: 1500 })
      },
    )
    await page.getByLabel('Name').fill('E2E Tester')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('supersecret123')
    await page.getByRole('button', { name: 'Create account' }).click()

    // Seeded workspace + "Tasks" database in the default Table view.
    await page.waitForURL(/\/pages\/getting-started/)
    await expect(
      page.getByRole('textbox', { name: 'Database title' }),
    ).toHaveValue('Tasks')
    await expect(page.locator('input[value="Draft the plan"]')).toBeVisible()

    // Empty starter row: typing the name creates a real row (no add button).
    await clickUntil(
      async () => {
        const ghost = page.getByRole('textbox', { name: 'New row' })
        await ghost.fill('Write tests')
        await ghost.blur()
      },
      async () => {
        await expect(page.locator('input[value="Write tests"]')).toBeVisible({
          timeout: 1500,
        })
      },
    )

    // The add-block menu offers view types (you add a Table/Board, not a
    // "Database") — the database is the storage behind them.
    await page.getByRole('button', { name: 'Add a block' }).click()
    await expect(page.getByRole('menuitem', { name: 'Board' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Calendar' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Database' })).toHaveCount(
      0,
    )
    await page.keyboard.press('Escape')

    // Open a row as a page (peek) and create a Status option inline.
    await page.getByRole('button', { name: 'Open row' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Status' }).click()
    const optionSearch = page.getByRole('textbox', {
      name: 'Search or create option',
    })
    await optionSearch.fill('Blocked')
    await optionSearch.press('Enter')
    await expect(dialog.getByText('Blocked')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // Switch to the seeded Board view; status options are columns.
    await clickUntil(
      async () => {
        await page.getByRole('button', { name: 'Board', exact: true }).click()
      },
      async () => {
        await expect(page.locator('input[value="To do"]')).toBeVisible({
          timeout: 1500,
        })
      },
    )
    await page.getByRole('button', { name: 'Add column' }).click()
    await expect(page.locator('input[value="New column"]')).toBeVisible()

    // Per-view sort control persists a sort.
    await page.getByRole('button', { name: 'Sort' }).click()
    await page.getByRole('button', { name: 'Add sort' }).click()
    await expect(page.getByRole('button', { name: /Asc|Desc/ })).toBeVisible()
    await page.keyboard.press('Escape')

    // Create a sub-page from the header and confirm the breadcrumb.
    await page.getByRole('button', { name: 'Page actions' }).click()
    await page.getByRole('menuitem', { name: 'Add sub-page' }).click()
    await page.waitForURL((url) => !url.pathname.endsWith('getting-started'))
    await expect(
      page.getByRole('link', { name: /Getting started/ }).first(),
    ).toBeVisible()

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })
})
