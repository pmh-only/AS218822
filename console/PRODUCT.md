# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary audience is the interested public: visitors who want to understand whether AS218822 is operating reliably without needing access to its private infrastructure. Network peers and operators may also use the console, so established routing terminology remains appropriate.

## Product Purpose

The console provides public operational proof for AS218822. It turns live, curated telemetry into a transparent account of network health so visitors can verify that the network and its supporting systems are functioning.

Success means a visitor can quickly establish the current health of BGP sessions, routers, IPv6 reachability, workloads, alerts, and RPKI validation from one public view.

## Positioning

Unlike a generic status page or unrestricted metrics browser, the console exposes a deliberately constrained, live view of the signals that substantiate AS218822's operation while keeping infrastructure access and arbitrary queries private.

## Operating Context

The console is a public, read-only web application at `bgp.pmh.codes`. It refreshes telemetry automatically and supports manual refresh. Visitors inspect current summary metrics, six hours of BGP availability, individual BGP session state, external IPv6 probes, Kubernetes workload readiness, and active AS218822 alerts.

## Capabilities and Constraints

- Preserve anonymous public access to core status information without requiring login.
- Expose only curated monitoring data through the constrained `/api/status` endpoint; do not expose arbitrary Prometheus queries or infrastructure controls.
- Retain accurate network terminology including BGP, RPKI, VRPs, probes, sessions, and workloads.
- Treat Prometheus as the telemetry source and handle temporary monitoring failure without presenting stale data as current.
- Remain a lightweight Astro application served by its Node HTTP server and deployed as a non-root, read-only container in Kubernetes.

## Brand Commitments

Use the established names `AS218822` and `AS218822 / Live Console`. Communication should be direct, factual, and transparent rather than promotional. Do not simplify away precise technical terms solely for a general audience; explain them through context when needed.

## Evidence on Hand

- `src/pages/index.astro` contains the current dashboard content, states, terminology, and responsive implementation.
- `server.mjs` defines the constrained telemetry contract and security boundaries.
- `server.test.mjs` verifies representative BGP, router, workload, alert, and RPKI data handling.
- The deployment and public hostname are defined in the infrastructure GitOps repository at `../lab/as218822/console.yml`.
- The repository contains operational routing configuration and public registry data for AS218822. Future work must not invent reliability claims, historical performance, users, testimonials, or certifications not supported by real data.

## Product Principles

1. Prove operation with live evidence rather than claims.
2. Make overall network health understandable at a glance while preserving technical precision.
3. Keep public observability strictly read-only and narrower than the underlying monitoring system.
4. Distinguish healthy, degraded, unavailable, and stale states honestly.
5. Preserve a useful path from summary status to the specific signal behind it.
