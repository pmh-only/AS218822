import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createMonitoring, queryDefinitions } from "./monitoring.mjs";

test("isolates failed sources and preserves missing/non-finite data instead of zero", async () => {
  const monitoring = createMonitoring("https://prometheus.example", async (url) => {
    const query = url.searchParams.get("query");
    if (query === "min by (location) (as218822_bird_up)") return new Response("unavailable", { status: 503 });
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

test("routing identities and statistics survive pod replacement", { skip: !process.env.PROMTOOL }, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "console-promql-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const queries = queryDefinitions("1h");
  const session = '{location="core",protocol="transit",type="BGP"}';
  const peer = '{location="edge",protocol="transit",type="BGP"}';
  const probe = '{location="core",target="2001:db8::1"}';
  const router = '{location="core"}';
  const input = (name, labels, instance, values) => ({ series: `${name}${labels.slice(0, -1)},instance="${instance}",pod="bird-${instance}",job="as218822-bird"}`, values });
  const check = (key, eval_time, samples) => ({ expr: queries[key].query, eval_time, exp_samples: samples.map(([labels, value]) => ({ labels, value })) });
  const file = join(directory, "restarts.json");
  // promtool accepts JSON as YAML; expressions come from the actual API definitions.
  await writeFile(file, JSON.stringify({ evaluation_interval: "30s", tests: [
    {
      name: "stitch replacements before calculating availability and transitions",
      interval: "30s",
      input_series: [
        input("as218822_protocol_up", session, "old", "1 1 1 stale _ _"),
        input("as218822_protocol_up", session, "new", "_ _ _ 0 0 1"),
        input("as218822_protocol_up", peer, "other-location", "1 1 1 1 1 1"),
        input("as218822_protocol_up", '{location="core",protocol="cache",type="RPKI"}', "rpki", "1 1 1 1 1 1"),
        input("as218822_ipv6_reachable", probe, "old", "1 1 1 stale _ _"),
        input("as218822_ipv6_reachable", probe, "new", "_ _ _ 0 0 1"),
        input("as218822_ipv6_reachable", '{location="edge",target="2001:db8::1"}', "other-location", "1 1 1 1 1 1"),
      ],
      promql_expr_test: [
        check("sessionHistory", "1m", [[session, 1], [peer, 1]]),
        check("sessionHistory", "1m30s", [[session, 0], [peer, 1]]),
        check("sessionHistory", "2m30s", [[session, 1], [peer, 1]]),
        check("sessionAvailability", "2m30s", [[session, 4 / 6 * 100], [peer, 100]]),
        check("sessionChanges", "2m30s", [[session, 2], [peer, 0]]),
        check("protocols", "2m30s", [[session, 1], [peer, 1], ['{location="core",protocol="cache",type="RPKI"}', 1]]),
        check("probeHistory", "2m30s", [[probe, 1], ['{location="edge",target="2001:db8::1"}', 1]]),
      ],
    },
    {
      name: "overlapping exporters count once without hiding a down result",
      interval: "30s",
      input_series: [
        input("as218822_protocol_up", session, "old", "1 _"),
        input("as218822_protocol_up", session, "new", "_ 0"),
        input("as218822_ipv6_reachable", probe, "old", "1 _"),
        input("as218822_ipv6_reachable", probe, "new", "_ 0"),
        input("as218822_bird_up", router, "old", "1 _"),
        input("as218822_bird_up", router, "new", "_ 0"),
      ],
      promql_expr_test: [
        check("protocols", "30s", [[session, 0]]),
        check("protocolObserved", "30s", [[session, 30]]),
        check("sessionHistory", "30s", [[session, 0]]),
        check("sessionAvailability", "30s", [[session, 50]]),
        check("sessionChanges", "30s", [[session, 1]]),
        check("reachability", "30s", [[probe, 0]]),
        check("probeHistory", "30s", [[probe, 0]]),
        check("routers", "30s", [[router, 0]]),
      ],
    },
    {
      name: "missing samples stay missing and a healthy restart is not a flap",
      interval: "30s",
      input_series: [
        input("as218822_protocol_up", session, "old", "1 stale _ _"),
        input("as218822_protocol_up", session, "new", "_ _ _ 1"),
        input("as218822_ipv6_reachable", probe, "old", "1 stale _ _"),
        input("as218822_ipv6_reachable", probe, "new", "_ _ _ 1"),
      ],
      promql_expr_test: [
        check("sessionHistory", "1m", []),
        check("probeHistory", "1m", []),
        check("sessionHistory", "1m30s", [[session, 1]]),
        check("sessionAvailability", "1m30s", [[session, 100]]),
        check("sessionChanges", "1m30s", [[session, 0]]),
      ],
    },
  ] }));
  const { stdout, stderr } = await promisify(execFile)(process.env.PROMTOOL, ["test", "rules", file]);
  assert.match(stdout, /SUCCESS/);
  assert.equal(stderr, "");
});
