# ITNotice

ITNotice is an open-source, self-hostable internal communication platform for IT departments. Anyone can deploy it — all deployment-specific values (identity provider, database, branding, provider credentials) are configuration, not code.

## Features

- Notification authoring with required fields and approval workflow
- Immediate or scheduled dispatch via a queue-backed worker (retries + delivery log)
- Audience targeting synced from your identity provider's groups
- Employee status feed (the built-in **Web** channel — always available, no setup)
- Subscription preferences per employee
- Admin-configurable delivery channels: **Email (SMTP), Slack, Teams, SMS (Twilio), Webex**
  - Credentials entered in the admin UI, validated with a test connection, and encrypted at rest (AES-256-GCM)
- OIDC authentication with role-based access control (`admin`, `approver`, `author`, `employee`)

> If no channels are configured at deployment, notices are still fully usable through the web UI. Email and other channels light up as soon as an admin configures them.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React + Vite + TypeScript (`react-oidc-context` for login) |
| API | Express + TypeScript, `jose` for OIDC token validation |
| Queue | [pg-boss](https://github.com/timgit/pg-boss) (PostgreSQL-backed, no extra infra) |
| Database | PostgreSQL 16 |
| Auth | Any OIDC provider — Keycloak is bundled as the reference IdP |
| Dev email | Mailpit (bundled in docker-compose) |

## Quick start (docker compose)

```bash
cp .env.example .env
# Set ITNOTICE_ENCRYPTION_KEY to a strong random string, e.g.:
#   openssl rand -hex 32
docker compose up --build
```

Then:

1. Open <http://localhost:5173> and sign in. The bundled Keycloak realm seeds test users:
   `admin.user/admin`, `approver.user/approver`, `author.user/author`, `employee.user/employee`
2. As `admin.user`, run **Directory sync** to import users/groups from Keycloak.
3. (Optional) Configure the Email channel against the bundled Mailpit: host `mailpit`, port `1025`, TLS `false`. View delivered mail at <http://localhost:8025>.
4. Create a notification, approve it, and watch the delivery log.

Keycloak admin console: <http://localhost:8080> (`admin`/`admin` by default).

## Local development (without docker)

```bash
npm install
docker compose up postgres          # or point DATABASE_URL at your own Postgres

# Run the API without an IdP (grants an all-role dev user):
AUTH_DISABLED=true npm run dev:api

# Run the web app without an IdP:
VITE_AUTH_DISABLED=true npm run dev
```

## Configuration

All settings are environment variables — see `.env.example` for the full list.

| Variable | Purpose |
| --- | --- |
| `ITNOTICE_ENCRYPTION_KEY` | **Required in production.** Encrypts provider credentials at rest |
| `DATABASE_URL` | PostgreSQL connection string |
| `OIDC_ISSUER_URL` | Your OIDC issuer (any provider; Keycloak realm URL by default) |
| `OIDC_ROLES_CLAIM` | Dot-path to the roles array in access tokens (default `realm_access.roles`) |
| `KEYCLOAK_*` | Directory-sync settings for the bundled/reference Keycloak |
| `VITE_*` | Web build-time settings: API URL, OIDC authority/client, app name |
| `AUTH_DISABLED` / `VITE_AUTH_DISABLED` | Development-only bypass — never in production |

### Bring your own identity provider

The API validates standard OIDC bearer tokens via JWKS, so Entra ID, Okta, Zitadel, etc. all work:

1. Set `OIDC_ISSUER_URL` and `VITE_OIDC_AUTHORITY`/`VITE_OIDC_CLIENT_ID` for your IdP.
2. Map your IdP's groups/roles to `admin`, `approver`, `author`, `employee` and set `OIDC_ROLES_CLAIM` to where they appear in the token.
3. Directory sync currently ships with a Keycloak driver; for other IdPs, populate the `employees`/`audiences` tables via your own sync or disable sync (`DIRECTORY_SYNC_INTERVAL_MINUTES=0`).

## API overview

| Endpoint | Roles | Description |
| --- | --- | --- |
| `GET /health` | public | Liveness check |
| `GET /api/me` | any | Current user + roles |
| `GET/POST /api/notifications` | staff / author | List, create |
| `POST /api/notifications/:id/approve\|reject\|cancel` | approver | Workflow actions (approve enqueues delivery) |
| `GET /api/notifications/:id/deliveries` | staff | Delivery log |
| `GET /api/employee/status` | any | Subscribed, active notices |
| `GET/PUT /api/me/subscriptions[...]` | any | Subscription preferences |
| `GET /api/channels` | any | Channel status + credential field metadata |
| `PUT /api/channels/:channel/config` | admin | Save credentials (validated + encrypted) |
| `POST /api/channels/:channel/test` | admin | Test connection |
| `POST /api/channels/:channel/disable` | admin | Disable a channel |
| `POST /api/directory/sync` | admin | Run directory sync now |
| `POST /api/dispatch` | admin | Ad-hoc single message (testing) |

## Development scripts

```bash
npm run dev        # web app
npm run dev:api    # API (tsx watch)
npm run build      # all workspaces
npm test           # all workspaces
```

## Roadmap

- Templating and branding themes
- Localization and recurring maintenance notices
- Additional SMS providers (ClickSend) and per-user chat delivery
- Directory-sync drivers for Entra ID / Okta / SCIM
- Kubernetes manifests / Helm chart
