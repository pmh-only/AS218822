import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.CONSOLE_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.CONSOLE_LISTEN_PORT ?? "8080", 10);
const prometheusUrl = (process.env.PROMETHEUS_URL ?? "http://prometheus.monitoring.svc.cluster.local:9090").replace(/\/$/, "");
const publicDir = fileURLToPath(new URL("./dist/", import.meta.url));
const cacheTtl = 10_000;
let cache;
let cacheExpires = 0;
let statusPromise;

const securityHeaders = {
  "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://trace.pmh.codes; img-src 'self' data:; connect-src 'self' https://trace.pmh.codes",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

function respond(response, status, body, headers = {}) {
  response.writeHead(status, { "cache-control": "no-store", ...securityHeaders, ...headers });
  response.end(body);
}

async function prometheus(path, params) {
  const url = new URL(`${prometheusUrl}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Prometheus returned ${response.status}`);
  const body = await response.json();
  if (body.status !== "success") throw new Error(body.error ?? "Prometheus query failed");
  return body.data.result;
}

function sample(item) {
  return Number(item.value[1]);
}

async function loadStatus() {
  const now = Math.floor(Date.now() / 1_000);
  const queries = {
    protocols: 'as218822_protocol_up',
    reachability: 'as218822_ipv6_reachable',
    routers: 'as218822_bird_up',
    containers: 'kube_pod_container_status_ready{namespace="as218822"}',
    alerts: 'ALERTS{alertname=~"AS218822.+",alertstate="firing"}',
    vrps: 'routinator_vrps_final{job="as218822-rpki"}',
    traffic: 'sum by (pod, direction) (label_replace(rate(tailscaled_inbound_bytes_total{job="as218822-tailscale"}[5m]), "direction", "in", "", "") or label_replace(rate(tailscaled_outbound_bytes_total{job="as218822-tailscale"}[5m]), "direction", "out", "", ""))',
  };
  const entries = await Promise.all(Object.entries(queries).map(async ([key, query]) => [key, await prometheus("/api/v1/query", { query })]));
  const result = Object.fromEntries(entries);
  const [upHistory, totalHistory, trafficHistory] = await Promise.all([
    prometheus("/api/v1/query_range", { query: 'sum(as218822_protocol_up{type="BGP"})', start: String(now - 21_600), end: String(now), step: "300" }),
    prometheus("/api/v1/query_range", { query: 'count(as218822_protocol_up{type="BGP"})', start: String(now - 21_600), end: String(now), step: "300" }),
    prometheus("/api/v1/query_range", { query: 'sum by (direction) (label_replace(rate(tailscaled_inbound_bytes_total{job="as218822-tailscale"}[5m]), "direction", "in", "", "") or label_replace(rate(tailscaled_outbound_bytes_total{job="as218822-tailscale"}[5m]), "direction", "out", "", ""))', start: String(now - 21_600), end: String(now), step: "300" }),
  ]);

  const protocols = result.protocols.map((item) => ({
    name: item.metric.protocol,
    type: item.metric.type,
    location: item.metric.location,
    up: sample(item) === 1,
    observedAt: new Date(Number(item.value[0]) * 1_000).toISOString(),
  })).sort((a, b) => a.location.localeCompare(b.location) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  const bgp = protocols.filter((protocol) => protocol.type === "BGP");
  const containers = result.containers.map((item) => ({
    name: item.metric.container,
    pod: item.metric.pod,
    ready: sample(item) === 1,
  })).sort((a, b) => a.pod.localeCompare(b.pod) || a.name.localeCompare(b.name));
  const reachability = result.reachability.map((item) => ({
    location: item.metric.location,
    target: item.metric.target,
    reachable: sample(item) === 1,
  }));
  const historyUp = new Map((upHistory[0]?.values ?? []).map(([timestamp, value]) => [timestamp, Number(value)]));
  const history = (totalHistory[0]?.values ?? []).map(([timestamp, value]) => ({
    timestamp: new Date(Number(timestamp) * 1_000).toISOString(),
    up: historyUp.get(timestamp) ?? 0,
    total: Number(value),
  }));
  const trafficSeries = new Map(trafficHistory.map((series) => [series.metric.direction, new Map(series.values.map(([timestamp, value]) => [timestamp, Number(value)]))]));
  const trafficTimestamps = [...new Set(trafficHistory.flatMap((series) => series.values.map(([timestamp]) => timestamp)))].sort((a, b) => a - b);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      bgpUp: bgp.filter((protocol) => protocol.up).length,
      bgpTotal: bgp.length,
      routersUp: result.routers.filter((item) => sample(item) === 1).length,
      routersTotal: result.routers.length,
      containersReady: containers.filter((container) => container.ready).length,
      containersTotal: containers.length,
      activeAlerts: result.alerts.length,
      vrps: result.vrps[0] ? sample(result.vrps[0]) : null,
    },
    protocols,
    reachability,
    containers,
    alerts: result.alerts.map((item) => ({
      name: item.metric.alertname,
      severity: item.metric.severity ?? "unknown",
      location: item.metric.location,
      protocol: item.metric.protocol,
    })),
    traffic: result.traffic.map((item) => ({ pod: item.metric.pod, direction: item.metric.direction, bytesPerSecond: sample(item) })),
    trafficHistory: trafficTimestamps.map((timestamp) => ({
      timestamp: new Date(Number(timestamp) * 1_000).toISOString(),
      in: trafficSeries.get("in")?.get(timestamp) ?? 0,
      out: trafficSeries.get("out")?.get(timestamp) ?? 0,
    })),
    history,
  };
}

async function status() {
  if (cache && Date.now() < cacheExpires) return cache;
  if (!statusPromise) {
    statusPromise = loadStatus().then((value) => {
      cache = value;
      cacheExpires = Date.now() + cacheTtl;
      return value;
    }).finally(() => { statusPromise = undefined; });
  }
  return statusPromise;
}

async function serveFile(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://console").pathname);
  } catch {
    return respond(response, 400, "Bad request\n", { "content-type": "text/plain; charset=utf-8" });
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filename = resolve(publicDir, relative);
  if (!filename.startsWith(`${resolve(publicDir)}${sep}`)) return respond(response, 404, "Not found\n", { "content-type": "text/plain; charset=utf-8" });
  try {
    if (!(await stat(filename)).isFile()) throw new Error("Not a file");
  } catch {
    if (extname(filename)) return respond(response, 404, "Not found\n", { "content-type": "text/plain; charset=utf-8" });
    filename = resolve(publicDir, "index.html");
  }
  response.writeHead(200, {
    "cache-control": extname(filename) === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    "content-type": contentTypes[extname(filename)] ?? "application/octet-stream",
    ...securityHeaders,
  });
  createReadStream(filename).pipe(response);
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET") return respond(response, 405, "Method not allowed\n", { allow: "GET", "content-type": "text/plain; charset=utf-8" });
  if (request.url === "/healthz") return respond(response, 200, "ok\n", { "content-type": "text/plain; charset=utf-8" });
  if (request.url === "/api/status") {
    try {
      return respond(response, 200, JSON.stringify(await status()), { "content-type": "application/json; charset=utf-8" });
    } catch (error) {
      console.error(error);
      return respond(response, 503, JSON.stringify({ error: "Monitoring data is temporarily unavailable" }), { "content-type": "application/json; charset=utf-8" });
    }
  }
  if (request.url.startsWith("/api/")) return respond(response, 404, JSON.stringify({ error: "Not found" }), { "content-type": "application/json; charset=utf-8" });
  return serveFile(request, response);
});

server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.listen(port, host, () => console.log(`Console listening on http://${host}:${port}`));
