import { useDeferredValue, useId, useState } from "react";
import { LineChart, SimpleBarChart, StackedBarChart } from "@carbon/charts-react";
import { Pagination, Search, SkeletonText, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag, Tile } from "@carbon/react";
import { ArrowDown, ArrowsVertical, ArrowUp } from "@carbon/icons-react";

export const samples = (data, key) => data?.metrics[key]?.series ?? [];
export const reading = (data, key, labels = {}) => samples(data, key).find((sample) => Object.entries(labels).every(([label, value]) => sample.labels[label] === value))?.value ?? null;
export const total = (data, key, labels = {}) => {
  const values = samples(data, key).filter((sample) => Object.entries(labels).every(([label, value]) => sample.labels[label] === value)).map((sample) => sample.value).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
};
export const number = (value, digits = 0) => value == null ? "N/A" : value.toLocaleString("en", { maximumFractionDigits: typeof digits === "number" ? digits : 0 });
export const percent = (value) => value == null ? "N/A" : `${number(value, 2)}%`;
export const time = (value) => !value ? "N/A" : new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export function bytes(value) {
  if (value == null) return "N/A";
  const tier = Math.min(4, Math.floor(Math.log2(Math.max(1, value)) / 10));
  return `${number(value / (1024 ** tier), tier ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][tier]}`;
}
export function rate(value) {
  if (value == null) return "N/A";
  const bits = Math.max(0, value) * 8;
  const tier = Math.min(4, Math.floor(Math.log10(Math.max(1, bits)) / 3));
  return `${number(bits / (1000 ** tier), tier ? 1 : 0)} ${["bps", "Kbps", "Mbps", "Gbps", "Tbps"][tier]}`;
}
export function duration(seconds) {
  if (seconds == null) return "N/A";
  if (seconds < 60) return `${number(Math.max(0, seconds), 1)}s`;
  if (seconds < 3600) return `${number(seconds / 60)}m`;
  if (seconds < 86400) return `${number(seconds / 3600, 1)}h`;
  return `${number(seconds / 86400, 1)}d`;
}

export function State({ value, up = "Up", down = "Down", stale = false }) {
  return <Tag size="sm" type={stale || value == null ? "gray" : value ? "green" : "red"}>{stale ? "Stale" : value == null ? "Unknown" : value ? up : down}</Tag>;
}

export function Empty({ loading = false, error = false, children = "No samples reported for this time window." }) {
  return loading ? <SkeletonText paragraph lineCount={5} /> : <p className={`monitoring-empty${error ? " monitoring-empty--error" : ""}`}>{error ? "This source is unavailable. Other telemetry remains visible; try refreshing." : children}</p>;
}

export function Panel({ title, description, children, className = "" }) {
  const id = useId();
  return <Tile className={`monitoring-panel ${className}`}><section aria-labelledby={id}><div className="panel-heading"><h3 id={id}>{title}</h3>{description && <p>{description}</p>}</div>{children}</section></Tile>;
}

export function Metric({ label, value, detail }) {
  return <Tile className="monitoring-metric"><dl><dt>{label}</dt><dd>{value}</dd></dl><p>{detail}</p></Tile>;
}

export function Utilization({ value, label }) {
  return <div className="utilization"><div><span>{label}</span><strong>{percent(value)}</strong></div>{value != null && <meter min="0" max="100" value={Math.min(100, Math.max(0, value))} aria-label={label} />}</div>;
}

