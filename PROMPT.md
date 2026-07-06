# Cloudflare Notion clone

Your job is to build a realtime notion clone that runs on Cloudflare workers, D1, R2 & Durable objects. Carefully consider how the data is structured so as requirements expand, so can the implementation of those requirements. The goal is to create a notion clone that does most of what Notion does.

Find relevant skills in .agents/skills

## Dependencies to add

Packages this plan relies on that aren't installed yet:

- `aws4fetch` — sign R2 presigned GET/PUT URLs from the Worker
- `@modelcontextprotocol/sdk` — MCP server transport + tools
- `@pulumi/pulumi`, `@pulumi/cloudflare` — infrastructure-as-code for deploy (CI/dev)
- _(optional)_ `yjs` — only if adopting CRDT for character-level co-editing

Already present: `drizzle-orm` + `drizzle-kit`, and `zod` (make it a direct
dependency — it's used app-wide). better-auth's `organization` / `mcp` / `apiKey`
plugins ship with better-auth, so no separate install. Durable Objects are part of
the Workers runtime (no package).

## Schemas

- All inputs and outputs to server functions should have Zod schemas that validate them
- Schemas should be validated in the validate portion of the server function, not inside the function

```typescript
const createPageSchema = z.object({
  organizationId: z.string(),
  parentPageId: z.string().nullable().optional(),
  title: z.string().max(500),
})
```

## Functions

- Use Tanstack Router createServerFn where possible, avoid creating REST API endpoints. Make sure all functions have the correct logging, auth and schema validation middleware.
- **Logging**: a logging middleware emits one structured **wide/canonical event
  per request** (requestId, userId, orgId, route, input summary, outcome,
  duration) so requests are debuggable and queryable via Workers observability.

```typescript
export const createPage = createServerFn({ method: 'POST' })
  .middleware([requireOrgMember])
  .inputValidator(createPageSchema)
  .handler(async ({ context, data }) => {})
```

## Routing

- Use TanStack Router file-based routing properly — the URL is the source of truth
  for what's on screen, so any state that should survive a refresh or be shareable
  via a link lives in the URL, not in component state or context.
- **Resource identifiers go in the path.** Pages are addressed by slug, e.g.
  `/pages/$pageSlug`, read with `Route.useParams()`. There is **no org segment
  in the URL** — a user always has an active organization (from the better-auth
  session), and slugs are unique per org, so the slug is resolved against
  `(activeOrganizationId, slug)`. Public share links resolve via `/p/$token`
  with no session required.
- **Filters, sorts, view selection, and options go in typed search params**
  (query string) so refreshing keeps state and links reproduce it exactly — e.g.
  `/pages/$pageSlug?view=kanban&groupBy=status&filter=...&sort=due:desc`.
- Validate every route's search params with `validateSearch` using a Zod schema
  (consistent with the Schemas section); read them with `Route.useSearch()`.
- Navigate/update filters with the typed `<Link>` / `navigate({ search })` and
  functional updates — never hand-build query strings:

```typescript
export const Route = createFileRoute('/pages/$pageSlug')({
  validateSearch: z.object({
    view: z
      .enum(['table', 'kanban', 'calendar', 'gallery', 'list'])
      .default('table'),
    groupBy: z.string().optional(),
    filter: z.string().optional(),
    sort: z.string().optional(),
  }),
})

// update one param, preserve the rest
navigate({ search: (prev) => ({ ...prev, view: 'kanban' }) })
```

- Use search middleware / `retainSearchParams` to carry relevant params across
  navigation so links stay consistent.

## Data fetching (queries & mutations)

- **All server reads go through TanStack Query** (`useQuery` / `useSuspenseQuery`).
  No raw `fetch`, no `useEffect` data loading — every server function read is
  called via Query.
- **Writes split by the write-path boundary** (see Realtime → Write path): non-hot
  CRUD goes through `useMutation` → server function; hot collaborative edits go
  over the WebSocket to the page DO. Never write the same row from both.
- Wrap each server function in a shared `queryOptions` factory (co-located with
  the function) so routes and components share the same keys and types:

```typescript
export const pageQuery = (pageSlug: string) =>
  queryOptions({
    queryKey: ['page', pageSlug],
    queryFn: () => getPage({ data: { slug: pageSlug } }),
  })
```

- **Prefetch in route loaders** with
  `queryClient.ensureQueryData(pageQuery(params.pageSlug))` for SSR + instant
  navigation (the app already wires `@tanstack/react-router-ssr-query`). The
  page read resolves the slug and returns the page **id**, which everything
  downstream (blocks, DO socket, mutations) keys off.
- Keep query keys structured and derived from route params/search so filtered
  views cache independently, e.g. `['collection', collectionId, 'rows', search]`.
- After a mutation, `invalidateQueries` the affected keys; use **optimistic
  updates** for the realtime editing feel.
- **Realtime:** Durable Object websocket messages update the cache directly via
  `setQueryData` (or targeted `invalidateQueries`) rather than refetching.

## Realtime (Durable Objects + WebSockets)

The app is **fully realtime** — every page edit propagates live to all
authenticated viewers. (Public-link visitors get plain server-fn reads, never a
socket — see Public sharing in the schema design principles.)

- **One Durable Object per page** (`env.PAGE_DOC.idFromName(pageId)`) is the
  coordination point for that page's collaboration.
- Clients open a **WebSocket** to the page's DO (via an upgrade route that
  forwards to the DO). The DO uses the **WebSocket Hibernation API**
  (`state.acceptWebSocket`, `webSocketMessage`, `webSocketClose`) so idle rooms
  cost nothing.
