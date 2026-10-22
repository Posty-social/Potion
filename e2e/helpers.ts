import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test'

// Shared e2e helpers: each test signs up a fresh user (personal workspace)
// and seeds a board through the MCP endpoint, which accepts the browser
// session cookie.

export async function signUp(request: APIRequestContext, baseURL: string) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@posty.test`
  const response = await request.post('/api/auth/sign-up/email', {
    headers: { origin: baseURL },
    data: { email, password: 'correct-horse-battery', name: 'E2E Agent' },
  })
  expect(
    response.ok(),
    `sign-up failed: HTTP ${response.status()} ${await response.text()}`,
  ).toBe(true)
}

export function mcpClient(request: APIRequestContext) {
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

export async function seedBoard(request: APIRequestContext) {
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
export function hydration(page: Page) {
  // Filter on the realtime URL: in dev, Vite's HMR socket opens earlier.
  return page.waitForEvent('websocket', (socket) =>
    socket.url().includes('/api/realtime/pages/'),
  )
}

export async function openPage(page: Page, slug: string) {
  const hydrated = hydration(page)
  await page.goto(`/p/${slug}`)
  await hydrated
}

/**
 * Open a dropdown and click one of its items, retrying the open: the dev
 * server can full-reload the page mid-test, swallowing a click.
 */
export async function chooseFromMenu(trigger: Locator, item: Locator) {
  await expect(async () => {
    if (!(await item.isVisible())) {
      await trigger.click()
    }
    await expect(item).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await item.click()
}

/**
 * Drag a card onto a column by dispatching the HTML5 drag events with a
 * shared DataTransfer. This runs the app's real dragstart/drop handlers but,
 * unlike mouse-driven dragTo, doesn't break when the board scrolls sideways.
 */
export async function dragCard(page: Page, card: Locator, target: Locator) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await card.dispatchEvent('dragstart', { dataTransfer })
  await target.dispatchEvent('dragover', { dataTransfer })
  await target.dispatchEvent('drop', { dataTransfer })
}
