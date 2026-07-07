#!/usr/bin/env bash
#
# Potion — one-shot deployment bootstrap.
#
# Populates this fork's GitHub Actions variables + secrets and creates the one
# resource Pulumi can't create itself (its own R2 state bucket). Everything else
# — D1, the assets bucket, the Worker, the Durable Object, the custom domain — is
# created by `pulumi up` on the first deploy (push to main).
#
# Prereqs you must have ready (see .claude/skills/deploy-setup/SKILL.md):
#   - gh, openssl, git, and wrangler (installed via `bun install`) on PATH
#   - `gh auth login` completed
#   - A Cloudflare API token, and R2 S3 access keys — both minted in the
#     Cloudflare dashboard (the script prompts you to paste them).
#
# Usage:  bash scripts/setup.sh
#
set -euo pipefail

# ---- pretty output -------------------------------------------------------------
bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\033[31mError:\033[0m %s\n' "$1" >&2; exit 1; }

# ---- locate tools --------------------------------------------------------------
if [ -x "./node_modules/.bin/wrangler" ]; then
  WRANGLER="./node_modules/.bin/wrangler"
else
  WRANGLER="npx --yes wrangler"
fi
command -v gh >/dev/null 2>&1 || die "GitHub CLI (gh) not found. Install: https://cli.github.com"
command -v openssl >/dev/null 2>&1 || die "openssl not found."
command -v git >/dev/null 2>&1 || die "git not found."
gh auth status >/dev/null 2>&1 || die "Not logged in to gh. Run: gh auth login"

# ---- helpers -------------------------------------------------------------------
# sanitize to a lowercase DNS/R2-safe slug
slug() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9-' '-' | sed 's/^-*//;s/-*$//'; }

ask() { # ask VAR "prompt" "default"
  local __var="$1" __prompt="$2" __default="${3:-}" __ans
  if [ -n "$__default" ]; then
    read -rp "$__prompt [$__default]: " __ans || true
    __ans="${__ans:-$__default}"
  else
    read -rp "$__prompt: " __ans || true
  fi
  eval "$__var=\$__ans"
}

ask_secret() { # ask_secret VAR "prompt"
  local __var="$1" __prompt="$2" __ans
  read -rsp "$__prompt: " __ans || true
  echo
  eval "$__var=\$__ans"
}

set_var()    { gh variable set "$1" --repo "$REPO" --body "$2" >/dev/null && ok "variable  $1"; }
set_secret() { gh secret   set "$1" --repo "$REPO" --body "$2" >/dev/null && ok "secret    $1"; }

# ---- resolve repo --------------------------------------------------------------
bold "Potion deployment setup"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
[ -z "$REPO" ] && ask REPO "GitHub repo (owner/name)"
[ -z "$REPO" ] && die "No repository resolved."
info "Target repository: $REPO"
echo

# ---- required inputs -----------------------------------------------------------
bold "1. App"
ask APP_DOMAIN "Public domain (e.g. potion.posty.social)"
APP_DOMAIN="$(printf '%s' "$APP_DOMAIN" | sed -E 's#^https?://##; s#/+$##')"
case "$APP_DOMAIN" in *.*) : ;; *) die "APP_DOMAIN doesn't look like a domain: $APP_DOMAIN" ;; esac
ask WORKER_NAME "Worker name" "potion"
WORKER_NAME="$(slug "$WORKER_NAME")"
D1_DATABASE_NAME="${WORKER_NAME}-db"
R2_BUCKET_NAME="${WORKER_NAME}-assets"
PULUMI_STATE_BUCKET="${WORKER_NAME}-pulumi-state"
echo

bold "2. Cloudflare credentials (paste from the dashboard)"
info "API token:  https://dash.cloudflare.com/profile/api-tokens"
info "R2 S3 keys: R2 > Manage R2 API Tokens > Create (Object Read & Write)"
ask_secret CLOUDFLARE_API_TOKEN "Cloudflare API token"
[ -z "$CLOUDFLARE_API_TOKEN" ] && die "API token is required."
ask_secret R2_ACCESS_KEY_ID "R2 access key ID"
ask_secret R2_SECRET_ACCESS_KEY "R2 secret access key"
export CLOUDFLARE_API_TOKEN

# account id — try to detect via the token, then confirm
DETECTED_ACCOUNT="$($WRANGLER whoami 2>/dev/null | grep -oiE '[0-9a-f]{32}' | head -n1 || true)"
ask CLOUDFLARE_ACCOUNT_ID "Cloudflare account ID" "$DETECTED_ACCOUNT"
[ -z "$CLOUDFLARE_ACCOUNT_ID" ] && die "Account ID is required."
export CLOUDFLARE_ACCOUNT_ID
echo

bold "3. OAuth providers (optional — press Enter to skip)"
ask GOOGLE_CLIENT_ID "Google client ID" ""
GOOGLE_CLIENT_SECRET=""
[ -n "$GOOGLE_CLIENT_ID" ] && ask_secret GOOGLE_CLIENT_SECRET "Google client secret"
ask GITHUB_CLIENT_ID "GitHub client ID" ""
GITHUB_CLIENT_SECRET=""
[ -n "$GITHUB_CLIENT_ID" ] && ask_secret GITHUB_CLIENT_SECRET "GitHub client secret"
echo

