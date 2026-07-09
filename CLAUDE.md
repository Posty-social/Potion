# Potion — project conventions

Stack: TanStack Start + Router + Query, Cloudflare Workers (D1/R2/DO), Better Auth, Drizzle, Tailwind v4, shadcn/ui. (Bun conventions live in the parent `../CLAUDE.md`.)

## Data fetching — use TanStack Query, never `useEffect`

**Hard rule: do NOT fetch data with `useEffect` + `useState`.** No `useEffect(() => { fetch…; setState })`, no hand-rolled `loading`/`error`/`data` state, no manual `refresh()` functions, no cancelled-flag boilerplate. If you catch yourself writing `useEffect` to load data, stop and use a query. `useEffect` is only for real synchronization with non-React systems (subscriptions, focus, timers, imperative DOM) — never for reads or writes to our own server/`authClient`.

Every read — server functions AND `authClient.*` calls — goes through TanStack Query:

- Define a **`queryOptions` factory** with a stable, parameterized key. Put the parameter in the key so cache entries are per-entity and switching refetches:
  ```ts
  function workspaceOrganizationQuery(workspaceId: string) {
    return queryOptions({
      queryKey: ['workspace', 'organization', workspaceId],
      queryFn: async () => {
        const { data, error } =
          await authClient.organization.getFullOrganization({
            query: { organizationId: workspaceId },
          })
        if (error) throw new Error(error.message ?? 'Could not load members.')
        return data
      },
    })
  }
  ```
- Read it with `useSuspenseQuery` (when a route loader has prefetched it) or `useQuery` (`isPending`/`isError`/`error`/`data`). Render a real error state — never an infinite spinner.
- **Key convention:** workspace data is namespaced under `['workspace', …]` (e.g. `['workspace','pages']`, `['workspace','page',slug]`, `['workspace','organization',id]`); auth access is `['auth','access']`. Follow the existing shape in `src/lib/workspace/functions.ts`.

### Writes = mutations, then invalidate

Use `useMutation` (or the shared `useWorkspaceMutations` hook). Drive button state from `mutation.isPending` and inline errors from `mutation.error` — not `useState` flags. After a write, `queryClient.invalidateQueries({ queryKey: […] })` the affected key instead of manually refetching. Workspace mutations invalidate `['workspace']`.

## Routing — use the router, don't reinvent it

- **Auth/redirect gating goes in `beforeLoad`**, resolving cached data via `context.queryClient.ensureQueryData(workspaceAccessQuery())` and `throw redirect(...)`. Don't gate inside components with effects.
- **Prefetch route data in `loader`** with `context.queryClient.ensureQueryData(...)`, then read it in the component with `useSuspenseQuery`. Loaders throw `notFound()` / `redirect()`; components don't refetch what the loader already loaded.
- Navigate with `useNavigate()` / `<Link>` and typed `to`/`params`. The user-facing page route is `/p/$pageSlug`.
- A full `window.location.assign('/')` reload is only for auth/workspace-context switches (Better Auth session changes) where every loader must re-read — not for ordinary in-app navigation.

## Reference implementations to copy

- Query factories + route loader/`beforeLoad`: `src/lib/workspace/functions.ts`, `src/routes/p/$pageSlug.tsx`, `src/routes/index.tsx`.
- Query + mutation-with-invalidate in a component: `src/components/workspace/workspace-settings.tsx`, `src/components/workspace/use-workspace-mutations.ts`.
- Query + `useMutation` in a route: `src/routes/accept-invitation.$invitationId.tsx`.
