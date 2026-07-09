# Andre Portfolio Admin

Independent admin site for editing the portfolio content JSON and publishing through a GitHub PR plus Netlify Deploy Preview.

## Security setup

- Deploy this folder as a separate Netlify site.
- Put `GITHUB_FINE_GRAINED_PAT`, `ADMIN_GITHUB_CLIENT_SECRET`, and `ADMIN_SESSION_SECRET` in Netlify environment variables scoped to Functions only.
- Do not create any `VITE_*TOKEN*`, `VITE_*SECRET*`, or `VITE_*PAT*` variables. The build script rejects those names.
- `ADMIN_ALLOWED_GITHUB_USER_ID` must be the numeric GitHub user ID, not the username.
- The GitHub fine-grained PAT should be limited to this portfolio repository with only `contents:write` and `pull_requests:write`, and should have an expiration date.

## Local commands

```powershell
npm ci
npm run build
npm run audit
```

For local login and API testing, copy `.env.example` to `.env`, fill the values, then start Netlify Dev instead of plain Vite:

```powershell
npx --yes netlify-cli@latest dev --port 8888
```

Use this GitHub OAuth callback URL for local testing:

```text
http://127.0.0.1:8888/api/session/callback
```

The admin UI can render with plain Vite, but GitHub login, draft saves, uploads, audit logs, and publishing require Netlify Functions environment variables and Netlify Blobs.
