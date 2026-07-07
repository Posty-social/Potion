---
name: deploy-setup
description: Set up a Potion fork for deployment to the user's own Cloudflare account and domain. Provisions the GitHub Actions variables/secrets and the Pulumi state bucket via scripts/setup.sh, after walking the user through the manual dashboard steps (Cloudflare API token, R2 S3 keys, optional OAuth apps) that can't be scripted. Triggers on "set up deployment", "deploy potion", "self-host", "configure secrets/variables", "connect my Cloudflare account".
user-invocable: true
allowed-tools: Read, Bash(bash scripts/setup.sh), Bash(gh auth status), Bash(gh repo view *), Bash(gh workflow run *), Bash(./node_modules/.bin/wrangler whoami), Bash(git remote -v)
---

# Deploy setup

Configure a fork so it deploys to the user's **own** Cloudflare account + domain.
Everything deployment-specific comes from GitHub Actions variables/secrets — no
code changes. The heavy lifting is in `scripts/setup.sh`; this skill walks the
user through the parts that can only be done by hand, then runs it.

## Division of labor

- **`scripts/setup.sh`** — generates the stable secrets, creates the Pulumi
  **state** R2 bucket (the one resource that must exist before Pulumi runs), and
  pushes every variable/secret to the repo with `gh`.
- **Pulumi (on push to `main`)** — creates everything else: the D1 database, the
  assets R2 bucket, the Worker, the page Durable Object, and the custom domain.
- **Manual (dashboard)** — minting the Cloudflare API token and R2 S3 keys, and
  creating OAuth apps. These can't be scripted; guide the user through them below.

> The deploy itself needs the CI workflow (`.github/workflows/deploy.yml`) and the
> Pulumi program to exist. If they aren't in the repo yet, setup still works — it
> just prepares the secrets; deployment runs once the pipeline is added.

## Prerequisites — check first

Run these and confirm each is satisfied before proceeding:

- `gh auth status` — logged in to GitHub CLI (else `gh auth login`).
- `git remote -v` — the fork has a GitHub remote (so the repo can be resolved).
- `bun install` has been run (so `./node_modules/.bin/wrangler` exists).
- The user has a Cloudflare account and a **domain/zone already on Cloudflare**
  (the custom domain must live in a zone they control).

## Step 1 — Cloudflare API token (required)

Dashboard → https://dash.cloudflare.com/profile/api-tokens → **Create Token** →
Custom token. Grant (Account = the target account, Zone = the zone that owns the
domain):

- Account · **Workers Scripts** · Edit (Worker + Durable Object)
- Account · **D1** · Edit
- Account · **Workers R2 Storage** · Edit (create/manage buckets)
- Account · **Access: Apps and Policies** · Edit (only if using `ZERO_TRUST_EMAILS`)
- Zone · **Workers Routes** · Edit (custom domain)
- Zone · **DNS** · Edit (custom domain record)

Copy the token — the script will prompt for it.

## Step 2 — R2 S3 access keys (required)

These back the Pulumi state (S3-compatible), separate from the API token.
Dashboard → **R2** → **Manage R2 API Tokens** → **Create API token** →
permission **Object Read & Write** → create. Copy the **Access Key ID** and
**Secret Access Key**.

## Step 3 — OAuth apps (optional)

Only if the user wants Google/GitHub login. A provider is enabled at runtime only
when both its id and secret are set.

- **Google**: Cloud Console → Credentials → OAuth client (Web). Redirect URI:
  `https://<APP_DOMAIN>/api/auth/callback/google`
- **GitHub**: Settings → Developer settings → OAuth Apps. Callback URL:
  `https://<APP_DOMAIN>/api/auth/callback/github`

## Step 4 — Cloudflare Zero Trust (optional)

To gate the deployed app behind Cloudflare Access, provide a comma-separated
email allowlist when the script prompts for `ZERO_TRUST_EMAILS`. Only those
users can reach the app (Access is default-deny); everyone else is blocked at
the edge before the Worker runs. Leave blank to skip. Toggle later by
setting/deleting the `ZERO_TRUST_EMAILS` repo variable and redeploying.

## Step 5 — run the script

```bash
bash scripts/setup.sh
```

It prompts for the domain, the credentials from steps 1–4, and (with a detected
default) the account id; generates `BETTER_AUTH_SECRET` + `PULUMI_CONFIG_PASSPHRASE`;
creates the state bucket; and pushes everything to the repo. Resource names
default from the worker name (`<worker>-db`, `<worker>-assets`,
`<worker>-pulumi-state`) — accept the defaults unless the user wants custom names.

## Step 6 — deploy

Push to `main` (or `gh workflow run deploy.yml`) to trigger the pipeline, which
runs D1 migrations and `pulumi up`, deploying to `https://<APP_DOMAIN>`.

## Reference — what gets set

**Variables** (non-sensitive): `CLOUDFLARE_ACCOUNT_ID`, `APP_DOMAIN`,
`WORKER_NAME`, `D1_DATABASE_NAME`, `R2_BUCKET_NAME`, `PULUMI_STATE_BUCKET`,
optional `ZERO_TRUST_EMAILS` (Cloudflare Access allowlist),
optional `GOOGLE_CLIENT_ID` / `GITHUB_CLIENT_ID`.

**Secrets** (sensitive): `CLOUDFLARE_API_TOKEN`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `BETTER_AUTH_SECRET`, `PULUMI_CONFIG_PASSPHRASE`,
optional `GOOGLE_CLIENT_SECRET` / `GITHUB_CLIENT_SECRET`.
