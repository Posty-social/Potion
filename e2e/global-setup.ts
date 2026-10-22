import { chromium, type FullConfig } from '@playwright/test'

import { openPage, seedBoard, signUp } from './helpers'

/**
 * Warm the dev server before any test runs. On a cold `vite dev`, the first
 * page loads compile the SSR and client module graphs and pre-bundle
 * dependencies; parallel workers hitting that at once intermittently get
 * half-initialised modules ("… is not a function") or a mid-test full reload.
 * Loading one real board page serially first means tests start warm.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL as string
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ baseURL })
    await signUp(page.request, baseURL)
    const { slug } = await seedBoard(page.request)
    await openPage(page, slug)
    // Let any dependency re-optimisation reload happen now, then load again
    // to confirm the page settles.
    await page.waitForTimeout(3_000)
    await openPage(page, slug)
    await page.getByTestId('board-card').first().waitFor()
  } finally {
    await browser.close()
  }
}