- **Authenticate the upgrade**: validate the better-auth session and the user's
  org/page permission before accepting the socket.
- **Broadcast on change**: block create/edit/move/delete and collection row
  changes are sent to the DO, applied to its live state, and broadcast to all
  other connected clients (block-level last-write-wins; `version` for OCC).
- **Write path — one writer per row.** Hot collaborative edits (block
  content/type, block & row create/move/delete, presence) go **client → WebSocket
  → DO**, and the DO is the **sole D1 writer** for those rows (apply in memory →
  broadcast → debounced flush). Everything else (create/rename/archive page,
  collections + fields/views, comments, invites, permission changes) goes through
  **server functions + TanStack Query mutations** and writes D1 directly; those
  may _notify_ the page DO to broadcast an invalidation, but must never
  double-write a row the DO owns.
- **Presence**: the DO tracks connected users + live cursors/selection and
  broadcasts join/leave/cursor events. Presence is ephemeral — never persisted
  to D1.
- **Persistence**: the DO is live state; it **debounces/batches writes to D1**
  (the queryable source of truth) and hydrates from D1 on cold start. DO storage
  may hold the hot doc + pending op buffer for durability between flushes.
- **Client**: apply incoming broadcasts to the TanStack Query cache via
  `setQueryData`; local edits are optimistic and reconciled with server
  broadcasts. Ordering/insertion uses the fractional-index `position`.

## Files & uploads (R2)

- File bytes go **directly between browser and R2 via presigned URLs** — they
  never pass through the Worker.
- **Upload (presigned PUT)**: the client calls a server fn (auth + org check,
  validates mime + max size) which returns a presigned **PUT** URL and the
  `r2Key`; the browser PUTs the file straight to R2, then confirms so an `asset`
  row is recorded.
- **Read/display (presigned GET)**: a server fn returns a **time-limited
  presigned GET** URL for an asset, so private assets are never publicly exposed;
  clients refresh the URL when it expires.
- **Signing**: use R2's S3-compatible API with `R2_ACCESS_KEY_ID` /
  `R2_SECRET_ACCESS_KEY` against `https://<account>.r2.cloudflarestorage.com`,
  signed with `aws4fetch` (Workers-friendly). These are the same R2 creds listed
  in Deployment.
- The `asset` table records `r2Key`/mime/size/owner/org and backs image/file
  blocks, page covers, and the `files` field type. App rows reference
  `asset.id`, never raw r2 keys; use the table to garbage-collect orphaned
  objects.

## MCP server

Expose a **remote MCP server** so users can connect external tooling (e.g. Claude)
to their workspace. Data model + permissions are already covered — this is just
the interface.

- **Transport**: a Streamable HTTP MCP endpoint on a Worker route (e.g. `/mcp`).
  Requires adding the MCP SDK (`@modelcontextprotocol/sdk`) — not yet a
  dependency. Back long-lived/streaming sessions with a Durable Object if needed.
