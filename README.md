# Andre Portfolio Admin

Independent admin site for editing the portfolio content JSON and publishing through a GitHub PR plus Netlify Deploy Preview.

This admin runs on the **Netlify Free** tier. It uses a free **GitHub OAuth App** for login and a free **GitHub fine-grained PAT** for repository writes. No paid scopes or password providers are required.

## Deploy and configure

1. Deploy this folder as a separate Netlify site (for example `andre-portfolio-admin`).
2. In the Netlify site settings, go to **Environment variables** and add the variables below as site variables. Do **not** prefix any secret names with `VITE_`; only `VITE_PORTFOLIO_URL` is public. The build script rejects `VITE_*TOKEN*`, `VITE_*SECRET*`, and `VITE_*PAT*` names to prevent leaking secrets into the frontend bundle.

| Variable | Purpose | Example |
|---|---|---|
| `ADMIN_PUBLIC_ORIGIN` | Public URL of this admin site | `https://andre-portfolio-admin.netlify.app` |
| `ADMIN_GITHUB_CLIENT_ID` | GitHub OAuth app Client ID | `Iv1.xxx...` |
| `ADMIN_GITHUB_CLIENT_SECRET` | GitHub OAuth app Client secret | `secret...` |
| `ADMIN_ALLOWED_GITHUB_USER_ID` | Numeric GitHub user ID allowed to log in | `12345678` |
| `ADMIN_SESSION_SECRET` | Long random secret for session hashing | `64+ random chars` |
| `GITHUB_FINE_GRAINED_PAT` | Fine-grained PAT for this repo only | `github_pat_...` |
| `GITHUB_REPO_OWNER` | Repository owner | `Andresun-hyper` |
| `GITHUB_REPO_NAME` | Repository name | `portfolio` |
| `GITHUB_BASE_BRANCH` | Branch to open draft PRs against | `main` |
| `VITE_PORTFOLIO_URL` *(optional)* | Public portfolio URL shown before a Deploy Preview exists | `https://andresun-hyper-portfolio.netlify.app/` |

### GitHub OAuth app

1. Go to **Settings > Developer settings > OAuth Apps > New OAuth App** in your GitHub account.
2. Fill in the application name and homepage URL (the admin site URL).
3. Set the **Authorization callback URL** to exactly the value shown below for your environment.
4. Save, then copy the **Client ID** and **Client secret** into the Netlify environment variables.

Callback URLs:

- **Production:** `https://<your-admin-site>/api/session/callback`
- **Local:** `http://127.0.0.1:8888/api/session/callback`

For example, if the admin site is `https://andre-portfolio-admin.netlify.app`, the callback is:

```text
https://andre-portfolio-admin.netlify.app/api/session/callback
```

The OAuth app only needs the `read:user` scope (no paid GitHub scopes).

### Fine-grained PAT

Create a fine-grained personal access token at **Settings > Developer settings > Personal access tokens > Fine-grained tokens**. Limit it to the portfolio repository only and grant:

- `Contents: write`
- `Pull requests: write`

Set an expiration date and rotate it periodically.

### Allowed GitHub user ID

`ADMIN_ALLOWED_GITHUB_USER_ID` must be the **numeric** GitHub user ID, not the username. You can find it by calling `https://api.github.com/users/<username>` and reading the `id` field.

### Missing configuration

If required variables are missing, the login page lists the missing names and the exact callback URL for the current admin site. No secrets are exposed in the UI. Fix the Netlify environment variables and redeploy the Functions (or trigger a new deploy).

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
