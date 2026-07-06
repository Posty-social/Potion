# Potion Stages

This file is the working definition of "done" for the build loop. Each major
stage must pass `bun run verify`, be committed, and be pushed before the next
stage starts.

## Stage 1 - Verification Spine

Status: done

Goal: make completion measurable with repeatable local and CI checks.

Done when:

- `bun run verify` runs formatting, linting, types, unit tests, route
  generation, D1 schema generation, Cloudflare type generation, production
  build, and browser e2e checks.
- Browser e2e covers desktop and mobile workspace load, route search state,
  task toggles, view switching, filtering, and missing-page fail-closed
  behavior.
- GitHub Actions runs the same verification command before deployment work.

## Stage 2 - Workspace Data Layer

Status: done

Goal: move workspace reads and writes behind a repository boundary that can use
D1 in production while keeping deterministic seed data for local verification.

Done when:

- Server functions call repository methods instead of importing mock data
  directly.
- Unknown pages still fail closed.
- Block updates validate page, block, version, and content length.
- Unit and browser checks prove reads, view state, and edited local UI still
  work.

## Stage 3 - Auth Gate And Owner Setup

Status: done

Goal: make the private workspace ready for real users without committing
secrets.

Done when:

- Private routes can be protected behind Better Auth when auth enforcement is
  enabled.
- Local/demo verification still works without production secrets.
- Environment examples document every variable needed by the boss.

## Stage 4 - Import, Assets, And Sharing

Status: done

Goal: turn the Notion replacement into a usable private import and sharing
tool.

Done when:

- Private chat import accepts sanitized input and creates private pages.
- R2 asset upload/signing has validated server functions.
- Public links stay disabled by default and are token-gated when enabled.

## Stage 5 - MCP And Realtime Write Path

Status: queued

Goal: connect remote tools and collaborative document writes safely.

Done when:

- MCP tools resolve through the same permission and repository layer.
- Durable Object writes validate sessions and broadcast page updates.
- Verification covers the API shape even when production credentials are not
  present.
