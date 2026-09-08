# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The console serves the interested public and authenticated network operators. Public visitors verify AS218822's operation without private infrastructure access. Operators can sign in through environment-configured OIDC to inspect private diagnostics in the same dashboard. Established routing terminology remains appropriate for both audiences.

## Product Purpose

The console provides public operational proof for AS218822. It turns live, curated telemetry into a transparent account of network health so visitors can verify that the network and its supporting systems are functioning.

Success means a visitor can quickly establish the current health of BGP sessions, routers, IPv6 reachability, workloads, alerts, and RPKI validation from one public view.

## Positioning

Unlike a generic status page or unrestricted metrics browser, the console exposes a deliberately constrained, live view of the signals that substantiate AS218822's operation while keeping infrastructure access and arbitrary queries private.

## Operating Context

The console is a read-only web application at `bgp.pmh.codes`. It supports automatic or manual refresh and one-, six-, and 24-hour windows. Public visitors inspect routing topology, session history, transport rates, IPv6 reachability, RPKI validation, workloads, alerts, and source health. Authenticated operators additionally inspect namespace resources, private placement and addresses, backing-node health, interfaces, storage, and collector/repository diagnostics.

## Capabilities and Constraints

- Preserve anonymous public access to core status information without requiring login.
- Expose only curated monitoring data through the constrained `/api/status` endpoint; do not expose arbitrary Prometheus queries or infrastructure controls.
- Protect `/api/operator` on the server with OIDC and explicit identity access rules. Missing OIDC configuration must never make private data public.
- Retain accurate network terminology including BGP, RPKI, VRPs, probes, sessions, and workloads.
- Treat Prometheus as the telemetry source and handle temporary monitoring failure without presenting stale data as current.
- Remain a lightweight Astro application served by its Node HTTP server and deployed as a non-root, read-only container in Kubernetes.

## Brand Commitments

Use the established names `AS218822` and `AS218822 / Live Console`. Communication should be direct, factual, and transparent rather than promotional. Do not simplify away precise technical terms solely for a general audience; explain them through context when needed.

## Evidence on Hand

- `src/pages/index.astro` contains the current dashboard content, states, terminology, and responsive implementation.
- `server.mjs`, `monitoring.mjs`, and `auth.mjs` define the telemetry contract and security boundaries; `OPERATIONS.md` documents configuration and metric limitations.
- `server.test.mjs`, `monitoring.test.mjs`, and `auth.test.mjs` verify telemetry handling, access isolation, and signed OIDC flows.
- The deployment and public hostname are defined in the infrastructure GitOps repository at `../lab/as218822/console.yml`.
- The repository contains operational routing configuration and public registry data for AS218822. Future work must not invent reliability claims, historical performance, users, testimonials, or certifications not supported by real data.

## Product Principles

1. Prove operation with live evidence rather than claims.
2. Make overall network health understandable at a glance while preserving technical precision.
3. Keep public observability strictly read-only and narrower than the underlying monitoring system.
4. Distinguish healthy, degraded, unavailable, and stale states honestly.
5. Preserve a useful path from summary status to the specific signal behind it.
