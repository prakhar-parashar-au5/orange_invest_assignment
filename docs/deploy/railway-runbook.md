# Deploying orange-invest to Railway

One Railway project with two services:

- **app**: Node. Express serves the API under `/api` and the built React client for every other path, all on one origin, so the session cookie works without CORS.
- **MySQL**: Railway's MySQL template. Our data lives in a database called `orange_invest_demo` inside it, not in Railway's default `railway` database.

Prakhar does every step in this file. Commands are single lines; paste them one at a time.

## 0. Before you start
- Deploy from `main` with `feat/backend` and `feat/frontend` merged in. The repo root must contain `package.json`, `.nvmrc`, `server/` and `client/`.
- Generate two secrets on your laptop and keep them in a password manager. Hex keeps them URL-safe:
  - `openssl rand -hex 32` → **JWT_SECRET**
  - `openssl rand -hex 24` → **RO_PASSWORD**, the password for the read-only DB user the agent uses
  - `openssl rand -hex 12` → **ADMIN_CODE**. With dummy email login, anyone could type `admin@test.local`, so in production an admin login also needs this code.

## 1. Create the project and MySQL
1. Railway dashboard → **New Project** → **Deploy from GitHub repo** → `orange_invest_assignment`, branch `main`. This creates the app service. Rename it `app`.
2. In the same project: **+ Create** → **Database** → **MySQL**. Keep the service name `MySQL`. The variable references below use that name.

## 2. App service settings (Settings tab)
| setting | value |
|---|---|
| Root Directory | *(empty: the repo root)* |
| Build Command | `npm run build` |
| Pre-deploy Command | `npm run db:create --prefix server && npm run db:init --prefix server` |
| Start Command | `npm start` |
| Healthcheck Path | `/api/health` |
| Restart Policy | On Failure (max retries 3) |
| Networking | **Generate Domain** (public HTTPS URL) |

- **Never put a seed in the pre-deploy command.** It runs on every deploy. `db:create` and `db:init` are idempotent; seeds are run once, by hand (step 5).
- Node comes from `.nvmrc` and `engines` (22.23.1). If the build log says that exact version isn't available, change both to `22` and redeploy.

## 3. App service variables (Variables tab)
| variable | value | source |
|---|---|---|
| `NODE_ENV` | `production` | type it |
| `DATABASE_URL` | `mysql://${{MySQL.MYSQLUSER}}:${{MySQL.MYSQLPASSWORD}}@${{MySQL.MYSQLHOST}}:${{MySQL.MYSQLPORT}}/orange_invest_demo` | references to the MySQL service; the database name is ours |
| `DATABASE_READONLY_URL` | `mysql://orange_agent_ro:<RO_PASSWORD>@${{MySQL.MYSQLHOST}}:${{MySQL.MYSQLPORT}}/orange_invest_demo` | paste RO_PASSWORD from step 0 |
| `JWT_SECRET` | `<JWT_SECRET>` | from step 0 |
| `OPENAI_API_KEY` | your key | type it into the dashboard; it lives nowhere else |
| `OPENAI_MODEL` | `gpt-4.1-mini` | type it |
| `ADMIN_LOGIN_CODE` | `<ADMIN_CODE>` | from step 0. Admins must enter it at login; without it no admin can log in |

- Don't set `PORT` (Railway injects it), `CLIENT_ORIGIN` (it's one origin, so CORS stays off), or `CLIENT_DIST_DIR` (the default `client/dist` is right).
- Optional cost guards, with these defaults: `CHAT_RATE_LIMIT=20` messages per `CHAT_RATE_WINDOW_SECONDS=600` per user, and `UPLOADS_PER_DAY=20` per user. Over the limit → 429 `RATE_LIMITED`.
- **Variable edits are staged.** Nothing applies until you click **Deploy** on the banner at the top.

## 4. Deploy
Click **Deploy**. In the deploy logs, expect:
- build: the client builds (`vite build`), then `npm ci --omit=dev` for the server
- pre-deploy: `db:create ok: database orange_invest_demo; read-only user orange_agent_ro: SELECT on orange_invest_demo.* only`, then `applied schema to orange_invest_demo: …12 tables`
- start: `orange-invest server listening on port … (production; OpenAI gpt-4.1-mini)`
- healthcheck: `/api/health` → 200

## 5. Demo data, once, from your laptop through the TCP proxy
Run these in a plain terminal on your laptop. Don't set `NODE_ENV=production` there: production mode requires every deploy secret, and these scripts only need `DATABASE_URL`. (Found in the rehearsal.)

