import { createFileRoute, redirect } from '@tanstack/react-router'

import { DEFAULT_PAGE_SLUG } from '#/lib/workspace/mock-data'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({
      to: '/pages/$pageSlug',
      params: { pageSlug: DEFAULT_PAGE_SLUG },
      search: { view: 'table' },
    })
  },
})
