import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

function prometheusResponse(url) {
  const query = url.searchParams.get("query");
  const now = Date.now() / 1_000;
  let result;
  if (url.pathname.endsWith("query_range")) {
    if (query.startsWith("sum by (direction)")) {
      result = [
        { metric: { direction: "in" }, values: [[now - 300, "2048"], [now, "4096"]] },
        { metric: { direction: "out" }, values: [[now - 300, "1024"], [now, "2048"]] },
      ];
    } else {
      const values = query.startsWith("sum(") ? [[now - 300, "2"], [now, "1"]] : [[now - 300, "2"], [now, "2"]];
      result = [{ metric: {}, values }];
    }
  } else if (query === "as218822_protocol_up") {
    result = [
      { metric: { protocol: "transit_a", type: "BGP", location: "core" }, value: [now, "1"] },
      { metric: { protocol: "transit_b", type: "BGP", location: "core" }, value: [now, "0"] },
      { metric: { protocol: "rpki_cache", type: "RPKI", location: "core" }, value: [now, "1"] },
    ];
  } else if (query === "as218822_ipv6_reachable") {
    result = [{ metric: { location: "core", target: "2001:db8::1" }, value: [now, "1"] }];
  } else if (query === "as218822_bird_up") {
    result = [{ metric: { location: "core" }, value: [now, "1"] }];
  } else if (query.startsWith("kube_pod_container_status_ready")) {
    result = [
      { metric: { container: "bird", pod: "bird-0" }, value: [now, "1"] },
      { metric: { container: "tailscale", pod: "bird-0" }, value: [now, "0"] },
    ];
  } else if (query.startsWith("ALERTS")) {
    result = [{ metric: { alertname: "AS218822BGPSessionDown", severity: "warning", location: "core", protocol: "transit_b" }, value: [now, "1"] }];
  } else if (query.startsWith("routinator_vrps_final")) {
    result = [{ metric: {}, value: [now, "1000000"] }];
  } else {
    result = [{ metric: { pod: "bird-0", direction: "in" }, value: [now, "2048"] }];
  }
  return { status: "success", data: { resultType: url.pathname.endsWith("query_range") ? "matrix" : "vector", result } };
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

test("serves constrained live monitoring data", async (context) => {
  const mock = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(prometheusResponse(new URL(request.url, "http://prometheus"))));
  });
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  context.after(() => mock.close());
  const mockAddress = mock.address();
  assert.equal(typeof mockAddress, "object");

  const consolePort = await availablePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      CONSOLE_HOST: "127.0.0.1",
      CONSOLE_LISTEN_PORT: String(consolePort),
      PROMETHEUS_URL: `http://127.0.0.1:${mockAddress.port}`,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  context.after(() => child.kill("SIGTERM"));
  await once(child.stdout, "data");

  const response = await fetch(`http://127.0.0.1:${consolePort}/api/status`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /trace\.pmh\.codes/);
  const body = await response.json();
  assert.deepEqual(body.summary, {
    bgpUp: 1,
    bgpTotal: 2,
    routersUp: 1,
    routersTotal: 1,
    containersReady: 1,
    containersTotal: 2,
    activeAlerts: 1,
    vrps: 1_000_000,
  });
  assert.equal(body.protocols.length, 3);
  assert.equal(body.history.length, 2);
  assert.deepEqual(body.trafficHistory.map(({ in: inbound, out }) => ({ inbound, out })), [
    { inbound: 2048, out: 1024 },
    { inbound: 4096, out: 2048 },
  ]);
  assert.equal(body.alerts[0].protocol, "transit_b");

  const arbitrary = await fetch(`http://127.0.0.1:${consolePort}/api/query?query=up`);
  assert.equal(arbitrary.status, 404);
});
