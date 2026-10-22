import { expect, test } from '@playwright/test'

import {
  chooseFromMenu,
  dragCard,
  hydration,
  openPage,
  seedBoard,
  signUp,
} from './helpers'

// Archiving hides a card from the board; "Show archived" shows archived cards
// in their own list. Each test signs up a fresh user and seeds a board.

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
  const doneColumn = page.locator(
    '[data-testid="board-column"][data-column="Done"]',
  )
  const archivedColumn = page.getByRole('region', { name: 'Archived cards' })
  await expect(archivedColumn).toHaveCount(0)

  await showArchived.click()
  await expect(showArchived).toHaveAttribute('aria-pressed', 'true')
  // Shown in its own Archived list, not back in the Done column.
  await expect(archivedColumn.getByText('Ship archiving')).toBeVisible()
  await expect(doneColumn.getByText('Ship archiving')).toHaveCount(0)

  // Unarchive returns it to the Done column and empties the Archived list.
  await chooseFromMenu(
    archivedColumn.getByRole('button', { name: 'Card actions' }),
    page.getByRole('menuitem', { name: 'Unarchive' }),
  )
  await expect(doneColumn.getByText('Ship archiving')).toBeVisible()
  await expect(archivedColumn).toHaveCount(0)
  await showArchived.click()
  await expect(doneColumn.getByText('Ship archiving')).toBeVisible()
})

test('cards can be dragged into and out of the Archived column', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Board cards are dragged with a mouse')
  const { slug } = await seedBoard(page.request)
  await openPage(page, slug)

  const column = (name: string) =>
    page.locator(`[data-testid="board-column"][data-column="${name}"]`)
  const archivedColumn = page.getByRole('region', { name: 'Archived cards' })
  const card = page
    .getByTestId('board-card')
    .filter({ hasText: 'Ship archiving' })

  // Archive one card first so the Archived column exists, then show it.
  await chooseFromMenu(
    card.getByRole('button', { name: 'Card actions' }),
    page.getByRole('menuitem', { name: 'Archive', exact: true }),
  )
  await page.getByRole('button', { name: /Show archived/ }).click()
  await expect(archivedColumn.getByText('Ship archiving')).toBeVisible()

  // Dragging an archived card to "To do" unarchives it and sets the status.
  await dragCard(
    page,
    archivedColumn.getByTestId('board-card'),
    column('To do'),
  )
  await expect(column('To do').getByText('Ship archiving')).toBeVisible()
  await expect(archivedColumn).toHaveCount(0)

  // Dragging an active card onto the Archived column archives it. The column
  // only renders while it has cards, so archive "Still to do" from the menu
  // first, then drop "Ship archiving" onto it.
  const still = page
    .getByTestId('board-card')
    .filter({ hasText: 'Still to do' })
  await chooseFromMenu(
    still.getByRole('button', { name: 'Card actions' }),
    page.getByRole('menuitem', { name: 'Archive', exact: true }),
  )
  await expect(archivedColumn.getByText('Still to do')).toBeVisible()
  await dragCard(
    page,
    column('To do').getByTestId('board-card'),
    archivedColumn,
  )
  await expect(archivedColumn.getByText('Ship archiving')).toBeVisible()
  await expect(column('To do').getByTestId('board-card')).toHaveCount(0)
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
