export const ranges = { "1h": [3600, 60], "6h": [21600, 300], "24h": [86400, 900] };
const namespace = 'namespace="as218822"';
const containers = `${namespace},container!="",container!="POD",job="kubernetes-cadvisor"`;
const tailscale = 'job="as218822-tailscale"';
const rpki = 'job="as218822-rpki"';
const jobs = 'job=~"as218822-.+"';
const rate = (metric, selector) => `rate(${metric}{${selector}}[5m])`;
const traffic = (unit, by) => `sum by (${[...new Set([by, "direction"])].join(", ")}) (label_replace(${rate(`tailscaled_inbound_${unit}_total`, tailscale)}, "direction", "in", "", "") or label_replace(${rate(`tailscaled_outbound_${unit}_total`, tailscale)}, "direction", "out", "", ""))`;
const cpu = `sum by (pod, container) (${rate("container_cpu_usage_seconds_total", containers)})`;
const memory = `max by (pod, container) (container_memory_working_set_bytes{${containers}})`;
const nodeScope = `group by (node) (kube_pod_info{${namespace}})`;
const onNodes = (query) => `label_replace((${query}) * on(instance) group_left(nodename) node_uname_info{job="ne"}, "node", "$1", "nodename", "(.+)") and on(node) ${nodeScope}`;

