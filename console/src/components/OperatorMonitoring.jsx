import { Tag } from "@carbon/react";
import { Chart, Empty, Metric, Panel, State, TelemetryTable, Utilization, bytes, duration, number, percent, rate, reading, samples, total } from "./MonitoringWidgets.jsx";

export default function OperatorMonitoring({ data, publicData, stale }) {
  const podInfo = samples(data, "podInfo");
  const resources = samples(data, "images").map(({ labels }, index) => {
    const { pod, container } = labels;
    const match = { pod, container };
    const placement = podInfo.find((row) => row.labels.pod === pod)?.labels;
    return {
      id: `${pod}-${container}-${index}`, pod, container, image: labels.image, node: placement?.node,
      cpu: reading(data, "cpu", match), memory: reading(data, "memory", match),
      ready: publicData?.containers.find((row) => row.pod === pod && row.name === container)?.ready,
      restarts: reading(data, "restarts", match), changes: reading(data, "restartIncrease", match),
      started: reading(data, "started", match), oom: reading(data, "oom", match),
      memoryLimit: reading(data, "limits", { ...match, resource: "memory" }), cpuLimit: reading(data, "limits", { ...match, resource: "cpu" }),
      memoryRequest: reading(data, "requests", { ...match, resource: "memory" }), cpuRequest: reading(data, "requests", { ...match, resource: "cpu" }),
      throttling: reading(data, "throttling", match),
      reason: samples(data, "reasons").filter((row) => row.labels.pod === pod && row.labels.container === container).map((row) => row.labels.reason).join(", "),
    };
  });
  const details = (_, row) => <details className="resource-details"><summary>Details</summary><dl>
    <dt>Image</dt><dd>{row.image ?? "N/A"}</dd><dt>Node</dt><dd>{row.node ?? "N/A"}</dd>
    <dt>CPU request / limit</dt><dd>{row.cpuRequest == null ? "N/A" : `${number(row.cpuRequest * 1000, 1)} mCPU`} / {row.cpuLimit == null ? "Not reported" : `${number(row.cpuLimit * 1000, 1)} mCPU`}</dd>
    <dt>Memory request / limit</dt><dd>{bytes(row.memoryRequest)} / {bytes(row.memoryLimit)}</dd>
    <dt>CPU throttling</dt><dd>{percent(row.throttling)}</dd><dt>OOM events ({data.range})</dt><dd>{number(row.oom)}</dd>
    <dt>Container started</dt><dd>{row.started == null ? "N/A" : new Date(row.started * 1000).toLocaleString()}</dd>
    <dt>Last reported failure</dt><dd>{row.reason || "None reported"}</dd>
  </dl></details>;
  const interfaces = samples(data, "networkIn").map(({ labels, value }) => ({
    id: `${labels.pod}-${labels.interface}`, pod: labels.pod, interface: labels.interface, inbound: value,
    outbound: reading(data, "networkOut", labels), errors: reading(data, "networkErrors", labels), drops: reading(data, "networkDrops", labels),
  }));
  const volumes = samples(data, "volumeCapacity").map(({ labels, value }) => ({
    id: labels.persistentvolumeclaim, name: labels.persistentvolumeclaim, capacity: value,
    used: reading(data, "volumeUsed", labels), requested: reading(data, "volumeRequested", labels), inodes: reading(data, "volumeInodes", labels),
  }));
  const targets = samples(data, "targets").map(({ labels, value }) => ({
    id: `${labels.job}-${labels.instance}`, job: labels.job, endpoint: labels.instance, pod: labels.pod, up: value === null ? null : value === 1,
    duration: reading(data, "scrapeDuration", { job: labels.job, instance: labels.instance }),
    samples: reading(data, "scrapeSamples", { job: labels.job, instance: labels.instance }),
    age: reading(data, "targetAge", { job: labels.job, instance: labels.instance }),
  }));
  const repositories = samples(data, "repositories").filter((row) => row.labels.__name__.endsWith("_status")).map(({ labels, value }) => {
    const method = labels.__name__.includes("rrdp") ? "RRDP" : "rsync";
    return { id: `${method}-${labels.uri}`, uri: labels.uri, method, status: value, duration: reading(data, "repositories", { uri: labels.uri, __name__: labels.__name__.replace("_status", "_duration") }) };
  });
  const overlayPods = [...new Set(samples(data, "overlayHealth").map((row) => row.labels.pod))];
  const overlay = overlayPods.map((pod) => ({
    id: pod, pod, advertised: reading(data, "overlayHealth", { pod, __name__: "tailscaled_advertised_routes" }), approved: reading(data, "overlayHealth", { pod, __name__: "tailscaled_approved_routes" }),
    warnings: total(data, "overlayHealth", { pod, __name__: "tailscaled_health_messages" }), derp: reading(data, "overlayHealth", { pod, __name__: "tailscaled_home_derp_region_id" }),
  }));
  const diskData = samples(data, "diskReads").flatMap((row) => [
    { group: "Read", key: row.labels.pod, value: row.value }, { group: "Write", key: row.labels.pod, value: reading(data, "diskWrites", { pod: row.labels.pod }) },
  ]);
  return <>
    <div className="metrics-grid operator-metrics">
      <Metric label="Namespace CPU" value={total(data, "cpu") == null ? "N/A" : `${number(total(data, "cpu") * 1000, 1)} mCPU`} detail="1,000 mCPU = 1 CPU core" />
      <Metric label="Working memory" value={bytes(total(data, "memory"))} detail="Container working sets, not requests" />
      <Metric label={`Restarts / ${data.range}`} value={number(total(data, "restartIncrease"), 1)} detail="Counter increase in selected window" />
      <Metric label={`OOM events / ${data.range}`} value={number(total(data, "oom"))} detail="Out-of-memory events from cAdvisor" />
    </div>
    <div className="monitoring-grid">
      <div className="span-6"><Chart data={data} metric="cpuHistory" title="CPU by workload" description="Five-minute CPU rate in millicores." format={(value) => `${number(value * 1000, 1)} mCPU`} /></div>
      <div className="span-6"><Chart data={data} metric="memoryHistory" title="Memory by workload" description="Container working sets grouped by pod." format={bytes} /></div>
      <div className="span-12"><Panel title="Container diagnostics" description="AS218822 containers only. Missing limits or exporter metrics are not treated as zero."><TelemetryTable title="Container diagnostics" searchable rows={resources} columns={[
        ["container", "Container"], ["pod", "Pod"], ["ready", "Readiness", (value) => <State value={value} up="Ready" down="Not ready" stale={stale} />],
        ["cpu", "CPU", (value) => value == null ? "N/A" : `${number(value * 1000, 1)} mCPU`], ["memory", "Memory", bytes], ["memoryLimit", "Memory limit", bytes],
        ["restarts", "Restarts", number], ["changes", `In ${data.range}`, (value) => number(value, 1)], ["image", "Resources", details],
      ]} /></Panel></div>
      <div className="span-12"><h3 className="subsection-heading">Backing nodes</h3><p className="section-description">Shared host resources for nodes running AS218822 pods. These readings include other workloads on those hosts.</p></div>
      {samples(data, "nodeInfo").map(({ labels }) => <div className="span-6" key={labels.node}><Panel title={labels.node} description={`${labels.machine} / Linux ${labels.release}`}>
        <div className="node-conditions">{samples(data, "nodeConditions").filter((row) => row.labels.node === labels.node).map((row) => <State key={row.labels.condition} value={row.labels.condition === "Ready" ? row.value === 1 : row.value === 0} up={row.labels.condition === "Ready" ? "Ready" : `No ${row.labels.condition}`} down={row.labels.condition} stale={stale} />)}</div>
        <div className="node-utilization"><Utilization label="CPU utilization" value={reading(data, "nodeCpu", { node: labels.node })} /><Utilization label="Memory utilization" value={reading(data, "nodeMemory", { node: labels.node })} /><Utilization label="Root filesystem used" value={reading(data, "nodeFilesystem", { node: labels.node })} /></div>
        <dl className="readings"><div><dt>Load average / 1m</dt><dd>{number(reading(data, "nodeLoad", { node: labels.node }), 2)}</dd></div><div><dt>Uptime</dt><dd>{duration(reading(data, "nodeUptime", { node: labels.node }))}</dd></div></dl>
      </Panel></div>)}
      {!samples(data, "nodeInfo").length && <div className="span-12"><Empty error={data.metrics.nodeInfo.state === "error"}>No backing-node telemetry reported.</Empty></div>}
      <div className="span-12"><Panel title="Pod placement" description="Private addresses and scheduling information."><TelemetryTable title="Pod placement" rows={podInfo.map(({ labels }) => ({ id: labels.pod, ...labels }))} columns={[["pod", "Pod"], ["node", "Node"], ["pod_ip", "Pod address"], ["host_ip", "Host address"]]} /></Panel></div>
      <div className="span-8"><Panel title="Pod interfaces" description="Five-minute rates. Host-network pods can report shared host traffic; do not add these rates to overlay throughput."><TelemetryTable title="Pod interfaces" searchable rows={interfaces} columns={[["pod", "Pod"], ["interface", "Interface"], ["inbound", "Receive", rate], ["outbound", "Transmit", rate], ["errors", "Errors / s", (value) => number(value, 3)], ["drops", "Drops / s", (value) => number(value, 3)]]} /></Panel></div>
      <div className="span-4"><Chart data={data} metric="diskReads" kind="stacked" chartData={diskData} title="Workload disk I/O" description="Five-minute read and write rates." format={(value) => `${bytes(value)}/s`} /></div>
      <div className="span-12"><Panel title="Persistent storage" description="Kubelet filesystem statistics can describe the backing filesystem, not the requested PVC quota. Shared filesystems must not be summed."><TelemetryTable title="Persistent storage" rows={volumes} columns={[["name", "Volume claim"], ["requested", "Requested", bytes], ["used", "Filesystem used", bytes], ["capacity", "Filesystem capacity", bytes], ["inodes", "Inodes used", percent]]} /></Panel></div>
      <div className="span-12"><Panel title="Overlay diagnostics" description="Advertised and approved route counts are reported by Tailscale; they are not BGP route counts."><TelemetryTable title="Overlay diagnostics" rows={overlay} columns={[["pod", "Pod"], ["advertised", "Advertised routes", number], ["approved", "Approved routes", number], ["warnings", "Health messages", number], ["derp", "Home DERP region", number]]} /></Panel></div>
      <div className="span-12"><Panel title="Scrape diagnostics" description="Private collector endpoints, last scrape duration, sample count, and age."><TelemetryTable title="Scrape diagnostics" rows={targets} columns={[["job", "Collector"], ["endpoint", "Endpoint"], ["up", "Scrape", (value) => <State value={value} up="Successful" down="Failed" stale={stale} />], ["duration", "Duration", duration], ["samples", "Samples", number], ["age", "Sample age", duration]]} /></Panel></div>
      <div className="span-12"><Panel title="RPKI repository diagnostics" description="RRDP uses HTTP status codes (200 or 304 is successful); rsync uses process exit codes (0 is successful)."><TelemetryTable title="RPKI repositories" searchable rows={repositories} columns={[["uri", "Repository"], ["method", "Transport"], ["status", "Result", (value, row) => <Tag size="sm" type={stale || value == null ? "gray" : (row.method === "RRDP" ? [200, 304].includes(value) : value === 0) ? "green" : "red"}>{number(value)}</Tag>], ["duration", "Fetch duration", duration]]} /></Panel></div>
    </div>
  </>;
}
