# client — Orange Invest web app

React (Vite) + Tailwind + shadcn/ui. Screens: login (email only), uploads with each upload's
transactions, and chat. Talks to the Express API in `server/` per `API-CONTRACT.md` v1.1.

## Run

```sh
cd client
npm install
npm run dev        # http://localhost:5181, real API at VITE_API_URL (default http://localhost:4100)
npm run dev:mock   # http://localhost:5181, every endpoint mocked in the browser by MSW, no backend needed
npm test           # Vitest + React Testing Library, API mocked with MSW
npm run build      # production build into dist/
```

Point the client at a backend on another port by setting the variable on the command line:

```sh
VITE_API_URL=http://localhost:4100 npx vite --port 5180 --strictPort
```

The backend must allow this origin (`CLIENT_ORIGIN=http://localhost:5180` on the server).
The session cookie is `SameSite=Lax`, which works because `localhost:5180` and `localhost:4100` are the
same site.

`VITE_API_URL` rules (`src/api/config.js`): unset in dev means `http://localhost:4100`. Empty, or unset
in a production build, means same origin, so requests go to relative `/api/...`. Use that when the API
and the client are served from one host.

`VITE_REPO_URL` (default `https://github.com/prakhar-parashar-au5/orange_invest_assignment/blob/main/`)
is where relative links on the Artifacts pages go. They are resolved from `docs/artifacts/`.

The login form has an optional **Admin code** field. In production an admin account needs it; it's
sent as `code` only when filled in.

Artifacts render markdown with raw HTML off. Mermaid diagrams are drawn by a lazily loaded Mermaid
(`securityLevel: 'strict'`); the Artifacts page and Mermaid are separate chunks, not in the main bundle.

`client/.env.example` lists the only variable. Every `VITE_*` value ends up in the public JavaScript
bundle, so nothing secret ever goes in the client.

## Mock mode

`npm run dev:mock` uses the same handlers as the tests (`src/mocks/handlers.js`). Its state lives in
memory and resets on page reload. To exercise the error paths:

- upload a `.csv` whose first line has no "date" column → `UNKNOWN_FORMAT`
- upload a CSV with only a header row → `EMPTY_FILE`
- a data row with fewer than 3 comma-separated fields → counted as rejected
- upload the same file twice → every row comes back as a duplicate
- a chat message containing the word "fail" → `AGENT_UNAVAILABLE`, with a "Try again" button
- log in as any `admin@…` email (e.g. `admin@test.local`) → admin role, so the Admin pages show 3 seeded
  traces and 2 eval runs; any other email gets 403 on `/admin/*`

The mock only mimics the contract's shapes. It doesn't parse real bank columns, and its chat
replies are canned text.

## Layout

```
src/
  api/        config.js (base URL), client.js (request() + ApiError), endpoints.js (one function per endpoint)
  mocks/      MSW handlers + in-memory db (tests and dev:mock)
  lib/        money.js (formatPaise), dates.js, utils.js (cn)
  components/ ui/ (shadcn), AppLayout, ApiStatus
  features/   auth/, uploads/, chat/  (each with its tests)
  test/       setup, MSW server, renderApp helper
```

## Test hooks

Every main control has a visible label and a `data-testid`: `login-email`, `login-submit`,
`logout`, `nav-uploads`, `nav-chat`, `upload-choose` / `upload-input`, `upload-result`,
`count-inserted|duplicate|rejected`, `upload-error`, `upload-list` / `upload-item`, `txn-table`,
`txn-row` (with `data-direction`), `txn-amount`, `txn-prev`, `txn-next`, `txn-page-info`, `new-chat`,
`conversation-list` / `conversation-item`, `chat-input`, `chat-send`, `chat-thread`,
`chat-message` (with `data-role`), `chat-pending`, `chat-error`, `chat-retry`, `api-status`.