bold "4. Cloudflare Zero Trust (optional — press Enter to skip)"
info "If set, the deployed app is placed behind Cloudflare Access and only"
info "these emails can reach it. Requires the API token to also have the"
info "'Access: Apps and Policies — Edit' account permission."
ask ZERO_TRUST_EMAILS "Allowed emails, comma-separated (e.g. you@example.com)" ""
if [ -n "$ZERO_TRUST_EMAILS" ]; then
  IFS=',' read -ra ZT_ENTRIES <<< "$ZERO_TRUST_EMAILS"
  for entry in "${ZT_ENTRIES[@]}"; do
    trimmed="$(printf '%s' "$entry" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    case "$trimmed" in
      *@*.*) : ;;
      *) die "ZERO_TRUST_EMAILS entry doesn't look like an email: '$trimmed'" ;;
    esac
  done
fi
echo

# ---- generated, stable secrets -------------------------------------------------
BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
PULUMI_CONFIG_PASSPHRASE="$(openssl rand -base64 32)"

# ---- confirm -------------------------------------------------------------------
bold "Review"
info "repo                 $REPO"
info "APP_DOMAIN           $APP_DOMAIN"
info "WORKER_NAME          $WORKER_NAME"
info "D1_DATABASE_NAME     $D1_DATABASE_NAME       (Pulumi creates)"
info "R2_BUCKET_NAME       $R2_BUCKET_NAME    (Pulumi creates)"
info "PULUMI_STATE_BUCKET  $PULUMI_STATE_BUCKET (created now)"
info "CLOUDFLARE_ACCOUNT_ID $CLOUDFLARE_ACCOUNT_ID"
info "ZERO_TRUST_EMAILS    ${ZERO_TRUST_EMAILS:-<disabled>}"
info "Google OAuth         ${GOOGLE_CLIENT_ID:+configured}${GOOGLE_CLIENT_ID:-skipped}"
info "GitHub OAuth         ${GITHUB_CLIENT_ID:+configured}${GITHUB_CLIENT_ID:-skipped}"
info "BETTER_AUTH_SECRET / PULUMI_CONFIG_PASSPHRASE  generated"
echo
ask CONFIRM "Create the state bucket and push these to $REPO? (y/N)" "N"
case "$CONFIRM" in y|Y|yes|YES) : ;; *) die "Aborted." ;; esac
echo

# ---- create the Pulumi state bucket (must pre-exist) ---------------------------
bold "Creating Pulumi state bucket"
if OUT="$($WRANGLER r2 bucket create "$PULUMI_STATE_BUCKET" 2>&1)"; then
  ok "created $PULUMI_STATE_BUCKET"
elif printf '%s' "$OUT" | grep -qiE 'already (exists|owned)|10004'; then
  warn "$PULUMI_STATE_BUCKET already exists — reusing"
else
  die "Failed to create state bucket:\n$OUT"
fi
echo

# ---- push variables + secrets --------------------------------------------------
bold "Setting GitHub Actions variables"
set_var CLOUDFLARE_ACCOUNT_ID "$CLOUDFLARE_ACCOUNT_ID"
set_var APP_DOMAIN            "$APP_DOMAIN"
set_var WORKER_NAME           "$WORKER_NAME"
set_var D1_DATABASE_NAME      "$D1_DATABASE_NAME"
set_var R2_BUCKET_NAME        "$R2_BUCKET_NAME"
set_var PULUMI_STATE_BUCKET   "$PULUMI_STATE_BUCKET"
[ -n "$ZERO_TRUST_EMAILS" ]   && set_var ZERO_TRUST_EMAILS "$ZERO_TRUST_EMAILS"
[ -n "$GOOGLE_CLIENT_ID" ]    && set_var GOOGLE_CLIENT_ID  "$GOOGLE_CLIENT_ID"
[ -n "$GITHUB_CLIENT_ID" ]    && set_var GITHUB_CLIENT_ID  "$GITHUB_CLIENT_ID"

bold "Setting GitHub Actions secrets"
set_secret CLOUDFLARE_API_TOKEN      "$CLOUDFLARE_API_TOKEN"
set_secret R2_ACCESS_KEY_ID          "$R2_ACCESS_KEY_ID"
set_secret R2_SECRET_ACCESS_KEY      "$R2_SECRET_ACCESS_KEY"
set_secret BETTER_AUTH_SECRET        "$BETTER_AUTH_SECRET"
set_secret PULUMI_CONFIG_PASSPHRASE  "$PULUMI_CONFIG_PASSPHRASE"
[ -n "$GOOGLE_CLIENT_SECRET" ] && set_secret GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET"
[ -n "$GITHUB_CLIENT_SECRET" ] && set_secret GITHUB_CLIENT_SECRET "$GITHUB_CLIENT_SECRET"
echo

# ---- next steps ----------------------------------------------------------------
bold "Done. Next steps"
[ -n "$GOOGLE_CLIENT_ID" ] && info "Google redirect URI:  https://$APP_DOMAIN/api/auth/callback/google"
[ -n "$GITHUB_CLIENT_ID" ] && info "GitHub redirect URI:  https://$APP_DOMAIN/api/auth/callback/github"
if [ -n "$ZERO_TRUST_EMAILS" ]; then
  info "Zero Trust: enabled for $ZERO_TRUST_EMAILS"
  info "  Disable later:  gh variable delete ZERO_TRUST_EMAILS --repo $REPO  (then redeploy)"
else
  info "Zero Trust: off. Enable later:  gh variable set ZERO_TRUST_EMAILS --repo $REPO --body 'you@example.com'  (then redeploy)"
fi
info "Deploy: push to main, or run  gh workflow run deploy.yml --repo $REPO"
ok "Setup complete."
