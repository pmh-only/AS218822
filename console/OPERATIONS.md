# Console Operations

The console combines public network telemetry with an optional, authenticated
operator section. Both are read-only. Private diagnostics are never added to the
public response, even when its caller is signed in.

## Runtime Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONSOLE_HOST` | `0.0.0.0` | HTTP listen address |
| `CONSOLE_LISTEN_PORT` | `8080` | HTTP listen port |
| `PROMETHEUS_URL` | `http://prometheus.monitoring.svc.cluster.local:9090` | Server-side Prometheus address |
| `OIDC_ISSUER_URL` | unset | HTTPS issuer identifier, not the discovery document URL |
| `OIDC_CLIENT_ID` | unset | Confidential OIDC client ID |
| `OIDC_CLIENT_SECRET` | unset | Confidential client secret; token endpoint uses `client_secret_post` |
| `OIDC_REDIRECT_URI` | unset | Exact registered callback, e.g. `https://bgp.pmh.codes/auth/callback` |
| `OIDC_SESSION_SECRET` | unset | Random secret of at least 32 characters for authenticated cookie encryption |
| `OIDC_ALLOWED_SUBJECTS` | unset | Comma-separated, case-sensitive allowed `sub` claims |
| `OIDC_ALLOWED_GROUPS` | unset | Comma-separated, case-sensitive allowed group memberships |
| `OIDC_GROUPS_CLAIM` | `groups` | Top-level array claim containing group memberships in the ID token |
| `OIDC_SCOPES` | `openid profile email` | Requested scopes; defaults also include `groups` when group rules are configured |
| `OIDC_ALLOW_ANY_AUTHENTICATED` | `false` | Explicitly authorize every identity admitted to this OIDC client |
| `OIDC_SESSION_TTL_SECONDS` | `3600` | Session lifetime, 60-86400 seconds, capped by the ID token's expiration |

With all five required `OIDC_*` connection/session variables unset, the console
operates publicly and `/api/operator` always returns 401. Setting any of those
five requires all five. Incomplete or unsafe configuration stops startup rather
than silently disabling authentication. At least one subject/group allowlist is
required unless `OIDC_ALLOW_ANY_AUTHENTICATED=true` is explicitly chosen.

## Enable Operator Access

1. Register a confidential authorization-code client at your OIDC provider with
   PKCE S256 support and the exact callback URL above. HTTPS is required; an HTTP
   callback is permitted only on `localhost`, `127.0.0.1`, or `[::1]` for local work.
2. Supply the five connection/session variables using your deployment's secret
   mechanism. Generate a session secret with `openssl rand -hex 32`; do not commit
   it, the client secret, or tokens. Use the same session secret on all replicas.
3. Set allowed subjects and/or groups. Matching either list permits access. For
   group authorization, configure the provider to include the selected array
   claim in its **ID token**, and request any provider-specific scope it needs.
   Email addresses are not used as authorization identities.
4. Deploy through GitOps and use **Sign in with OIDC** in the operator section.
   A provider account outside the allowlist is denied without receiving a session.

No provider credentials are bundled into the frontend, and this repository does
not provision an identity provider or activate OIDC in production automatically.

## Authentication Boundaries

- Authorization code flow validates state, nonce, PKCE, issuer, audience, token
  expiry, and the ID token signature using the issuer's keys.
- Session and ten-minute login-transaction cookies use authenticated encryption,
  `HttpOnly`, `SameSite=Lax`, and `Secure` plus a `__Host-` prefix on HTTPS. Provider
  access/refresh tokens are not retained or sent to the browser.
- Callback and origin checks use the configured URL, not `Host` or forwarded
  headers. Logout requires POST, the exact origin, and a session-bound CSRF token.
- Sessions are stateless and work across replicas. Local sign-out clears the
  browser session, not the provider's SSO session. There is no provider back-channel
  logout or per-session server revocation; a copied cookie can remain valid until
  expiry. Use short lifetimes or rotate `OIDC_SESSION_SECRET` to invalidate all
  sessions immediately. Changes to access rules take effect at the next login.
- Private API authorization runs before cache access. Public/private caches are
  separate, and API/auth responses carry `Cache-Control: private, no-store`.
- Third-party scripts and connections are excluded by the console CSP so external
  analytics cannot read authenticated diagnostics. Do not weaken this at a proxy.

## Telemetry Contract

| Endpoint | Access | Result |
| --- | --- | --- |
| `GET /healthz` | Public | Process health, independent of Prometheus or OIDC |
| `GET /api/auth` | Public | Whether OIDC is configured and the current session's display name, expiry, and logout CSRF token |
| `GET /api/status?range=6h` | Public | Network telemetry and compatible summary fields |
| `GET /api/operator?range=6h` | Operator | Namespace and backing-node diagnostics |
| `GET /auth/login` | OIDC enabled | Begin sign-in |
| `GET /auth/callback` | OIDC enabled | Validate sign-in response |
| `POST /auth/logout` | Operator | Clear local session (`X-CSRF-Token` required) |

Only `1h`, `6h`, and `24h` windows are accepted, at 60-, 300-, and 900-second
resolution respectively. The default is `6h`. Unknown or duplicate query
parameters are rejected. Query definitions and returned labels are fixed in
`monitoring.mjs`; arbitrary PromQL, Kubernetes access, logs, secrets, and mutation
endpoints are not provided.

Each `metrics` entry contains a label, `state` (`ok`, `empty`, or `error`), and
sanitized series. Instant vectors carry `value` and `evaluatedAt`; history carries
timestamp/value pairs. `evaluatedAt` is the query evaluation time, **not** scrape
time. Protocol `observedAt` uses `timestamp(...)`; collector/target ages also use
actual Prometheus sample timestamps. Missing and non-finite values remain null.
Individual query failures do not discard other sources; total failure returns 503.
Requests are coalesced, cached for ten seconds, and limited to eight concurrent
upstream queries per snapshot.

Public views cover routing protocol state, BGP state history/changes/sampled
availability, IPv6 reachability, overlay throughput/packets/paths/drops, RPKI VRPs,
trust anchors, validator freshness, workload readiness, and firing/pending alerts.

Operator views add CPU/memory history, requests/limits, container restarts and
start times, OOM events, failure reasons, images, pod/node placement and private
addresses, interface rates/errors/drops, disk I/O, persistent filesystem usage,
backing-node CPU/memory/load/uptime/filesystem/conditions, overlay route/health
counters, scrape endpoints/timing/samples, and RPKI repository fetch diagnostics.

CPU throttling is displayed only if the exporter provides it. Latency, BGP route
counts, and routing-table contents are not currently collected. Overlay traffic
is not total transit or necessarily unique traffic; host-network pod counters
can include shared host traffic. Volume filesystem capacity is not necessarily
the PVC's requested quota. Observed-sample availability is not a continuous SLA.

## Verification

Run `pnpm test` and `pnpm build` in `console/`. Tests include signed OIDC exchanges,
invalid identities and tokens, PKCE/state/nonce checks, authorization/cache
isolation, logout CSRF, partial telemetry failure, non-finite readings, and query
window boundaries. The container build runs both checks and retains only server
dependencies in its runtime image.
