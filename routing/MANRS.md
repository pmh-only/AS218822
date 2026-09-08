# Routing Security Operations

This is the implementation and evidence checklist for MANRS Actions 1-4, not a
claim of MANRS membership or completed certification. The public policy is at
[as218822.net/peering/](https://as218822.net/peering/).

## Action 1: Route Filtering

- The core originates only `2a06:9801:ff0::/44` from its static discard route.
  Kernel, connected, and upstream-learned routes cannot become local origins.
- External exports are default-deny. The core can additionally export the two
  reviewed AS201423 prefixes, only when learned over `gre_gateway_v6`.
  The GRE gateway and Vultr edge export only the aggregate received from the
  core over iBGP, with an empty AS path. They do not export third-party transit.
- Lunalight (AS201423) may send exactly `2a0f:6284:b::/48` and
  `2a0f:6284:c::/48`. Its AS path must consist solely of AS201423, with prepending
  allowed, and the origin must be RPKI Valid. Unknown and Invalid are rejected.
  This is checked at the adjacency, at core import, and before external export.
- The customer session has a two-route import limit and a ten-route receive
  limit. Exceeding either disables the session until an operator resolves the
  cause through the reviewed configuration and deployment process.
- Public transit imports reject defaults, local space, non-global and listed
  special-purpose prefixes, lengths outside /12-/48, empty/overlong AS paths,
  reserved/private ASNs, and RPKI Invalid routes. RPKI NotFound is allowed for
  transit; it is not evidence of origin authorization. Import tables permit
  revalidation when the RTR cache changes; the core also keeps export tables
  for automatic revalidation of its customer export filters. This is origin
  validation, not cryptographic validation of the entire AS path.
- IRR allowlists are manually reviewed and version controlled. There is no
  automatic IRR-to-filter generator. Peers can build filters from
  `RIPE::AS218822:AS-PMHONLY`, the route6 objects, and the exact prefixes below.

### Customer Authorization Procedure

Before enabling a new customer or expanding an existing allowlist:

1. Look up the ASN in its authoritative RIR database. Confirm the assigned
   organization and independently obtain its registered operational contact.
2. Confirm the request through that contact or an authenticated maintainer
   channel. Retain a dated authorization/LOA and reviewer identity privately.
   A BGP session, a PeeringDB entry, or possession of a tunnel key alone is not
   proof that the requester holds the ASN or prefix.
3. Check the address allocation/delegation, the authoritative IRR route6 origin,
   and a valid ROA covering the exact prefix and intended origin. Resolve any
   delegation or ownership mismatch with the resource holder before enabling it.
4. Review the exact prefix and AS-path filters, WireGuard AllowedIPs, nftables
   source allowlists, maximum-prefix limits, and published AS/route sets together.
   Adding a customer's downstream AS requires a new explicit policy review;
   do not broaden the existing single-origin path mask.
5. Run the routing and packet-filter tests, deploy through GitOps, and inspect
   imported/exported routes and source-validation counters. Notify adjacent
   operators of authorized changes before they need to update their filters.

Repeat registry/ROA and contact checks monthly and whenever authorization,
ownership, prefixes, or contact details change. Withdraw authorization through
GitOps when it is revoked. Do not commit private correspondence or credentials.

## Action 2: Source Address Validation

- On the Lunalight WireGuard peer, decrypted packets may use only its two /48s
  or its exact peering /128 as source addresses. nftables enforces the same
  ingress boundary, including packets addressed to the router itself; the
  peering /128 may reach only our local peering /128. No IPv4
  payload or unrelated IPv6 source is permitted on that adjacency.
- Tailscale authenticates end-user peers. The core additionally rejects sources
  outside Tailscale's IPv6 /48 and IPv4 /10 on `tailscale0`. IPv6 exit traffic is
  translated to `2a06:9801:ff0::` by the existing Tailscale SNAT rule.
- External ingress on the core, GRE gateway, and Vultr edge rejects sources from
  the locally routed `2a06:9801:ff0::/48` and the Tailscale IPv6 /48. The check runs
  before connection tracking, input, and forwarding. It covers the infrastructure
  subnet, not just the measurement addresses. Authenticated internal links,
  multihomed customer sources, and separately routed cloud prefixes such as
  `2a06:9801:ffa::/48` are not blanket-blocked. Review this boundary whenever
  subnet placement or an external interface changes.
- The core and GRE gateway validate traffic leaving their external routing
  tunnels against the owned aggregate and the two customer prefixes. Only
  locally generated traffic may use the explicitly listed provider-assigned
  transport addresses. IPv6 neighbor and multicast listener discovery are
  preserved with link scope and hop-limit checks; arbitrary ULA/link-local
  traffic cannot escape.
- Egress validation runs at postrouting priority 110, after SNAT at 100. It
  covers forwarded and locally generated packets without trusting an
  established-connection or packet-mark bypass. Non-service IPv4 forwarding
  over those routing tunnels is denied; the IPv4 transport underlay is untouched.
- Vultr accepts payload from its core tunnel only with the owned aggregate or
  the core's exact peering address as source (the latter only to the local
  peering address). On all routers, locally generated
  global-destination IPv6 packets must use the owned prefix or an explicitly
  listed router address, not an arbitrary customer or third-party source.
