# Product Brief

Build Potion as a self-hosted Notion-style workspace for private documents,
tables, kanban boards, comments, file blocks, and external AI tooling. The
immediate user is David McDonald, with production variables supplied later by
the boss through GitHub Actions and Cloudflare.

The job of the first screen is the app itself: a usable private workspace, not a
marketing page. It should make document editing, page navigation, database
views, comments, sharing state, and deployment readiness visible immediately.

Core product requirements:

- Email/password auth must work without OAuth.
- Google and GitHub OAuth are optional and enabled only when variables exist.
- Users belong to organizations; organization members can have write or
  read-only access.
- Pages are private by default.
- Public sharing uses revocable, read-only links.
- Page bodies are ordered markdown blocks.
- Tables and kanban boards share one collection primitive.
- MCP tools reuse the same permissions as the web app.
- Cloudflare account IDs, domains, secrets, bucket names, and OAuth values are
  never hardcoded.
