import { QueryClient } from '@tanstack/react-query'

export function getContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Workspace data only changes through mutations in this app, and
        // every mutation invalidates the queries it affects — so treat data
        // as fresh between navigations instead of refetching on every mount
        // and hover preload.
        staleTime: 30_000,
      },
    },
  })

  return {
    queryClient,
  }
}
export default function TanstackQueryProvider() {}