export function TelemetryTable({ title, description, columns, rows, empty, searchable = false, pageSize = 10 }) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [sort, setSort] = useState({ key: "", direction: 1 });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const id = useId();
  const filtered = rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(deferred.toLowerCase())));
  if (sort.key) filtered.sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    return sort.direction * (typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "en", { numeric: true }));
  });
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / size)));
  return <div className="telemetry-table">
    {description && <p className="table-description">{description}</p>}
    {searchable && <Search id={id} labelText={`Search ${title}`} placeholder={`Search ${title.toLowerCase()}`} size="lg" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} onClear={() => { setQuery(""); setPage(1); }} />}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${title}, scroll horizontally for more columns`}>
      <Table size="sm" aria-label={title}>
        <TableHead><TableRow>{columns.map(([key, label]) => <TableHeader key={key} aria-sort={sort.key === key ? sort.direction === 1 ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => setSort({ key, direction: sort.key === key ? -sort.direction : 1 })}>{label}{sort.key === key ? sort.direction === 1 ? <ArrowUp size={16} /> : <ArrowDown size={16} /> : <ArrowsVertical size={16} />}</button></TableHeader>)}</TableRow></TableHead>
        <TableBody>{filtered.slice((currentPage - 1) * size, currentPage * size).map((row) => <TableRow key={row.id}>{columns.map(([key, , render]) => <TableCell key={key}>{render ? render(row[key], row) : row[key] ?? "N/A"}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
    {!filtered.length && <Empty>{query ? "No matching rows. Try a different search." : empty ?? "No samples reported."}</Empty>}
    {filtered.length > pageSize && <Pagination size="sm" page={currentPage} pageSize={size} pageSizes={[pageSize, 25, 50].filter((value, index, values) => values.indexOf(value) === index)} totalItems={filtered.length} onChange={({ page, pageSize }) => { setPage(page); setSize(pageSize); }} />}
  </div>;
}

const chartBase = {
  height: "18rem", theme: "g100", toolbar: { enabled: false }, points: { enabled: false }, animations: false,
  color: { scale: { Inbound: "#78a9ff", Outbound: "#3ddbd9", Established: "#42be65", Observed: "#a56eff" } },
};

export function Chart({ data, metric, title, description, group = (labels) => labels.direction === "in" ? "Inbound" : labels.direction === "out" ? "Outbound" : labels.pod ?? labels.name ?? "Value", format = number, loading = false, kind = "line", chartData }) {
  const [expanded, setExpanded] = useState(false);
  const series = samples(data, metric);
  const points = [...(chartData ?? (kind === "line" ? series.flatMap((sample) => sample.values.map((point) => ({ group: group(sample.labels), date: new Date(point.timestamp), value: point.value }))) : series.map((sample) => ({ group: group(sample.labels), value: sample.value }))))];
  if (kind === "line" && data) {
    const groups = [...new Set(points.map((point) => point.group))];
    for (const name of groups) {
      const existing = new Set(points.filter((point) => point.group === name).map((point) => point.date.getTime()));
      for (let date = new Date(data.start).getTime(); date <= new Date(data.end).getTime(); date += data.stepSeconds * 1000) {
        if (!existing.has(date)) points.push({ group: name, date: new Date(date), value: null });
      }
    }
    points.sort((a, b) => a.date - b.date);
  }
  const valid = points.some((point) => point.value != null);
  const options = {
    ...chartBase,
    color: { scale: Object.fromEntries(Object.entries(chartBase.color.scale).filter(([name]) => points.some((point) => point.group === name))) },
    axes: kind === "line" ? {
      bottom: { mapsTo: "date", scaleType: "time" }, left: { mapsTo: "value", scaleType: "linear", ticks: { formatter: format } },
    } : {
      left: { mapsTo: kind === "stacked" ? "key" : "group", scaleType: "labels" }, bottom: { mapsTo: "value", scaleType: "linear", ticks: { formatter: format } },
    },
    legend: { enabled: kind !== "bar" },
    tooltip: { valueFormatter: (value) => value instanceof Date ? value.toLocaleString() : typeof value === "number" || value == null ? format(value) : String(value) },
    accessibility: { svgAriaLabel: title },
  };
  const Component = kind === "bar" ? SimpleBarChart : kind === "stacked" ? StackedBarChart : LineChart;
  return <Panel title={title} description={description}>
    {valid ? <Component data={points} options={options} /> : <Empty loading={loading} error={data?.metrics[metric]?.state === "error"} />}
    {valid && <details className="sample-details" onToggle={(event) => setExpanded(event.currentTarget.open)}><summary>Inspect chart data</summary>{expanded && <TelemetryTable title={`${title} samples`} searchable columns={kind === "line" ? [["timestamp", "Time", (value) => new Date(value).toLocaleString()], ["group", "Series"], ["value", "Value", format]] : [["group", "Series"], ...(kind === "stacked" ? [["key", "Resource"]] : []), ["value", "Value", format]]} rows={points.map((point, index) => ({ ...point, id: String(index), timestamp: point.date?.toISOString() }))} />}</details>}
  </Panel>;
}

export function StateHistory({ data, metric, loading = false, label = (labels) => `${labels.location} / ${labels.protocol ?? labels.target}` }) {
  const [expanded, setExpanded] = useState(false);
  const series = samples(data, metric);
  if (!series.length) return <Empty loading={loading} error={data?.metrics[metric]?.state === "error"} />;
  const start = new Date(data.start).getTime();
  const end = new Date(data.end).getTime();
  const timestamps = Array.from({ length: Math.round((end - start) / (data.stepSeconds * 1000)) + 1 }, (_, index) => start + index * data.stepSeconds * 1000);
  const rows = series.map((sample) => {
    const values = new Map(sample.values.map((point) => [new Date(point.timestamp).getTime(), point.value]));
    const points = timestamps.map((timestamp) => ({ timestamp, value: values.get(timestamp) ?? null }));
    const observed = points.filter((point) => point.value != null);
    const up = observed.filter((point) => point.value === 1).length;
    return { name: label(sample.labels), points, observed: observed.length, up };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return <>
    <div className="history-legend"><span><i className="history-key is-up" />Up</span><span><i className="history-key is-down" />Down</span><span><i className="history-key is-missing" />No sample</span><span>{duration(data.stepSeconds)} resolution</span></div>
    <div className="state-history">{rows.map((row) => <div className="history-row" key={row.name}><span className="history-label">{row.name}</span><div className="history-track" role="img" aria-label={`${row.name}: ${row.up} up, ${row.observed - row.up} down, ${row.points.length - row.observed} missing samples`}>{row.points.map((point) => <span key={point.timestamp} className={point.value == null ? "is-missing" : point.value === 1 ? "is-up" : "is-down"} title={`${new Date(point.timestamp).toLocaleString()}: ${point.value == null ? "No sample" : point.value === 1 ? "Up" : "Down"}`} />)}</div><span className="history-percent">{row.observed ? percent(row.up / row.observed * 100) : "N/A"}</span></div>)}</div>
    <div className="history-axis"><span>{time(data.start)}</span><span>{time(data.end)}</span></div>
    <details className="sample-details" onToggle={(event) => setExpanded(event.currentTarget.open)}><summary>Inspect state samples</summary>{expanded && <TelemetryTable title="State history" searchable columns={[["name", "Resource"], ["timestamp", "Time", (value) => new Date(value).toLocaleString()], ["state", "State"]]} rows={rows.flatMap((row) => row.points.map((point) => ({ id: `${row.name}-${point.timestamp}`, name: row.name, timestamp: new Date(point.timestamp).toISOString(), state: point.value == null ? "No sample" : point.value === 1 ? "Up" : "Down" })))} />}</details>
  </>;
}