- **Auth**: use better-auth's **`mcp` plugin**, which makes better-auth an OAuth
  2.0 provider for MCP (generates `oauthApplication` / `oauthAccessToken` /
  `oauthConsent` tables with the rest of the auth schema) and provides discovery
  metadata + a `withMcpAuth` wrapper to authenticate requests and resolve the
  session/org. The `apiKey` plugin stays available for headless/non-OAuth clients.
- **Scoping & permissions**: every tool call runs as the authenticated user in
  their active org and reuses the **same permission checks as the web app**
  (org membership, `viewer` = read-only, `pagePermission` overrides). No tool
  bypasses them.
- **Tools** (thin wrappers over the existing server functions, so logic isn't
  duplicated): search pages, read a page + its blocks, create/update/archive
  pages, add/update/move/delete blocks, list/create/update collection rows, read
  collections/views, add comments. Writes go through the **same DO path**, so MCP
  edits show up realtime for web clients too.
- **Resources**: expose pages/collections as MCP resources for clients that
  browse addressable content.
- **Schemas**: reuse each server function's Zod input/output schema as the MCP
  tool schema.

## Search

- Global search over page titles + block content (Notion-style quick-find; also
  backs the MCP `search pages` tool).
- Use SQLite **FTS5** virtual table(s) synced from `page`/`block`, scoped by org
  and gated by the same permission checks as everywhere else. Keep the index
  updated at the write points (the DO flush + CRUD mutations). FTS5 virtual
  tables can't be expressed in the Drizzle schema — create them in a
  hand-written migration alongside the drizzle-kit generated ones.

## UI

- Use **shadcn/ui** components wherever possible instead of hand-rolling UI
  (buttons, inputs, dialogs, dropdowns, popovers, selects, tabs, tooltips,
  command palette, context menus, etc.). Compose from them; only build custom
  components for genuinely Notion-specific surfaces (block editor, kanban board).
- Add components with the shadcn CLI, e.g. `bunx shadcn@latest add button`
  (this repo is bun-first — `.cursorrules` shows the same command via pnpm);
  keep them in the configured components directory and style with Tailwind.

## Features

- Create pages with editor support
- Page content is stored as markdown in blocks (decided — see Database schema)
- A user should be able to add blocks to a page
- A user should be able to choose blocks to add to a page, such as a configurable kanban board
- A user should be able to make tables with customisable columns and column types
- A user should be able to comment on pages and blocks (threaded, resolvable)
- By default all users inside an organisation should have full access to a page
- A user should be able to share a page publicly via a revocable read-only link
- A user should be able to connect with a full-featured MCP server

## Auth

- Use better-auth
- Auth config goes inside src/lib/auth.ts
- Email & password auth is always enabled (the app must work with no OAuth configured)
- Make sure Google OAuth & GitHub are configured if the required variables are defined
- Use better-auth organizations
- You should be able to invite users to an organization with full read & write or read-only permissions

## Database

- Put database connection logic inside src/lib/db/connection.ts
- Put schemas inside src/lib/db/schema.ts
- The database will be CloudFlare D1

## Deployment