// The browser chooses only a fixed time window. Queries and output labels are allowlisted here.
export function queryDefinitions(window, operator = false) {
  const definitions = operator ? {
    podInfo: ["Pod placement", `kube_pod_info{${namespace}}`],
    images: ["Container images", `kube_pod_container_info{${namespace}}`],
    cpu: ["Container CPU", cpu],
    memory: ["Container working memory", memory],
    requests: ["Resource requests", `max by (pod, container, resource, unit) (kube_pod_container_resource_requests{${namespace}})`],
    limits: ["Resource limits", `max by (pod, container, resource, unit) (kube_pod_container_resource_limits{${namespace}})`],
    restarts: ["Container restarts", `max by (pod, container) (kube_pod_container_status_restarts_total{${namespace}})`],
    restartIncrease: ["Restarts in window", `max by (pod, container) (increase(kube_pod_container_status_restarts_total{${namespace}}[${window}]))`],
    started: ["Container start time", `max by (pod, container) (kube_pod_container_state_started{${namespace}})`],
    reasons: ["Container failure reasons", `kube_pod_container_status_waiting_reason{${namespace}} == 1 or kube_pod_container_status_last_terminated_reason{${namespace}} == 1`],
    oom: ["OOM events in window", `sum by (pod, container) (increase(container_oom_events_total{${containers}}[${window}]))`],
    throttling: ["CPU throttling", `sum by (pod, container) (${rate("container_cpu_cfs_throttled_periods_total", containers)}) / sum by (pod, container) (${rate("container_cpu_cfs_periods_total", containers)}) * 100`],
    cpuHistory: ["CPU history", `sum by (pod) (${cpu})`, true],
    memoryHistory: ["Memory history", `sum by (pod) (${memory})`, true],
    networkIn: ["Interface receive rate", `sum by (pod, interface) (${rate("container_network_receive_bytes_total", `${namespace},job="kubernetes-cadvisor"`)})`],
    networkOut: ["Interface transmit rate", `sum by (pod, interface) (${rate("container_network_transmit_bytes_total", `${namespace},job="kubernetes-cadvisor"`)})`],
    networkErrors: ["Interface errors", `sum by (pod, interface) (${rate("container_network_receive_errors_total", `${namespace},job="kubernetes-cadvisor"`)} + ${rate("container_network_transmit_errors_total", `${namespace},job="kubernetes-cadvisor"`)})`],
    networkDrops: ["Interface drops", `sum by (pod, interface) (${rate("container_network_receive_packets_dropped_total", `${namespace},job="kubernetes-cadvisor"`)} + ${rate("container_network_transmit_packets_dropped_total", `${namespace},job="kubernetes-cadvisor"`)})`],
    diskReads: ["Container disk reads", `sum by (pod) (${rate("container_fs_reads_bytes_total", containers)})`],
    diskWrites: ["Container disk writes", `sum by (pod) (${rate("container_fs_writes_bytes_total", containers)})`],
    volumeCapacity: ["Volume filesystem capacity", `max by (persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes{${namespace}})`],
    volumeUsed: ["Volume filesystem usage", `max by (persistentvolumeclaim) (kubelet_volume_stats_used_bytes{${namespace}})`],
    volumeInodes: ["Volume inode usage", `max by (persistentvolumeclaim) (kubelet_volume_stats_inodes_used{${namespace}} / kubelet_volume_stats_inodes{${namespace}}) * 100`],
    volumeRequested: ["Requested volume size", `max by (persistentvolumeclaim) (kube_persistentvolumeclaim_resource_requests_storage_bytes{${namespace}})`],
    nodeInfo: ["Backing nodes", `label_replace(node_uname_info{job="ne"}, "node", "$1", "nodename", "(.+)") and on(node) ${nodeScope}`],
    nodeCpu: ["Node CPU utilization", onNodes('100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{job="ne",mode="idle"}[5m])))')],
    nodeMemory: ["Node memory utilization", onNodes('100 * (1 - node_memory_MemAvailable_bytes{job="ne"} / node_memory_MemTotal_bytes{job="ne"})')],
    nodeLoad: ["Node load average", onNodes('node_load1{job="ne"}')],
    nodeUptime: ["Node uptime", onNodes('time() - node_boot_time_seconds{job="ne"}')],
    nodeFilesystem: ["Node root filesystem", onNodes('100 * (1 - node_filesystem_avail_bytes{job="ne",mountpoint="/"} / node_filesystem_size_bytes{job="ne",mountpoint="/"})')],
    nodeConditions: ["Node conditions", `kube_node_status_condition{status="true"} and on(node) ${nodeScope}`],
    targets: ["Scrape targets", `up{${jobs}}`],
    scrapeDuration: ["Scrape duration", `scrape_duration_seconds{${jobs}}`],
    scrapeSamples: ["Scraped samples", `scrape_samples_scraped{${jobs}}`],
    targetAge: ["Target sample age", `time() - timestamp(up{${jobs}})`],
    overlayHealth: ["Overlay health", `{${tailscale},__name__=~"tailscaled_health_messages|tailscaled_advertised_routes|tailscaled_approved_routes|tailscaled_home_derp_region_id"}`],
    repositories: ["RPKI repository fetch status", `{${rpki},__name__=~"routinator_rrdp_status|routinator_rsync_status|routinator_rrdp_duration|routinator_rsync_duration"}`],
  } : {
    protocols: ["Routing protocols", "as218822_protocol_up"],
    protocolObserved: ["Protocol sample times", "timestamp(as218822_protocol_up)"],
    routers: ["Routing daemons", "as218822_bird_up"],
    reachability: ["IPv6 probes", "as218822_ipv6_reachable"],
    containers: ["Workload readiness", `kube_pod_container_status_ready{${namespace}}`],
    alerts: ["AS218822 alerts", 'ALERTS{alertname=~"AS218822.+",alertstate=~"firing|pending"}'],
    vrps: ["Validated route prefixes", `routinator_vrps_final{${rpki}}`],
    traffic: ["Overlay throughput", traffic("bytes", "pod")],
    trafficPaths: ["Overlay transport paths", traffic("bytes", "path")],
    packets: ["Overlay packet rate", traffic("packets", "pod")],
    drops: ["Overlay dropped packets", `sum by (reason) (${rate("tailscaled_outbound_dropped_packets_total", tailscale)})`],
    sessionAvailability: ["Sampled session availability", `avg_over_time(as218822_protocol_up{type="BGP"}[${window}]) * 100`],
    sessionChanges: ["Session state changes", `changes(as218822_protocol_up{type="BGP"}[${window}])`],
    sessionHistory: ["BGP session history", 'as218822_protocol_up{type="BGP"}', true],
    probeHistory: ["IPv6 probe history", "as218822_ipv6_reachable", true],
    trafficHistory: ["Overlay throughput history", traffic("bytes", "direction"), true],
    packetHistory: ["Overlay packet history", traffic("packets", "direction"), true],
    vrpHistory: ["VRP history", `routinator_vrps_final{${rpki}}`, true],
    trustAnchors: ["RPKI trust anchors", `routinator_ta_contributed_vrps_total{${rpki}}`],
    rpkiHealth: ["RPKI validation health", `{${rpki},__name__=~"routinator_last_update_start|routinator_last_update_done|routinator_last_update_duration|routinator_serial|routinator_stale_objects|routinator_rtr_current_connections"}`],
    collectors: ["Collector health", `min by (job) (up{job=~"as218822-.+|ksm"})`],
    collectorAge: ["Collector sample age", `max by (job) (time() - timestamp(up{job=~"as218822-.+|ksm"}))`],
  };
  return Object.fromEntries(Object.entries(definitions).map(([key, [label, query, history = false]]) => [key, { label, query, history }]));
}

const publicLabels = ["__name__", "protocol", "type", "location", "target", "container", "pod", "alertname", "severity", "alertstate", "job", "name", "direction", "path", "reason"];
const privateLabels = [...publicLabels, "node", "pod_ip", "host_ip", "image", "resource", "unit", "condition", "persistentvolumeclaim", "interface", "instance", "mountpoint", "device", "release", "machine", "uri", "repository"];
const finite = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const timestamp = (seconds) => new Date(Number(seconds) * 1000).toISOString();

