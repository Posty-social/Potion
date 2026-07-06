# Private Chat Import Prompt

The reference chat showed why Potion should exist: a private group wants a
Notion-like place to capture sensitive discussion without paying per invited
member or exposing private notes by mistake.

Implementation rules for imported chat content:

- Do not commit raw private chat logs into source files or prompt docs.
- Imported chats become private pages by default.
- Public links are disabled until explicitly enabled.
- Public links are read-only, revocable, and token-gated.
- Private asset URLs are always presigned and short-lived.
- Comments and MCP tools must respect the same page permissions as the web app.
- Any chat import UI should show a privacy state before saving or sharing.

The current mock workspace includes only a sanitized summary of the reference
conversation so the product direction is represented without duplicating the raw
messages.