1. MySQL service → **Settings → Networking** → enable **TCP Proxy** if it's off. Then MySQL service → **Variables** → copy **`MYSQL_PUBLIC_URL`**. It looks like `mysql://root:…@<host>.proxy.rlwy.net:<port>/railway`.
2. In `server/` on your laptop, with `<PUBLIC_URL>` that value with **`/railway` at the end replaced by `/orange_invest_demo`**, first a dry run:
   `DATABASE_URL='<PUBLIC_URL>' npm run seed:demo`
3. Then write. Add `OPENAI_API_KEY=…` in front if you want unknown merchants categorised now:
   `DATABASE_URL='<PUBLIC_URL>' npm run seed:demo -- --write`
   Expect `a@test.local … inserted 616`, `b@test.local … inserted 623`, `admin@test.local is an admin`, `analyzed …`. Running it again skips everything.
4. Without a key at seed time, fix the categories later:
   `DATABASE_URL='<PUBLIC_URL>' OPENAI_API_KEY=… npm run recategorise -- --all --allow-db orange_invest_demo`
5. To make another account admin (after it has logged in once):
   `DATABASE_URL='<PUBLIC_URL>' npm run make-admin -- --email <e>`
6. Turn the TCP proxy off again if you don't need it.

## 6. Smoke checklist (on the public URL)
- [ ] `https://<domain>/api/health` → `{"status":"ok"}`
- [ ] `https://<domain>/` shows the login page. A deep link such as `/uploads` reloads into the app, not a 404.
- [ ] Log in as `a@test.local`: the uploads list shows the seeded statement and its transactions page loads.
- [ ] Upload `server/test/fixtures/hdfc-basic.csv`: 201, 6 inserted, 2 rejected. Upload it again: 0 inserted.
- [ ] Chat: "How much did I spend in October?" gives an answer with a ₹ amount.
- [ ] Log in as `b@test.local`: none of a's uploads are visible.
- [ ] Log in as `admin@test.local` **without** the admin code: refused. With the code: the admin AI pages show the chat turn from above.
- [ ] Browser devtools → the `oi_session` cookie is `HttpOnly`, `Secure`, `SameSite=Lax`.

## 7. Rollback
- App: **Deployments** tab → the last good deployment → **Redeploy**. The schema is additive (`CREATE TABLE IF NOT EXISTS`, plus columns added when missing), so an older build runs against a newer schema.
- Data: demo data is synthetic. To start over, in Railway's MySQL **Data** tab or any MySQL client: `DROP DATABASE orange_invest_demo;`, then redeploy (pre-deploy recreates it) and rerun step 5.
- Secrets: change the variable, then **Deploy**. Rotating `ADMIN_LOGIN_CODE` takes effect on the next admin login. Rotating `JWT_SECRET` logs everyone out. Rotating `RO_PASSWORD` needs only a redeploy, because `db:create` updates the user's password.

## 8. What can break
| risk | what I checked | what I couldn't check |
|---|---|---|
| Cookie not sent (two origins, `SameSite`) | one origin by design; `trust proxy` and `Secure` in production; the local rehearsal ran on one port | real HTTPS behind Railway's proxy |
| Client routes 404 on reload | the SPA fallback is tested; `/api/*` stays JSON 404 | |
| Pre-deploy fails on a fresh MySQL | rehearsed against a fresh MySQL 8 shaped like Railway's (root user, default DB `railway`, non-3306 port) | Railway's exact MySQL version |
| Read-only user gets more than SELECT | `db:create` checks `SHOW GRANTS` and fails the deploy if it finds anything extra; tested | |
| Bad DB or user name injected via a variable | names validated against `^[a-z0-9_]{1,64}$`; the password is a bound parameter | |
| OpenAI spend on a public URL | per-user chat and upload limits (tested); 5 tool rounds max per message | a global spend cap (set one in the OpenAI dashboard) |
| Node version not available on Railway | pinned 22.23.1 in `.nvmrc` and `engines` | whether Railway's builder has that exact version (fallback: `22`) |
| A seed runs on every deploy | seeds aren't in pre-deploy; `seed:demo` refuses anything not ending in `_demo` and does a dry run unless `--write` | |
| Missing secrets | production startup fails and names every missing variable | |
| Anyone logs in as admin (dummy auth) | in production an admin also needs `ADMIN_LOGIN_CODE`, compared in constant time; tested | brute force: there is no login rate limit yet, so use a long random code |

## 9. Known traps
- **Variable edits stay staged** until you click **Deploy**.
- **Railway's Data tab opens the `railway` database**, which is empty. Our tables are in `orange_invest_demo`: switch database in the tab, or use a MySQL client.
- **Don't paste multi-line commands** into a terminal or a Railway field. Every command here is one line.
- `MYSQL_URL` and `MYSQL_PUBLIC_URL` end in `/railway`. Always replace that with `/orange_invest_demo`.
- The TCP proxy host and port can change if you turn the proxy off and on. Copy `MYSQL_PUBLIC_URL` again each time.