- The rules are installed before tunnel startup in the dedicated
  `inet as218822_sav` table. Replacement is atomic and does not flush Kubernetes,
  Tailscale, or host firewall tables. Rules remain installed during shutdown.
  Startup fails if installation fails. Adding an external interface requires
  updating its source policy before enabling it.

This is explicit source-prefix filtering, not strict reverse-path filtering:
asymmetric and multihomed transit paths are not rejected for using a different
return interface. Cloud-managed BYOIP workloads and the IPv4 underlay require
their own provider/workload SAV evidence; these router rules do not prove it.

## Actions 3 and 4: Public Coordination and Validation

Operational, peering, and abuse contact: **pmh_only@pmh.codes**.

- [PeeringDB](https://www.peeringdb.com/asn/218822) links the public policy and AS set.
- [RIPE aut-num](https://rest.db.ripe.net/ripe/aut-num/AS218822) publishes routing policy
  and administrative/technical contacts.
- [RIPE abuse role](https://rest.db.ripe.net/ripe/role/ACRO65594-RIPE) publishes the
  abuse mailbox. Keep these contacts and the website synchronized; verify mailbox
  delivery and response handling monthly, not merely the existence of a URL.
- [AS set](https://rest.db.ripe.net/ripe/as-set/AS218822:AS-PMHONLY) contains AS218822
  and AS201423. [Route set](https://rest.db.ripe.net/ripe/route-set/AS218822:RS-PREFIXES)
  lists AS218822's own origins, not the entire customer cone.

| Intended Origin | Exact Prefix | Distribution |
| --- | --- | --- |
| AS218822 | `2a06:9801:ff0::/44` | Core-originated aggregate, also exported by GRE and Vultr edges |
| AS218822 | `2a06:9801:ffa::/48` | Cloud-managed more-specific, not originated by these BIRD instances |
| AS201423 | `2a0f:6284:b::/48` | Lunalight adjacency to GRE gateway, then core external exports |
| AS201423 | `2a0f:6284:c::/48` | Lunalight adjacency to GRE gateway, then core external exports |

Each pair has an authoritative RIPE route6 object and an exact-length valid ROA
as checked on 2026-09-08. The aggregate's maxLength is 44, not blanket permission
to announce its /48s. ROA changes must be made by the resource holder through its
RPKI issuer; RIPE Database GitOps does not create ROAs. Planned cloud prefixes
are not automatically authorized by this table.

## Verification and Remaining Evidence

### Dedicated Measurement Segments

The core routes `2a06:9801:ff0:100::/64` and `2a06:9801:ff0:101::/64` to
separate WireGuard peers for one-shot CAIDA measurements. Each peer is restricted
to its assigned /64 and exact peering /128 using the same source-validation
mechanism as a routed stub adjacency. These are internal measurement subnets,
not additional BGP announcements; only the existing /44 covers them externally.

The measurement clients run in separate pod network namespaces, use public IPv6
addresses without SNAT, and traverse the core's normal forwarding path. They do
not run inside a router namespace, where link-layer injection could bypass the
router's host-local firewall. Only IPv6 is tested on these segments. IPv4 cloud
underlay reports are separate evidence and must not be attributed to AS218822.
New runs use an IPv4-only ClusterIP service for the encrypted WireGuard transport
so endpoint discovery survives router pod replacement or sidecar unavailability.
This does not NAT the measured IPv6 packets. Startup retries are bounded and do
not start the prober until endpoint configuration and a handshake succeed.

`routing/spoofer` builds the upstream CAIDA 1.5.0 standalone client, without its
scheduler or GUI. Jobs opt into public anonymized results, keep TLS verification
enabled, and do not share unanonymized results for remediation. Private peer keys
are held in a namespace/name-bound SealedSecret in the infrastructure repository.
Completed Jobs are retained for their logs; they have no TTL or automatic retry
that could cause GitOps to repeat public tests. Repeating a measurement requires
an explicit new Job in GitOps. Inspect the reported source address, ASN, and
outcomes before treating a report as evidence; dedicated measurement segments
do not establish coverage of every customer, cloud service, or underlay.

The initial IPv6 reports are retained at
[session 2229072](https://spoofer.caida.org/report.php?sessionid=2229072) and
[session 2229071](https://spoofer.caida.org/report.php?sessionid=2229071). Both are
attributed to AS218822 with NAT reported as absent and outbound private/routable
spoofing blocked. They are baseline evidence, not a complete pass: local logs
recorded an ingress validation gap and final server-response timeouts. The
runner preserves client errors instead of converting a published report URL
into a successful exit status.

### Local Tests

CI parses all three BIRD configurations, tests public/customer route rejection
with synthetic ROAs, and exercises source filters with packets inside an
isolated Docker network namespace. No spoofed test traffic is sent to production
or the Internet. Run the same tests locally:

```sh
docker build -t as218822-bird routing
docker run --rm --network none -v "$PWD/routing/tests:/tests:ro" as218822-bird sh /tests/policy.sh
docker build -t as218822-routing-tests routing/tests
docker run --rm --network none --cap-add NET_ADMIN --cap-add NET_RAW --sysctl net.ipv6.conf.all.forwarding=1 --sysctl net.ipv4.ip_forward=1 -v "$PWD/routing:/routing:ro" as218822-routing-tests python3 /routing/tests/source-validation.py
```

Read-only checks after GitHub Actions and Argo CD finish:

```sh
kubectl -n as218822 exec bird-0 -c bird -- birdc show protocols
kubectl -n as218822 exec bird-0 -c bird -- birdc show route export bgptunnel_no_v6 all
kubectl -n as218822 exec bird-gre-gateway-0 -c bird -- birdc show route protocol lunalight_v6 all
kubectl -n as218822 exec bird-gre-gateway-0 -c bird -- wg show lunalight allowed-ips
kubectl -n as218822 exec bird-0 -c bird -- nft list table inet as218822_sav
kubectl -n as218822 exec bird-gre-gateway-0 -c bird -- nft list table inet as218822_sav
```

Use the deployed socket `/run/bird/bird.ctl` with `birdc -s` if the image's
default socket differs. Check RPKI establishment, expected customer exports,
counter changes, normal IPv6 reachability, and the Tailscale exit path. The Vultr
Compose deployment is separate from Kubernetes; confirm its running image,
WireGuard allowlist, and nftables table independently after image publication.

Before answering all four MANRS actions with an unconditional Yes, retain the
customer's authenticated authorization evidence, verify operational mailbox
handling, confirm SAV on cloud-managed workloads and the IPv4 underlay, and
record a coordinated external source-validation test with a consenting
measurement service (for example CAIDA Spoofer). Public registry/ROA checks and
local tests do not replace those operational proofs.
