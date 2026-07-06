import { expect, test } from '@playwright/test'

test.describe('workspace', () => {
  test('loads, edits local state, switches views, filters rows, and fails closed', async ({
    page,
  }) => {
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    const failedRequests: string[] = []

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })
    page.on('requestfailed', (request) => {
      const url = request.url()

      if (
        url.includes('/__tsd/console-pipe/sse') ||
        url.includes('/node_modules/.vite/deps/') ||
        url.startsWith('ws://') ||
        url.startsWith('https://fonts.gstatic.com/')
      ) {
        return
      }

      failedRequests.push(`${url}: ${request.failure()?.errorText ?? 'failed'}`)
    })

    await page.goto('/')

    await expect(page).toHaveURL(/\/pages\/private-workspace\?view=table/)
    await expect(
      page.locator('main').getByRole('heading', {
        name: 'Private workspace',
        level: 1,
      }),
    ).toBeVisible()
    await page.waitForTimeout(1_200)
    await expect(page.getByText('Data model and migrations')).toBeVisible()

    const firstTask = page.getByLabel('Toggle task').first()
    await firstTask.scrollIntoViewIfNeeded()
    const wasChecked = await firstTask.isChecked()
    await firstTask.click()
    await expect(firstTask).toBeChecked({ checked: !wasChecked })

    await page.getByRole('tab', { name: 'Kanban' }).click()
    await expect(page).toHaveURL(/view=kanban/)
    await expect(page.getByRole('tab', { name: 'Kanban' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByText('Remote MCP tools')).toBeVisible()

    await page.getByLabel('Filter rows by status').selectOption('Next')
    await expect(page.getByText('Filter: Next')).toBeVisible()
    await expect(page.getByText('Data model and migrations')).toHaveCount(0)
    await expect(page.getByText('Private chat import flow')).toBeVisible()

    const mcpStatus = await page.request.get('/mcp')
    expect(mcpStatus.ok()).toBe(true)
    await expect(mcpStatus.json()).resolves.toMatchObject({
      status: 'ready',
      tools: expect.arrayContaining([
        expect.objectContaining({ name: 'search_pages' }),
      ]),
    })

    const mcpSearch = await page.request.post('/mcp', {
      data: {
        jsonrpc: '2.0',
        id: 'search',
        method: 'tools/call',
        params: {
          name: 'search_pages',
          arguments: { query: 'deploy' },
        },
      },
    })
    expect(mcpSearch.ok()).toBe(true)
    await expect(mcpSearch.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          pages: [
            expect.objectContaining({
              slug: 'deployment-handoff',
            }),
          ],
        },
      },
    })

    const realtimeStatus = await page.request.get(
      '/api/realtime/pages/page_private_workspace',
    )
    expect(realtimeStatus.status()).toBe(426)
    await expect(realtimeStatus.json()).resolves.toMatchObject({
      status: 'websocket-required',
      pageId: 'page_private_workspace',
    })

    await page.goto('/pages/not-real?view=table')
    await expect(page.getByText('Page unavailable')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Nothing to show' }),
    ).toBeVisible()

    const normalConsoleErrors = consoleErrors.filter(
      (error) =>
        !error.includes(
          'Failed to load resource: the server responded with a status of 404',
        ),
    )

    expect(pageErrors).toEqual([])
    expect(normalConsoleErrors).toEqual([])
    expect(failedRequests).toEqual([])
  })
})
