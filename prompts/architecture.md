# Architecture Prompt

Use TanStack Start on Cloudflare Workers with D1, R2, Durable Objects,
better-auth, Drizzle, TanStack Query, and shadcn/ui.

Data model:

- `page` is a tree node addressed by a stable slug unique inside the active org.
- `block` stores markdown content, type, JSON properties, fractional position,
  and optional collection linkage for database blocks.
- `collection`, `collection_row`, and `collection_view` power tables, kanban,
  calendars, galleries, and lists with JSON field definitions.
- `comment` supports page and block threads with resolved state.
- `asset` tracks private R2 objects by asset id, never raw R2 keys in page data.
- `page_permission` supports granular future overrides.
- `public_link` stores unguessable read-only share tokens with revocation.

Routing:

- Page documents live at `/pages/$pageSlug`.
- The user's active organization comes from the session, not the URL.
- View/filter/sort state lives in typed search params.
- Public pages later resolve at `/p/$token`.

Reads and writes:

- Reads go through TanStack Query factories.
- Server functions validate with Zod.
- Non-hot CRUD writes go through server functions.
- Hot collaborative edits go through the page Durable Object WebSocket path.
- Durable Object broadcasts update TanStack Query cache without blind refetching.

Realtime:

- One `PageDoc` Durable Object per page.
- WebSocket upgrades must validate session and page permissions before writes.
- The DO owns hot block/row writes and batches D1 flushes.
- Presence is ephemeral and never stored in D1.

Files:

- Browser uploads directly to R2 with presigned PUT URLs.
- Reads use short-lived presigned GET URLs.
- Worker only signs URLs and records asset rows.

MCP:

- Use Better Auth MCP/OAuth plus API keys for headless clients.
- Tools are thin wrappers around workspace server functions and DO writes.
- Tool access is always scoped to the authenticated user's active org.
