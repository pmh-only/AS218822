import assert from "node:assert/strict";
import test from "node:test";
import { createMonitoring, queryDefinitions } from "./monitoring.mjs";

test("isolates failed sources and preserves missing/non-finite data instead of zero", async () => {
  const monitoring = createMonitoring("https://prometheus.example", async (url) => {
    const query = url.searchParams.get("query");
    if (query === "as218822_bird_up") return new Response("unavailable", { status: 503 });
    const result = query.startsWith("routinator_vrps_final") ? [{ metric: {}, value: [100, "NaN"] }] : [];
    return Response.json({ status: "success", data: { result } });
  });
  const data = await monitoring();
  assert.equal(data.metrics.routers.state, "error");
  assert.equal(data.metrics.protocols.state, "empty");
  assert.equal(data.summary.routersTotal, null);
  assert.equal(data.summary.bgpTotal, null);
  assert.equal(data.summary.vrps, null);
  assert.equal(data.summary.activeAlerts, 0);
  assert.deepEqual(data.history, []);
});

test("coalesces concurrent requests, isolates operator caches, bounds history, and retries failures", async () => {
  let calls = 0;
  let fail = true;
  const monitoring = createMonitoring("https://prometheus.example", async (url) => {
    calls++;
    assert.ok(["/api/v1/query", "/api/v1/query_range"].includes(url.pathname));
    if (url.pathname.endsWith("query_range")) {
      const points = (Number(url.searchParams.get("end")) - Number(url.searchParams.get("start"))) / Number(url.searchParams.get("step"));
      assert.ok(points <= 144);
    }
    if (fail) throw new Error("private upstream error");
    return Response.json({ status: "success", data: { result: [] } });
  });
  await assert.rejects(monitoring(), /Monitoring unavailable/);
  fail = false;
  const count = calls;
  const [first, second] = await Promise.all([monitoring(), monitoring()]);
  assert.equal(first, second);
  assert.equal(calls - count, Object.keys(queryDefinitions("6h")).length);
  const privateData = await monitoring("24h", true);
  assert.ok(privateData.metrics.podInfo);
  assert.equal(first.metrics.podInfo, undefined);
  await assert.rejects(monitoring("30d"), /Unsupported time window/);
});