- Only a production deployment will exist.
- Deployments happen on push to `main`, automated in GitHub Actions and run with
  [Pulumi](https://www.pulumi.com). Pulumi state is stored in an R2 bucket.
- **Fully portable — nothing custom is hardcoded in the repo.** Every deployment-
  specific value (Cloudflare account, domain, worker/db/bucket names, OAuth creds)
  comes from GitHub Actions **variables** (non-sensitive) and **secrets**
  (sensitive). Anyone can fork the repo, set their own variables + secrets, and
  deploy to their own Cloudflare account and domain with zero code changes.
- The custom domain is a variable, e.g. `APP_DOMAIN=potion.posty.social`. Pulumi
  binds it to the Worker and it derives `BETTER_AUTH_URL` (`https://$APP_DOMAIN`)
  and the OAuth redirect URIs (`https://$APP_DOMAIN/api/auth/callback/{provider}`).
- `wrangler.jsonc` holds only local-dev defaults + binding _shapes_; Pulumi injects
  the real names/ids/domain at deploy time from the variables below.

### GitHub Actions variables (non-sensitive)

**Required:**

- `CLOUDFLARE_ACCOUNT_ID` — target Cloudflare account
- `APP_DOMAIN` — public domain, e.g. `potion.posty.social`

**Optional — have sensible defaults; Pulumi creates the resource under the default
name, so only set these to customise:**

- `WORKER_NAME` — default `potion`
- `D1_DATABASE_NAME` — default `${WORKER_NAME}-db`
- `R2_BUCKET_NAME` — assets bucket, default `${WORKER_NAME}-assets`
- `PULUMI_STATE_BUCKET` — default `${WORKER_NAME}-pulumi-state` (created by the
  bootstrap step, not `pulumi up` — see Setup / bootstrap)
- `CLOUDFLARE_ZONE_ID` — derived from `APP_DOMAIN` via a zone lookup if omitted

**Optional — OAuth (a provider is enabled only if its id _and_ secret are set):**

- `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`

### GitHub Actions secrets (sensitive)

- `CLOUDFLARE_API_TOKEN` — provision + deploy
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — S3-compatible creds, used twice:
  the Pulumi R2 state backend (`https://<account>.r2.cloudflarestorage.com`) and,
  pushed as Worker secrets, presigning asset URLs (see Files & uploads)
- `PULUMI_CONFIG_PASSPHRASE` — encrypts Pulumi secrets in state
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`

### Pulumi pipeline (on push to main)

- Build the app → run D1 migrations (`wrangler d1 migrations apply`) →
  `pulumi up`. Migrations run first so old code never meets a schema it doesn't
  know — which means migrations must be **backwards-compatible**
  (expand/contract). **First-deploy exception**: the database doesn't exist
  until `pulumi up` creates it, so the pipeline skips the migration step when
  the DB is missing and applies migrations immediately after `pulumi up` instead.
- **Pulumi creates** (using the default or overridden names): the D1 database, the
  R2 assets bucket, the page Durable Object namespace + migration, and the Worker;
  binds the custom domain from `APP_DOMAIN` (looking up the zone if
  `CLOUDFLARE_ZONE_ID` is unset); and pushes the sensitive values as Worker secret
  bindings. The **only** resource it doesn't create is its own state bucket
  (`PULUMI_STATE_BUCKET`), which must pre-exist.
- All resource names/ids/domain come from the variables/secrets (or their
  defaults) — never literals in the repo.

### Setup / bootstrap

Ship a `scripts/setup.sh` (or `bun scripts/setup.ts`) so a self-hoster configures a
fork in one run. It should:

- Check `wrangler` + `gh` are installed and authenticated (`wrangler whoami`,
  `gh auth status`).
- Generate the two stable secrets: `BETTER_AUTH_SECRET`
  (`bunx @better-auth/cli@latest secret`) and `PULUMI_CONFIG_PASSPHRASE`
  (`openssl rand -base64 32`). (They must stay constant across deploys, so set once.)
- Create the **Pulumi state R2 bucket** with wrangler — the one resource that must
  exist before `pulumi up` (it's Pulumi's backend).
- Read the account id from `wrangler whoami`; prompt for `APP_DOMAIN` and for the
  paste-in values that can only come from the dashboard (CF API token, R2 S3 access
  key/secret).
- Push everything with `gh variable set` / `gh secret set` (bulk from a temp
  dotenv via `-f`), leaving defaulted names unset unless the user customises them.
- Optionally trigger the first deploy (`gh workflow run` or push to `main`).

Everything else — D1 DB, assets bucket, Worker, DO, custom domain — is created by
`pulumi up` on that first deploy. A thin Claude Code **skill** can wrap this script
to walk the user through the manual dashboard token steps interactively.

### README

The README must clearly document self-hosting so anyone can deploy their own copy:

- **Prerequisites**: a Cloudflare account + API token, and a domain/zone on
  Cloudflare.
- **Quick path**: fork → run `scripts/setup.sh` → push to `main`. The script
  provisions the state bucket and populates the repo's variables/secrets; the
  Actions/Pulumi pipeline then creates everything else and deploys to `APP_DOMAIN`.
- **Manual reference**: two tables (variables vs secrets) matching the lists above,
  each row noting whether it's **required** or **has a default**, and where to get
  it — so users who skip the script can set them by hand in repo settings.
- A note that OAuth providers are optional (only enabled when their id + secret
  are set) and which redirect URIs to register (`https://$APP_DOMAIN/api/auth/
callback/{google,github}`).

## Database schema

Drizzle ORM on D1 (SQLite). Column keys camelCase, SQL columns snake_case. Every
app row is scoped to an `organization`; by default any member of the org has full
access to that org's content (enforced in middleware).

### Design principles

- **Block-based like Notion.** A `page` is a node in a tree; its body is an
  ordered list of `block`s that can nest arbitrarily (toggles, columns, list
  items). Text blocks store **markdown** in `block.content`; type-specific config
  lives in a JSON `properties` column.
- **Structured widgets via one "collection" primitive.** The configurable kanban
  board AND customisable tables (custom columns + column types) are the same
  Notion-style database: `collection` (field schema as JSON) + `collectionRow`
  (values as JSON) + `collectionView` (view config as JSON). A table is a
  `collection` with a `table` view; a kanban is the same data with a `kanban`
  view grouped by a `select` field whose options are the columns. New view types
  and field/column types need **no migration**.
- **Realtime-friendly ordering.** Siblings order by a fractional-index string
  (`position`) so a Durable Object can insert/reorder between two peers without
  renumbering. Suffix positions with an actor/client id to break ties on
  concurrent inserts at the same slot.
- **Realtime editing model.** Default to **block-level last-write-wins**: the DO
  per page holds live state + broadcasts changes; `version` integer columns give
  optimistic concurrency against D1 (the source of truth). This clobbers _intra_-
  block concurrent edits, which is acceptable for an MVP. If character-level
  co-editing is needed later, switch that block/page to a CRDT (Yjs) and persist
  its snapshot in a blob (`page.ydocState` or a `documentUpdate` log table),
  keeping markdown as the derived/export format.
- **Permissions.** Org membership drives default access via `member.role`
  (`owner`/`admin`/`member` = write, `viewer` = read-only for invites). An
  optional `pagePermission` override table enables granular per-page sharing later.
- **Public sharing.** A page is shared to the web via a `publicLink` row — an
  unguessable token granting **read-only** access to that page (optionally its
  descendants) with no session. Public reads go through dedicated server
  functions gated by the token — never the org middleware, and never a DO write
  socket. Presigned asset GETs for a publicly shared page go through the same
  token gate so images/covers render for anonymous visitors. Revoking the link
  (or archiving the page) cuts access immediately.
- **MCP.** The MCP server is an interface over the same tables reusing the auth +
  permission middleware (see the MCP server section). Auth uses better-auth's
  **`mcp` plugin** (OAuth provider; generates its own tables), with the `apiKey`
  plugin as a fallback for headless clients — no other schema-specific tables needed.

### Auth tables — generated by better-auth, do not hand-author

better-auth owns its schema. Run `bunx @better-auth/cli@latest generate` after
configuring `src/lib/auth.ts` (email/password + Google/GitHub + `organization`
plugin + `drizzleAdapter`) to emit the Drizzle tables. Generate them into their
own file (e.g. `src/lib/db/auth.schema.ts`) so regenerating never clobbers the
hand-written app tables; `schema.ts` re-exports from it so there's still a single
import surface. The generated set is, for reference only (FK targets used below):

- core: **user**, **session** (incl. `activeOrganizationId`), **account**,
  **verification**
- organization plugin: **organization**, **member** (role — `viewer` = read-only),
  **invitation** (role, status, expiresAt, inviterId)

### App tables

- **page** — id, organizationId→organization, `parentPageId`→page (self, tree
  nesting), title, slug (URL-safe, unique per org — generated from the title
  with a short random suffix on collision; **stable across renames** so links
  don't break), icon, coverAssetId→asset (nullable), position (fractional), isArchived +
  archivedAt (trash), createdByUserId, lastEditedByUserId, version, timestamps
- **block** — id, pageId→page, `parentBlockId`→block (self, nesting), type
  (paragraph/heading_1‑3/lists/to_do/toggle/quote/callout/code/divider/image/
  file/bookmark/page_link/column_list/column/database), content (markdown),
  properties (JSON), `collectionId`→collection (**canonical** block↔collection
  link, for `database` blocks — kanban or table), position, createdByUserId,
  lastEditedByUserId, version, timestamps
- **collection** — id, organizationId→organization, pageId→page (nullable,
  **denormalised** — mirrors the owning `database` block's page for cheap
  page-scoped queries; `block.collectionId` is the source of truth, keep in sync
  when moving blocks), title, `schema` (JSON array of field/column defs:
  id/name/type/options), timestamps
- **collectionRow** — id, collectionId→collection, `values` (JSON keyed by field
  id), position, `pageId`→page (row opens as its own page, nullable),
  createdByUserId, lastEditedByUserId, version, timestamps
- **collectionView** — id, collectionId→collection, name, type
  (table/kanban/calendar/gallery/list), `config` (JSON: groupByFieldId,
  groupOrder, visibleFieldIds, filters, sorts), position, timestamps
- **comment** — id, organizationId, pageId→page, blockId→block (anchor, nullable),
  parentCommentId→comment (threads), authorUserId→user, body (markdown),
  resolvedAt, timestamps
- **asset** — id, organizationId, r2Key, mime, sizeBytes, uploadedByUserId,
  createdAt. Backs image/file blocks, page covers, and the `files` field type.
  Everything references `asset.id` (page `coverAssetId`, image/file block
  `properties`, `files` field values) — **never raw r2Keys** — so orphaned R2
  objects are found with a simple anti-join and ownership is always trackable.
- **pagePermission** (optional override layer) — id, pageId→page, organizationId,
  subjectType (user/organization/role), subjectId, access (read/write/full),
  createdAt; unique on (pageId, subjectType, subjectId). Use a **sentinel**
  `subjectId` (e.g. `'*'` for org-wide) instead of NULL — SQLite treats NULLs as
  distinct, so a nullable column would let duplicate grants through the unique index.
- **publicLink** — id, pageId→page, organizationId, token (unguessable, e.g.
  nanoid ≥21 chars, **unique**), includeChildPages (bool), expiresAt (nullable),
  revokedAt (nullable — revoke rather than delete so a link can't be silently
  re-minted at the same URL), createdByUserId, createdAt. Access is always
  read-only; index on pageId (enforce "one live link per page" in the create
  server fn, not the schema, so revoked history can be kept).

### Column/field types for collections (customisable tables)

text · number · select · multi_select · date · checkbox · person · url · email ·
files · relation · rollup — stored in `collection.schema`; each row's `values`
are keyed by field id.

- `relation`/`rollup` link rows across collections. Values are arrays of row ids
  in the JSON `values` (no migration needed), but that has **no referential
  integrity**; if integrity/queryability matters, add a `collectionRowRelation`
  join table later.

### Indexing & querying notes

- Because `collectionRow.values` is opaque JSON, server-side filter/sort uses
  `json_extract(values, '$.<fieldId>')`, which **can't use a normal index**. Fine
  at small scale; for hot fields add SQLite **generated columns + expression
  indexes**. (Same blob-of-properties tradeoff Notion itself makes.)
- Composite indexes should include `position` for the ordered-list queries, e.g.
  `block(pageId, parentBlockId, position)`, `page(organizationId, parentPageId,
position)`, `collectionRow(collectionId, position)`.
- Unique indexes for the two lookups that happen on every page load:
  `page(organizationId, slug)` for slug routing and `publicLink(token)` for
  public-link resolution.
- D1 enforces foreign keys, so `onDelete: cascade`/`set null` rules do the
  cleanup. Deleting a page cascades directly to its blocks, comments, and
  public links (`block.pageId`, `comment.pageId`, `publicLink.pageId`) and to
  its inline collections via `collection.pageId`, which in turn cascades to
  rows and views. `block.collectionId` also cascades, so deleting a collection
  removes its `database` block.

### Files & migrations

- `src/lib/db/auth.schema.ts` — **generated** by `@better-auth/cli generate`
  (auth tables); never hand-edit
- `src/lib/db/schema.ts` — hand-written app tables + relations, re-exports the
  generated auth tables so it's the single schema entry point
- `src/lib/db/connection.ts` — `createDb(env.DB)` + a `db` singleton bound to the
  D1 `DB` binding (`import { env } from 'cloudflare:workers'`)
- Add a `d1_databases` binding (`DB`) to `wrangler.jsonc`; generate migrations
  with drizzle-kit over the combined schema and apply via
  `wrangler d1 migrations apply`
