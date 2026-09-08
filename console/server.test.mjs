import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { EncryptJWT } from "jose";

async function start(context, env = {}) {
  const requests = [];
  const now = Math.floor(Date.now() / 1000);
  const mock = createServer((request, response) => {
    const url = new URL(request.url, "http://prometheus");
    const query = url.searchParams.get("query");
    requests.push(query);
    const vector = (metric, value) => ({ metric: { ...metric, instance: "private.internal:9090", secret: "never-return-this" }, value: [now, String(value)] });
    let result = [];
    if (url.pathname.endsWith("query_range")) {
      if (query.startsWith("sum by (direction)")) result = [{ metric: { direction: "in" }, values: [[now - 300, "2048"], [now, "4096"]] }];
      if (query === 'as218822_protocol_up{type="BGP"}') result = [{ metric: { protocol: "transit_a", location: "core" }, values: [[now - 300, "1"], [now, "0"]] }];
    } else if (query === "as218822_protocol_up") {
      result = [vector({ protocol: "transit_a", type: "BGP", location: "core" }, 1), vector({ protocol: "transit_b", type: "BGP", location: "core" }, 0), vector({ protocol: "rpki_cache", type: "RPKI", location: "core" }, 1)];
    } else if (query === "timestamp(as218822_protocol_up)") {
      result = [vector({ protocol: "transit_a", location: "core" }, now - 20)];
    } else if (query === "as218822_ipv6_reachable") result = [vector({ location: "core", target: "2001:db8::1" }, 1)];
    else if (query === "as218822_bird_up") result = [vector({ location: "core" }, 1)];
    else if (query.startsWith("kube_pod_container_status_ready")) result = [vector({ container: "bird", pod: "bird-0" }, 1), vector({ container: "tailscale", pod: "bird-0" }, 0)];
    else if (query.startsWith("ALERTS")) result = [vector({ alertname: "AS218822BGPSessionDown", severity: "warning", location: "core", protocol: "transit_b", alertstate: "firing" }, 1)];
    else if (query.startsWith("routinator_vrps_final")) result = [vector({}, 1000000)];
    else if (query.startsWith("kube_pod_info")) result = [vector({ pod: "bird-0", node: "private-node", pod_ip: "10.0.0.1" }, 1)];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "success", data: { result } }));
  });
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  context.after(() => mock.close());
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OIDC_")));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: import.meta.dirname,
    env: { ...cleanEnv, CONSOLE_HOST: "127.0.0.1", CONSOLE_LISTEN_PORT: "0", PROMETHEUS_URL: `http://127.0.0.1:${mock.address().port}`, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => child.kill("SIGTERM"));
  const [output] = await once(child.stdout, "data");
  return { url: output.toString().match(/http:\/\/\S+/)[0], requests };
}

test("serves curated public telemetry, actual sample times, and bounded windows", async (context) => {
  const { url, requests } = await start(context);
  const response = await fetch(`${url}/api/status`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.doesNotMatch(response.headers.get("content-security-policy"), /trace\.pmh\.codes/);
  const body = await response.json();
  assert.deepEqual(body.summary, { bgpUp: 1, bgpTotal: 2, routersUp: 1, routersTotal: 1, containersReady: 1, containersTotal: 2, activeAlerts: 1, vrps: 1000000 });
  assert.equal(body.protocols.length, 3);
  assert.ok(Date.now() - new Date(body.protocols[0].observedAt).getTime() >= 20000);
  assert.equal(body.history.length, 2);
  assert.equal(body.trafficHistory[0].out, null);
  assert.equal(body.alerts[0].protocol, "transit_b");
  assert.doesNotMatch(JSON.stringify(body), /private\.internal|never-return-this|private-node|pod_ip/);
  const count = requests.length;
  await fetch(`${url}/api/status`);
  assert.equal(requests.length, count);
  assert.equal((await fetch(`${url}/api/status?range=1h`)).status, 200);
  for (const path of ["/api/status?range=7d", "/api/status?query=up", "/api/status?range=1h&range=24h"]) assert.equal((await fetch(`${url}${path}`)).status, 400);
  assert.equal((await fetch(`${url}/api/query?query=up`)).status, 404);
  assert.deepEqual(await (await fetch(`${url}/api/auth`)).json(), { enabled: false, user: null });
  assert.equal((await fetch(`${url}/api/operator`)).status, 401);
  assert.equal((await fetch(`${url}/auth/login`)).status, 404);
  assert.equal((await fetch(`${url}/api/status`, { method: "POST" })).status, 405);
});

test("operator data requires a valid session even after its cache has been populated", async (context) => {
  const secret = "test-only-session-secret-at-least-32-characters";
  const { url, requests } = await start(context, {
    OIDC_ISSUER_URL: "https://issuer.example/", OIDC_CLIENT_ID: "console", OIDC_CLIENT_SECRET: "test-client-secret",
    OIDC_REDIRECT_URI: "https://console.example/auth/callback", OIDC_SESSION_SECRET: secret, OIDC_ALLOWED_SUBJECTS: "operator",
  });
  const count = requests.length;
  assert.equal((await fetch(`${url}/api/operator`)).status, 401);
  assert.equal(requests.length, count);
  const key = createHash("sha256").update(secret).digest();
  const makeCookie = async (expiry) => `__Host-console_session=${await new EncryptJWT({ sub: "operator", name: "Operator", csrf: "test-csrf", purpose: "session" }).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setIssuer("https://issuer.example/").setAudience("console").setExpirationTime(expiry).encrypt(key)}`;
  const cookie = await makeCookie("1h");
  const privateResponse = await fetch(`${url}/api/operator`, { headers: { cookie } });
  assert.equal(privateResponse.status, 200);
  const body = await privateResponse.json();
  assert.equal(body.metrics.podInfo.series[0].labels.node, "private-node");
  assert.doesNotMatch(JSON.stringify(body), /never-return-this/);
  assert.equal((await fetch(`${url}/api/operator`)).status, 401);
  assert.equal((await fetch(`${url}/api/operator`, { headers: { cookie: `${cookie}tampered` } })).status, 401);
  assert.equal((await fetch(`${url}/api/operator`, { headers: { cookie: await makeCookie(Math.floor(Date.now() / 1000) - 1) } })).status, 401);
  const publicBody = await (await fetch(`${url}/api/status`, { headers: { cookie } })).json();
  assert.doesNotMatch(JSON.stringify(publicBody), /private-node|pod_ip/);
  assert.equal((await fetch(`${url}/auth/logout`, { method: "POST", headers: { cookie, origin: "https://evil.example", "x-csrf-token": "test-csrf" } })).status, 403);
  assert.equal((await fetch(`${url}/auth/logout`, { method: "POST", headers: { cookie, origin: "https://console.example", "x-csrf-token": "wrong" } })).status, 403);
  assert.equal((await fetch(`${url}/auth/logout`, { method: "POST", headers: { cookie, origin: "https://console.example", "x-csrf-token": "\u00e9".repeat(9) } })).status, 403);
  const logout = await fetch(`${url}/auth/logout`, { method: "POST", headers: { cookie, origin: "https://console.example", "x-csrf-token": "test-csrf" } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
});