export function createMonitoring(prometheusUrl, fetcher = fetch) {
  const cache = new Map();
  return async function monitoring(window = "6h", operator = false) {
    if (!Object.hasOwn(ranges, window)) throw new Error("Unsupported time window");
    const key = `${operator}:${window}`;
    const previous = cache.get(key);
    if (previous && Date.now() < previous.expires) return previous.promise;
    const entry = { expires: Infinity };
    entry.promise = (async () => {
      const [seconds, step] = ranges[window];
      const end = Math.floor(Date.now() / 1000 / step) * step;
      const definitions = Object.entries(queryDefinitions(window, operator));
      const metrics = {};
      let index = 0;
      // Bound concurrency as the number of curated signals grows.
      await Promise.all(Array.from({ length: 8 }, async () => {
        while (index < definitions.length) {
          const [id, definition] = definitions[index++];
          try {
            const url = new URL(`${prometheusUrl.replace(/\/$/, "")}/api/v1/${definition.history ? "query_range" : "query"}`);
            url.searchParams.set("query", definition.query);
            if (definition.history) {
              for (const [name, value] of Object.entries({ start: end - seconds, end, step })) url.searchParams.set(name, String(value));
            }
            const response = await fetcher(url, { signal: AbortSignal.timeout(5000) });
            if (!response.ok) throw new Error("Query failed");
            const body = await response.json();
            if (body.status !== "success" || !Array.isArray(body.data?.result)) throw new Error("Invalid metrics response");
            const labels = operator ? privateLabels : publicLabels;
            const series = body.data.result.map((item) => ({
              labels: Object.fromEntries(Object.entries(item.metric ?? {}).filter(([label]) => labels.includes(label))),
              ...(definition.history
                ? { values: (item.values ?? []).map(([time, value]) => ({ timestamp: timestamp(time), value: finite(value) })) }
                : { value: finite(item.value?.[1]), evaluatedAt: item.value ? timestamp(item.value[0]) : null }),
            }));
            metrics[id] = { label: definition.label, state: series.length ? "ok" : "empty", series };
          } catch {
            metrics[id] = { label: definition.label, state: "error", series: [] };
          }
        }
      }));
      if (Object.values(metrics).every((metric) => metric.state === "error")) throw new Error("Monitoring unavailable");
      const data = { generatedAt: new Date().toISOString(), range: window, start: timestamp(end - seconds), end: timestamp(end), stepSeconds: step, metrics };
      if (operator) return data;

      // Preserve the existing public status contract; additions never contain operator labels.
      const rows = (id) => metrics[id].series;
      const count = (id, predicate = () => true) => metrics[id].state === "ok" ? rows(id).filter(predicate).length : null;
      const protocols = rows("protocols").map(({ labels, value }) => ({
        name: labels.protocol, type: labels.type, location: labels.location, up: value === null ? null : value === 1,
        observedAt: (() => {
          const point = rows("protocolObserved").find((row) => row.labels.protocol === labels.protocol && row.labels.location === labels.location);
          return point?.value == null ? null : timestamp(point.value);
        })(),
      })).sort((a, b) => String(a.location).localeCompare(String(b.location)) || String(a.name).localeCompare(String(b.name)));
      const bgp = protocols.filter((row) => row.type === "BGP");
      const alerts = rows("alerts").map(({ labels }) => ({ name: labels.alertname, severity: labels.severity ?? "unknown", location: labels.location, protocol: labels.protocol, state: labels.alertstate }));
      const history = new Map();
      for (const series of rows("sessionHistory")) for (const point of series.values) {
        if (point.value === null) continue;
        const current = history.get(point.timestamp) ?? { timestamp: point.timestamp, up: 0, total: 0 };
        current.up += point.value === 1 ? 1 : 0;
        current.total++;
        history.set(point.timestamp, current);
      }
      const throughput = new Map();
      for (const series of rows("trafficHistory")) for (const point of series.values) {
        const current = throughput.get(point.timestamp) ?? { timestamp: point.timestamp, in: null, out: null };
        current[series.labels.direction] = point.value;
        throughput.set(point.timestamp, current);
      }
      return {
        ...data,
        summary: {
          bgpUp: bgp.length ? bgp.filter((row) => row.up).length : null, bgpTotal: bgp.length || null,
          routersUp: count("routers", (row) => row.value === 1), routersTotal: count("routers"),
          containersReady: count("containers", (row) => row.value === 1), containersTotal: count("containers"),
          activeAlerts: metrics.alerts.state === "error" ? null : alerts.filter((row) => row.state === "firing").length,
          vrps: rows("vrps")[0]?.value ?? null,
        },
        protocols, alerts,
        containers: rows("containers").map(({ labels, value }) => ({ name: labels.container, pod: labels.pod, ready: value === null ? null : value === 1 })),
        reachability: rows("reachability").map(({ labels, value }) => ({ location: labels.location, target: labels.target, reachable: value === null ? null : value === 1 })),
        traffic: rows("traffic").map(({ labels, value }) => ({ pod: labels.pod, direction: labels.direction, bytesPerSecond: value })),
        history: [...history.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
        trafficHistory: [...throughput.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      };
    })().then((data) => { entry.expires = Date.now() + 10000; return data; }).catch((error) => { cache.delete(key); throw error; });
    cache.set(key, entry);
    return entry.promise;
  };
}
