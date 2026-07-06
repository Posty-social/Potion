# Deployment Variables Prompt

The boss supplies all production variables and secrets. Do not commit real
values. The repo should read these values from GitHub Actions, Cloudflare Worker
bindings, or local `.dev.vars`.

GitHub Actions variables:

- `CLOUDFLARE_ACCOUNT_ID` - required.
- `APP_DOMAIN` - required, for example `potion.example.com`.
- `TRUSTED_ORIGINS` - optional comma-separated auth origins if more than
  `https://$APP_DOMAIN` should be accepted.
- `WORKER_NAME` - optional, default `potion`.
- `D1_DATABASE_NAME` - optional, default `potion-db`.
- `R2_BUCKET_NAME` - optional, default `potion-assets`.
- `PULUMI_STATE_BUCKET` - optional, default `potion-pulumi-state`.
- `CLOUDFLARE_ZONE_ID` - optional if derivable from `APP_DOMAIN`.
- `GOOGLE_CLIENT_ID` - optional.
- `GITHUB_CLIENT_ID` - optional.

GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN` - required.
- `R2_ACCESS_KEY_ID` - required for Pulumi state and presigned URLs.
- `R2_SECRET_ACCESS_KEY` - required for Pulumi state and presigned URLs.
- `BETTER_AUTH_SECRET` - required, generated once and kept stable.
- `PULUMI_CONFIG_PASSPHRASE` - required, generated once and kept stable.
- `GOOGLE_CLIENT_SECRET` - optional.
- `GITHUB_CLIENT_SECRET` - optional.

OAuth redirect URIs:

- `https://$APP_DOMAIN/api/auth/callback/google`
- `https://$APP_DOMAIN/api/auth/callback/github`
