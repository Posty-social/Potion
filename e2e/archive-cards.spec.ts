import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test'

// Archiving hides a card from the board; "Show archived" brings it back.
// Each test signs up a fresh user (personal workspace) and seeds a board
// through the MCP endpoint, which accepts the browser session cookie.

async function signUp(request: APIRequestContext, baseURL: string) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@posty.test`
  const response = await request.post('/api/auth/sign-up/email', {
    headers: { origin: baseURL },
    data: { email, password: 'correct-horse-battery', name: 'E2E Agent' },
  })
  expect(response.ok()).toBe(true)
}

function mcpClient(request: APIRequestContext) {
  let id = 0
  return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const response = await request.post('/mcp', {
      data: {
        jsonrpc: '2.0',
        id: ++id,
        method: 'tools/call',
        params: { name, arguments: args },
      },
    })
    const body = (await response.json()) as {
      result?: { structuredContent: T }
      error?: { message: string }
    }
    if (!body.result) {
      throw new Error(`${name} failed: ${body.error?.message}`)
    }
    return body.result.structuredContent
  }
}

async function seedBoard(request: APIRequestContext) {
  const mcp = mcpClient(request)
  const { page } = await mcp<{ page: { id: string; slug: string } }>(
    'create_page',
    { title: 'Archive e2e' },
  )
  const { block } = await mcp<{ block: { databaseId: string } }>(
    'append_block',
    {
      pageId: page.id,
      type: 'database',
      databaseTitle: 'Posty To Do',
      initialView: 'board',
    },
  )
  await mcp('add_row', {
    databaseId: block.databaseId,
    values: { Name: 'Ship archiving', Status: 'Done' },
  })
  await mcp('add_row', {
    databaseId: block.databaseId,
    values: { Name: 'Still to do', Status: 'To do' },
  })
  return { slug: page.slug, databaseId: block.databaseId, mcp }
}

/**
 * Open a page and wait for hydration: server-rendered buttons are clickable
 * before React attaches handlers. The page's realtime WebSocket is opened from
 * an effect, so its connection means the app is interactive.
 */
function hydration(page: Page) {
  // Filter on the realtime URL: in dev, Vite's HMR socket opens earlier.
  return page.waitForEvent('websocket', (socket) =>
    socket.url().includes('/api/realtime/pages/'),
  )
}

async function openPage(page: Page, slug: string) {
  const hydrated = hydration(page)
  await page.goto(`/p/${slug}`)
  await hydrated
}

/**
 * Open a dropdown and click one of its items, retrying the open: the dev
 * server can full-reload the page mid-test, swallowing a click.
 */
async function chooseFromMenu(trigger: Locator, item: Locator) {
  await expect(async () => {
    if (!(await item.isVisible())) {
      await trigger.click()
    }
    await expect(item).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await item.click()
}

test.beforeEach(async ({ page, baseURL }) => {
  await signUp(page.request, baseURL as string)
})

test('archiving hides a card and "Show archived" brings it back', async ({
  page,
}) => {
  const { slug } = await seedBoard(page.request)
  await openPage(page, slug)

  const cards = page.getByTestId('board-card')
  const card = cards.filter({ hasText: 'Ship archiving' })
  await expect(card).toBeVisible()

  await chooseFromMenu(
    card.getByRole('button', { name: 'Card actions' }),
    page.getByRole('menuitem', { name: 'Archive', exact: true }),
  )

  await expect(card).toHaveCount(0)
  await expect(cards.filter({ hasText: 'Still to do' })).toBeVisible()

  // Archiving is persisted server-side, not just hidden in this tab.
  const rehydrated = hydration(page)
  await page.reload()
  await rehydrated
  await expect(cards.filter({ hasText: 'Still to do' })).toBeVisible()
  await expect(card).toHaveCount(0)

  const showArchived = page.getByRole('button', { name: /Show archived/ })
  await showArchived.click()
  await expect(showArchived).toHaveAttribute('aria-pressed', 'true')
  await expect(card).toBeVisible()
  await expect(card.getByText('Archived')).toBeVisible()

  // Unarchive restores it as a normal card, visible with the toggle off.
  await chooseFromMenu(
    card.getByRole('button', { name: 'Card actions' }),
    page.getByRole('menuitem', { name: 'Unarchive' }),
  )
  await expect(card.getByText('Archived')).toHaveCount(0)
  await showArchived.click()
  await expect(card).toBeVisible()
})

test('a card can be archived from its side panel', async ({ page }) => {
  const { slug } = await seedBoard(page.request)
  await openPage(page, slug)

  const card = page.getByTestId('board-card').filter({ hasText: 'Still to do' })
  await card.getByRole('button', { name: 'Still to do' }).click()

  const panel = page.getByRole('dialog')
  await panel.getByRole('button', { name: 'Archive' }).click()
  await expect(panel.getByText('This card is archived')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Unarchive' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
})

test('a column option added over MCP shows up live with its colour', async ({
  page,
}) => {
  const { slug, databaseId, mcp } = await seedBoard(page.request)
  await openPage(page, slug)

  const columns = page.getByRole('textbox', { name: 'Rename column' })
  await expect(columns).toHaveCount(3)

  const { database } = await mcp<{
    database: { properties: Array<{ id: string; type: string }> }
  }>('read_database', { databaseId })
  const status = database.properties.find((p) => p.type === 'status')
  await mcp('add_database_option', {
    databaseId,
    propertyId: status?.id,
    name: 'In review',
    color: 'purple',
  })

  // No reload: the realtime doc:update refetches the page.
  await expect(columns).toHaveCount(4)
  await expect(columns.nth(3)).toHaveValue('In review')
  // The colour dot sits right before the column name input.
  const dot = columns.nth(3).locator('xpath=preceding-sibling::span[1]')
  await expect(dot).toHaveCSS('background-color', 'rgb(234, 223, 240)')
})
