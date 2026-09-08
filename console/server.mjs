import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuth } from "./auth.mjs";
import { createMonitoring, ranges } from "./monitoring.mjs";

const host = process.env.CONSOLE_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.CONSOLE_LISTEN_PORT ?? "8080", 10);
const prometheusUrl = (process.env.PROMETHEUS_URL ?? "http://prometheus.monitoring.svc.cluster.local:9090").replace(/\/$/, "");
const publicDir = fileURLToPath(new URL("./dist/", import.meta.url));
const auth = createAuth();
const monitoring = createMonitoring(prometheusUrl);

const securityHeaders = {
  "content-security-policy": "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' https://1.www.s81c.com; img-src 'self' data:; connect-src 'self'",
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
  response.writeHead(status, { "cache-control": "private, no-store", ...securityHeaders, ...headers });
  response.end(body);
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
  let url;
  try { url = new URL(request.url, "http://console"); }
  catch { return respond(response, 400, "Bad request\n"); }
  if (await auth.handle(request, response, respond, url.pathname)) return;
  if (request.method !== "GET") return respond(response, 405, "Method not allowed\n", { allow: "GET", "content-type": "text/plain; charset=utf-8" });
  if (request.url === "/healthz") return respond(response, 200, "ok\n", { "content-type": "text/plain; charset=utf-8" });
  if (url.pathname === "/api/auth") {
    const user = await auth.session(request);
    return respond(response, 200, JSON.stringify({ enabled: auth.enabled, user: user ? { name: user.name, expiresAt: new Date(user.exp * 1000).toISOString(), csrfToken: user.csrf } : null }), { "content-type": "application/json; charset=utf-8" });
  }
  if (["/api/status", "/api/operator"].includes(url.pathname)) {
    const operator = url.pathname === "/api/operator";
    if (operator && !await auth.session(request)) return respond(response, 401, JSON.stringify({ error: "Operator sign-in required" }), { "content-type": "application/json; charset=utf-8" });
    const range = url.searchParams.get("range") ?? "6h";
    if (!Object.hasOwn(ranges, range) || [...url.searchParams.keys()].some((key) => key !== "range") || url.searchParams.getAll("range").length > 1) {
      return respond(response, 400, JSON.stringify({ error: "Choose a range of 1h, 6h, or 24h" }), { "content-type": "application/json; charset=utf-8" });
    }
    try {
      return respond(response, 200, JSON.stringify(await monitoring(range, operator)), { "content-type": "application/json; charset=utf-8" });
    } catch {
      return respond(response, 503, JSON.stringify({ error: "Monitoring data is temporarily unavailable" }), { "content-type": "application/json; charset=utf-8" });
    }
  }
  if (url.pathname.startsWith("/auth/")) return respond(response, 404, "Not found\n");
  if (request.url.startsWith("/api/")) return respond(response, 404, JSON.stringify({ error: "Not found" }), { "content-type": "application/json; charset=utf-8" });
  return serveFile(request, response);
});

server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.listen(port, host, () => console.log(`Console listening on http://${host}:${server.address().port}`));
