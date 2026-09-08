import { useEffect, useState } from "react";
import { Button, Content, Header, HeaderName, InlineNotification, Select, SelectItem, SkipToContent, Tag, Theme, Toggle } from "@carbon/react";
import { Login, Logout, Renew } from "@carbon/icons-react";
import NetworkTopology from "./NetworkTopology.jsx";
import OperatorMonitoring from "./OperatorMonitoring.jsx";
import { Chart, Empty, Metric, Panel, State, StateHistory, TelemetryTable, duration, number, percent, rate, reading, samples, time, total } from "./MonitoringWidgets.jsx";
import "./Dashboard.css";

const navigation = [["overview", "Overview"], ["routing", "Routing"], ["traffic", "Traffic"], ["validation", "RPKI & probes"], ["workloads", "Workloads"], ["operator", "Operator"], ["sources", "Data sources"]];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [operator, setOperator] = useState(null);
  const [auth, setAuth] = useState(null);
  const [error, setError] = useState("");
  const [operatorError, setOperatorError] = useState("");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("6h");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("auth_error")) {
      setAuthError(url.searchParams.get("auth_error") === "access_denied" ? "Your identity is valid, but it is not permitted to view operator telemetry. Ask the console administrator to check the OIDC access rules." : "Sign-in could not be completed. Try again; if it continues, check the OIDC provider and console configuration.");
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const timer = window.setInterval(() => setClock(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!auth?.user) return;
    const timer = window.setTimeout(() => { setOperator(null); setClock(Date.now()); }, Math.max(0, new Date(auth.user.expiresAt).getTime() - Date.now()));
    return () => window.clearTimeout(timer);
  }, [auth]);

  useEffect(() => {
    let disposed = false;
    let busy = false;
    let controller;
    async function get(path) {
      const response = await fetch(path, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]) });
      const body = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
      if (!response.ok || !body) throw new Error(body?.error ?? `Monitoring service returned ${response.status}.`);
      return body;
    }
    async function load() {
      if (busy) return;
      busy = true;
      controller = new AbortController();
      setLoading(true);
      const publicRequest = get(`/api/status?range=${range}`).then((body) => {
        if (!disposed) { setData(body); setError(""); }
      }).catch((reason) => { if (!disposed) setError(reason.message); });
      const privateRequest = get("/api/auth").then(async (session) => {
        if (disposed) return;
        setAuth(session);
        if (!session.user) { setOperator(null); setOperatorError(""); return; }
        try {
          const body = await get(`/api/operator?range=${range}`);
          if (!disposed) { setOperator(body); setOperatorError(""); }
        } catch (reason) {
          // Never retain private diagnostics after a failed authorization check.
          if (!disposed) { setOperator(null); setOperatorError(reason.message); }
        }
      }).catch(() => {
        if (!disposed) { setAuth(null); setOperator(null); setOperatorError("Unable to check your session. Refresh to reconnect."); }
      });
      await Promise.all([publicRequest, privateRequest]);
      busy = false;
      if (!disposed) setLoading(false);
    }
    load();
    const timer = autoRefresh ? window.setInterval(() => { if (!document.hidden) load(); }, 30000) : null;
    const onVisible = () => { if (!document.hidden && autoRefresh) load(); };
    const onPageShow = (event) => { if (event.persisted) { setOperator(null); load(); } };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => { disposed = true; controller?.abort(); if (timer) window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("pageshow", onPageShow); };
  }, [range, refresh, autoRefresh]);

  async function logout() {
    setSigningOut(true);
    setOperator(null);
    try {
      const response = await fetch("/auth/logout", { method: "POST", headers: { "x-csrf-token": auth.user.csrfToken }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Sign-out failed. Refresh your session and try again.");
      window.location.replace("/#operator");
    } catch (reason) { setOperatorError(reason.message); setSigningOut(false); }
  }

  const current = data?.range === range ? data : null;
  const sessionValid = auth?.user && new Date(auth.user.expiresAt).getTime() > clock;
  const privateData = sessionValid && !signingOut && operator?.range === range ? operator : null;
  const age = current ? Math.max(0, (clock - new Date(current.generatedAt).getTime()) / 1000) : null;
  const stale = Boolean(error || (age !== null && age > 90));
  const privateStale = Boolean(operatorError || (privateData && clock - new Date(privateData.generatedAt).getTime() > 90000));
  const collectorIssue = Boolean(current && (current.metrics.collectors.state !== "ok" || current.metrics.collectorAge.state !== "ok" || ["as218822-bird", "as218822-tailscale", "as218822-rpki", "ksm"].some((job) => reading(current, "collectors", { job }) !== 1) || samples(current, "collectorAge").some((row) => row.value == null || row.value > 180)));
  const summary = current?.summary;
  const ratio = (up, count) => count == null ? "N/A" : `${number(up)} / ${number(count)}`;
  const protocols = current?.protocols ?? [];
  const probes = current?.reachability ?? [];
  const sessionRows = protocols.map((protocol) => ({
    id: `${protocol.location}-${protocol.name}`, name: protocol.name, location: protocol.location, type: protocol.type,
    up: protocol.up, observed: protocol.observedAt,
    availability: reading(current, "sessionAvailability", { protocol: protocol.name, location: protocol.location }),
    changes: reading(current, "sessionChanges", { protocol: protocol.name, location: protocol.location }),
  }));
  const bgpChart = current?.history.flatMap((point) => [
    { group: "Established", date: new Date(point.timestamp), value: point.up }, { group: "Observed", date: new Date(point.timestamp), value: point.total },
  ]) ?? [];
  const paths = samples(current, "trafficPaths").map((row) => ({ group: row.labels.direction === "in" ? "Inbound" : "Outbound", key: row.labels.path, value: row.value }));
  const workloadTraffic = samples(current, "traffic").map((row) => ({ group: row.labels.direction === "in" ? "Inbound" : "Outbound", key: row.labels.pod, value: row.value }));
  const rpki = (metric) => reading(current, "rpkiHealth", { __name__: `routinator_${metric}` });
  const failures = Object.entries(current?.metrics ?? {}).filter(([, metric]) => metric.state === "error");
  const privateFailures = Object.entries(privateData?.metrics ?? {}).filter(([, metric]) => metric.state === "error");
  const coverage = (snapshot, access) => Object.entries(snapshot?.metrics ?? {}).map(([id, metric]) => ({ id: `${access}-${id}`, name: metric.label, access, state: metric.state === "ok" ? "Reporting" : metric.state === "error" ? "Unavailable" : "No series", series: metric.series.length }));

  return <Theme theme="g100">
    <Header aria-label="AS218822 network console"><SkipToContent /><HeaderName href="#overview" prefix="AS218822">Network console</HeaderName><div className="header-access"><Tag type={sessionValid ? "purple" : "gray"} size="sm">{sessionValid ? "Operator access" : "Public / read-only"}</Tag></div></Header>
    <Content id="main-content" className="dashboard">
      <section id="overview" className="dashboard-intro"><div><h1>Network operations</h1><p>Live routing, reachability, and infrastructure telemetry for AS218822.</p></div><div className="snapshot-status" aria-live="polite"><Tag type={stale ? "red" : current ? "gray" : "gray"}>{stale ? "Stale snapshot" : current ? `Updated ${time(current.generatedAt)}` : loading ? "Connecting" : "Telemetry unavailable"}</Tag><span>{current ? `${duration(age)} ago` : "Waiting for monitoring data"}</span></div></section>
      <div className="dashboard-toolbar"><nav aria-label="Console sections">{navigation.map(([id, name]) => <a href={`#${id}`} key={id}>{name}</a>)}</nav><div className="telemetry-controls"><Select id="time-window" labelText="History window" hideLabel value={range} onChange={(event) => setRange(event.target.value)} size="sm"><SelectItem value="1h" text="Last 1 hour" /><SelectItem value="6h" text="Last 6 hours" /><SelectItem value="24h" text="Last 24 hours" /></Select><Toggle id="auto-refresh" size="sm" labelText="Automatic refresh" hideLabel toggled={autoRefresh} labelA="Paused" labelB="Every 30s" onToggle={setAutoRefresh} /><Button size="sm" kind="secondary" renderIcon={Renew} disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{loading ? "Refreshing" : "Refresh"}</Button></div></div>

      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Telemetry unavailable" subtitle={`${error} ${current ? "Showing the last successful snapshot, not live state." : "Use Refresh to try again."}`} />}
      {!error && stale && <InlineNotification kind="warning" lowContrast hideCloseButton title="This snapshot is out of date" subtitle="Refresh to see current state. Historical values below are retained for reference." />}
      {collectorIssue && <InlineNotification kind="warning" lowContrast hideCloseButton title="Monitoring coverage is degraded" subtitle="A collector is down or its samples are old. Missing resources must not be interpreted as healthy. See Data sources for details." />}
      {failures.length > 0 && <InlineNotification kind="warning" lowContrast hideCloseButton title={`${failures.length} telemetry sources unavailable`} subtitle={failures.map(([, metric]) => metric.label).join(", ")} />}

      <div className="metrics-grid">
        <Metric label="BGP established" value={ratio(summary?.bgpUp, summary?.bgpTotal)} detail={`${ratio(summary?.routersUp, summary?.routersTotal)} routing daemons up`} />
        <Metric label="Overlay throughput" value={rate(total(current, "traffic"))} detail={`In ${rate(total(current, "traffic", { direction: "in" }))} / Out ${rate(total(current, "traffic", { direction: "out" }))}`} />
        <Metric label="IPv6 probes" value={probes.length ? `${probes.filter((probe) => probe.reachable).length} / ${probes.length}` : "N/A"} detail="External targets reachable" />
        <Metric label="Ready containers" value={ratio(summary?.containersReady, summary?.containersTotal)} detail={current?.containers.length ? `${new Set(current.containers.map((row) => row.pod)).size} observed pods` : "Pod count unavailable"} />
        <Metric label="Firing alerts" value={number(summary?.activeAlerts)} detail={summary?.activeAlerts != null ? `${current.alerts.filter((alert) => alert.state === "pending").length} pending alert rules` : "Alert state unavailable"} />
        <Metric label="Validated prefixes" value={summary?.vrps == null ? "N/A" : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(summary.vrps)} detail="RPKI validated ROA payloads" />
      </div>

      <section id="routing" className="dashboard-section"><div className="section-heading"><div><h2>Routing health</h2><p>Current protocol state and sampled stability across every reporting location.</p></div><Tag type="gray">{range} window</Tag></div>
        <div className="monitoring-grid">
          <div className="span-7" id="topology"><Panel title="Live BGP topology" description="Logical relationships derived from session telemetry, not physical geography.">{current ? <NetworkTopology protocols={protocols} stale={stale || collectorIssue} /> : <Empty loading={loading} error={Boolean(error)} />}</Panel></div>
          <div className="span-5"><Chart data={current} metric="sessionHistory" title="BGP availability" description="Established versus observed sessions. A missing exporter can reduce both counts." chartData={bgpChart} loading={loading && !current} /><div className="router-summary">{samples(current, "routers").map((row) => <div key={row.labels.location}><span>{row.labels.location}</span><State value={row.value == null ? null : row.value === 1} up="BIRD online" down="BIRD down" stale={stale} /></div>)}</div></div>
          <div className="span-12"><Panel title="Session history" description="Each cell is a sampled state, not a continuous uptime guarantee. Gaps remain unfilled."><StateHistory data={current} metric="sessionHistory" loading={loading && !current} /></Panel></div>
          <div className="span-12" id="sessions"><Panel title="Routing protocols" description="BGP, RPKI, and supporting protocols. Availability and changes use 30-second logical session samples across pod replacements; transitions are not outage counts."><TelemetryTable title="Routing protocols" searchable pageSize={25} rows={sessionRows} empty={loading ? "Loading protocol state..." : "No protocols reported. Check collector health below."} columns={[["name", "Protocol"], ["location", "Location"], ["type", "Type"], ["up", "State", (value, row) => <State value={value} up={row.type === "BGP" ? "Established" : "Up"} stale={stale || (row.observed && clock - new Date(row.observed).getTime() > 180000)} />], ["availability", `Availability / ${range}`, percent], ["changes", "State changes", number], ["observed", "Last sample", time]]} /></Panel></div>
        </div>
      </section>

      <section id="traffic" className="dashboard-section"><div className="section-heading"><div><h2>Traffic & transport</h2><p>Tailscale overlay measurements only, not total BGP transit. Rates use a five-minute average.</p></div></div><div className="monitoring-grid">
        <div className="span-6"><Chart data={current} metric="trafficHistory" title="Overlay throughput" description="Inbound and outbound bit rates." format={rate} loading={loading && !current} /></div>
        <div className="span-6"><Chart data={current} metric="packetHistory" title="Packet rate" description="Packets received and sent per second." format={(value) => `${number(value, 1)} pps`} loading={loading && !current} /></div>
        <div className="span-6"><Chart data={current} metric="trafficPaths" kind="stacked" chartData={paths} title="Transport paths" description="Direct and relayed overlay traffic by address family." format={rate} loading={loading && !current} /></div>
        <div className="span-6"><Chart data={current} metric="traffic" kind="stacked" chartData={workloadTraffic} title="Throughput by workload" description="These are observed overlay endpoints; their traffic is not necessarily unique." format={rate} loading={loading && !current} /></div>
        <div className="span-12"><Panel title="Dropped overlay packets" description="Outbound drops by reason. This is a drop rate, not end-to-end packet loss."><TelemetryTable title="Dropped overlay packets" rows={samples(current, "drops").map((row) => ({ id: row.labels.reason, reason: row.labels.reason, rate: row.value }))} columns={[["reason", "Drop reason"], ["rate", "Packets / second", (value) => number(value, 4)]]} /></Panel></div>
      </div></section>

      <section id="validation" className="dashboard-section"><div className="section-heading"><div><h2>Reachability & route validation</h2><p>External IPv6 checks and the RPKI cache used by the routing daemons.</p></div></div><div className="monitoring-grid">
        <div className="span-12"><Panel title="IPv6 probe history" description="Reachability checks only. The current exporter does not report round-trip latency."><StateHistory data={current} metric="probeHistory" loading={loading && !current} /><div className="probe-current">{probes.map((probe) => <div key={`${probe.location}-${probe.target}`}><span>{probe.target}<small>{probe.location}</small></span><State value={probe.reachable} up="Reachable" down="Unreachable" stale={stale} /></div>)}</div></Panel></div>
        <div className="span-6"><Chart data={current} metric="vrpHistory" title="Validated prefix history" description="VRPs in the Routinator validation cache." group={() => "VRPs"} loading={loading && !current} /></div>
        <div className="span-6"><Chart data={current} metric="trustAnchors" title="Trust anchor contributions" description="Contributed VRPs by regional registry; duplicates between anchors can remain." group={(labels) => labels.name.toUpperCase()} kind="bar" loading={loading && !current} /></div>
        <div className="span-12"><Panel title="RPKI cache health" description="Update age is reported by Routinator. RTR connections are router-to-cache sessions."><dl className="readings rpki-readings">
          <div><dt>Last completed update</dt><dd>{duration(rpki("last_update_done"))} {rpki("last_update_done") !== null && "ago"}</dd></div>
          <div><dt>Last update started</dt><dd>{duration(rpki("last_update_start"))} {rpki("last_update_start") !== null && "ago"}</dd></div>
          <div><dt>Validation duration</dt><dd>{duration(rpki("last_update_duration"))}</dd></div>
          <div><dt>Cache serial</dt><dd>{number(rpki("serial"))}</dd></div><div><dt>Stale objects</dt><dd>{number(rpki("stale_objects"))}</dd></div><div><dt>RTR connections</dt><dd>{number(rpki("rtr_current_connections"))}</dd></div>
        </dl></Panel></div>
      </div></section>

      <section id="workloads" className="dashboard-section"><div className="section-heading"><div><h2>Workloads & alerts</h2><p>Readiness and AS218822 alert rules. Resource diagnostics are available in the operator view.</p></div></div><div className="monitoring-grid">
        <div className="span-7"><Panel title="Container readiness"><TelemetryTable title="Workloads" searchable rows={(current?.containers ?? []).map((row) => ({ id: `${row.pod}-${row.name}`, ...row }))} columns={[["name", "Container"], ["pod", "Pod"], ["ready", "Readiness", (value) => <State value={value} up="Ready" down="Not ready" stale={stale} />]]} /></Panel></div>
        <div className="span-5"><Panel title="Active & pending alerts" description="Pending rules have not yet reached their configured firing duration.">{!current ? <Empty loading={loading} error={Boolean(error)} /> : current.metrics.alerts.state === "error" ? <Empty error /> : current.alerts.length ? <div className="alert-list">{current.alerts.map((alert, index) => <InlineNotification key={`${alert.name}-${alert.location}-${alert.protocol}-${index}`} kind={alert.severity === "critical" ? "error" : "warning"} lowContrast hideCloseButton title={alert.name} subtitle={[alert.state, alert.severity, alert.location, alert.protocol].filter(Boolean).join(" / ")} />)}</div> : <InlineNotification kind={stale || collectorIssue ? "info" : "success"} lowContrast hideCloseButton title={stale || collectorIssue ? "No alerts in this snapshot" : "No active AS218822 alerts"} subtitle={stale || collectorIssue ? "Monitoring is stale or incomplete; this is not a health guarantee." : "No firing or pending rules reported."} />}</Panel></div>
      </div></section>

      <section id="operator" className="dashboard-section"><div className="section-heading"><div><h2>Operator diagnostics</h2><p>Private infrastructure telemetry, protected by OIDC. All operations remain read-only.</p></div><Tag type={sessionValid ? "purple" : "gray"}>{sessionValid ? "Authenticated" : "Sign-in required"}</Tag></div>
        {authError && <InlineNotification kind="error" lowContrast hideCloseButton title="Operator sign-in" subtitle={authError} />}
        {operatorError && <InlineNotification kind="error" lowContrast hideCloseButton title="Operator telemetry unavailable" subtitle={operatorError} />}
        {sessionValid ? <div className="operator-access"><div><strong>{auth.user.name}</strong><p>Session expires {time(auth.user.expiresAt)}. Private readings are not included in the public API.</p></div><Button size="sm" kind="tertiary" renderIcon={Logout} disabled={signingOut} onClick={logout}>{signingOut ? "Signing out" : "Sign out"}</Button></div> : <div className="operator-access"><div><h3>{auth?.enabled ? "Sign in to inspect infrastructure" : auth ? "Operator access is not configured" : "Checking operator access"}</h3><p>{auth?.enabled ? "Unlock container CPU and memory, restarts, node health, interfaces, storage, private addresses, and scrape diagnostics." : auth ? "Configure OIDC on the server to enable private diagnostics. They are never exposed anonymously." : "Public telemetry remains available while the session is checked."}</p></div>{auth?.enabled && <Button href="/auth/login" renderIcon={Login}>Sign in with OIDC</Button>}</div>}
        {auth?.user && !sessionValid && <InlineNotification kind="info" lowContrast hideCloseButton title="Your operator session has expired" subtitle="Private diagnostics have been hidden. Sign in again to continue." />}
        {privateStale && <InlineNotification kind="warning" lowContrast hideCloseButton title="Private snapshot is stale" subtitle="Refresh before interpreting these readings as current." />}
        {privateFailures.length > 0 && <InlineNotification kind="warning" lowContrast hideCloseButton title={`${privateFailures.length} private sources unavailable`} subtitle={privateFailures.map(([, metric]) => metric.label).join(", ")} />}
        {privateData ? <OperatorMonitoring data={privateData} publicData={current} stale={privateStale} /> : sessionValid && loading ? <Empty loading /> : null}
      </section>

      <section id="sources" className="dashboard-section"><div className="section-heading"><div><h2>Data sources & coverage</h2><p>Know what is measured before drawing conclusions.</p></div></div><div className="monitoring-grid">
        <div className="span-7"><Panel title="Collector health" description="A successful API refresh does not guarantee every exporter is reporting."><TelemetryTable title="Collectors" rows={samples(current, "collectors").map((row) => ({ id: row.labels.job, name: row.labels.job, up: row.value == null ? null : row.value === 1, age: reading(current, "collectorAge", { job: row.labels.job }) }))} columns={[["name", "Collector"], ["up", "Scrape state", (value, row) => <State value={value} up="Reporting" down="Failed" stale={stale || row.age > 180} />], ["age", "Sample age", duration]]} /></Panel></div>
        <div className="span-5"><Panel title="Measurement boundaries"><ul className="coverage-notes"><li>Historical availability is based on observed samples, not an SLA.</li><li>Overlay throughput is not total network transit.</li><li>Latency, per-peer route counts, and routing-table contents are not collected by the current exporter.</li><li>Missing values are N/A, never a fabricated zero.</li><li>Only fixed, curated queries are accepted. No infrastructure controls, secrets, or arbitrary queries are exposed.</li></ul></Panel></div>
        <div className="span-12"><details className="coverage-details"><summary>Inspect telemetry coverage ({coverage(current, "Public").length + coverage(privateData, "Operator").length} sources)</summary><TelemetryTable title="Telemetry coverage" searchable rows={[...coverage(current, "Public"), ...coverage(privateData, "Operator")]} columns={[["name", "Signal"], ["access", "Access"], ["state", "Source state"], ["series", "Series", number]]} /></details></div>
      </div></section>

      <footer className="registry-footer"><div><strong>AS218822</strong><span>IPv6 autonomous system</span></div><div><span>Origin prefix</span><code>2a06:9801:ff0::/44</code></div><a href="https://as218822.net/peering/">Open peering policy</a><a href="https://www.peeringdb.com/net/43433">PeeringDB #43433</a><span>Times shown in your local timezone</span></footer>
    </Content>
  </Theme>;
}
