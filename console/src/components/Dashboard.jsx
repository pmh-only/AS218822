import { useEffect, useState } from "react";
import {
  Button,
  Column,
  Content,
  DataTable,
  Grid,
  Header,
  HeaderMenuItem,
  HeaderName,
  HeaderNavigation,
  InlineNotification,
  ProgressBar,
  SkeletonText,
  SkipToContent,
  Stack,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Theme,
  Tile,
} from "@carbon/react";
import { Renew } from "@carbon/icons-react";
import { LineChart } from "@carbon/charts-react";
import NetworkTopology from "./NetworkTopology.jsx";

const sessionHeaders = [
  { key: "name", header: "Session" },
  { key: "location", header: "Location" },
  { key: "state", header: "State" },
  { key: "observed", header: "Observed" },
];

const chartBase = {
  axes: {
    bottom: { mapsTo: "date", scaleType: "time" },
    left: { mapsTo: "value", scaleType: "linear" },
  },
  height: "20rem",
  theme: "g100",
  toolbar: { enabled: false },
  points: { enabled: false },
  animations: true,
};

function formatRate(bytes) {
  const bits = Math.max(0, Number(bytes) || 0) * 8;
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  const tier = Math.min(Math.floor(Math.log10(Math.max(bits, 1)) / 3), units.length - 1);
  return `${(bits / (1000 ** tier)).toLocaleString("en", { maximumFractionDigits: tier ? 1 : 0 })} ${units[tier]}`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function MetricTile({ label, value, detail, status, statusType = "green", progress }) {
  return (
    <Tile>
      <Stack gap={5}>
        <Stack orientation="horizontal" gap={3}>
          <p className="cds--type-label-01">{label}</p>
          {status && <Tag type={statusType} size="sm">{status}</Tag>}
        </Stack>
        <p className="cds--type-heading-06">{value}</p>
        {progress === undefined ? <p className="cds--type-helper-text-01">{detail}</p> : <ProgressBar label={detail} value={progress} size="small" />}
      </Stack>
    </Tile>
  );
}

function StateList({ items, empty }) {
  if (!items.length) return <InlineNotification kind="info" lowContrast hideCloseButton title={empty} />;
  return (
    <StructuredListWrapper isCondensed>
      <StructuredListHead>
        <StructuredListRow head>
          <StructuredListCell head>Resource</StructuredListCell>
          <StructuredListCell head>Status</StructuredListCell>
        </StructuredListRow>
      </StructuredListHead>
      <StructuredListBody>
        {items.map((item) => (
          <StructuredListRow key={item.id}>
            <StructuredListCell><strong>{item.name}</strong><br /><span className="cds--type-helper-text-01">{item.detail}</span></StructuredListCell>
            <StructuredListCell><Tag type={item.up ? "green" : "red"} size="sm">{item.up ? item.upLabel : item.downLabel}</Tag></StructuredListCell>
          </StructuredListRow>
        ))}
      </StructuredListBody>
    </StructuredListWrapper>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      const body = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
      if (!response.ok) throw new Error(body?.error || `Monitoring service returned ${response.status}.`);
      if (!body) throw new Error("Monitoring service returned an unreadable response.");
      setData(body);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Monitoring data is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const summary = data?.summary;
  const bgpPercent = summary?.bgpTotal ? Math.round((summary.bgpUp / summary.bgpTotal) * 100) : 0;
  const routerPercent = summary?.routersTotal ? Math.round((summary.routersUp / summary.routersTotal) * 100) : 0;
  const containerPercent = summary?.containersTotal ? Math.round((summary.containersReady / summary.containersTotal) * 100) : 0;
  const inbound = data?.traffic.filter((item) => item.direction === "in").reduce((total, item) => total + item.bytesPerSecond, 0) ?? 0;
  const outbound = data?.traffic.filter((item) => item.direction === "out").reduce((total, item) => total + item.bytesPerSecond, 0) ?? 0;
  const sessionRows = data?.protocols.filter((protocol) => protocol.type === "BGP").map((protocol) => ({
    id: `${protocol.location}-${protocol.name}`,
    name: protocol.name.replaceAll("_", " "),
    location: protocol.location,
    state: protocol.up ? "Established" : "Down",
    observed: formatTime(protocol.observedAt),
    up: protocol.up,
  })) ?? [];
  const bgpChartData = data?.history.flatMap((point) => [
    { group: "Established", date: new Date(point.timestamp), value: point.up },
    { group: "Configured", date: new Date(point.timestamp), value: point.total },
  ]) ?? [];
  const trafficChartData = data?.trafficHistory.flatMap((point) => [
    { group: "Inbound", date: new Date(point.timestamp), value: point.in * 8 },
    { group: "Outbound", date: new Date(point.timestamp), value: point.out * 8 },
  ]) ?? [];
  const trafficOptions = {
    ...chartBase,
    axes: {
      ...chartBase.axes,
      left: { ...chartBase.axes.left, ticks: { formatter: (value) => formatRate(value / 8) } },
    },
  };

  return (
    <Theme theme="g100">
      <Header aria-label="AS218822 network console">
        <SkipToContent />
        <HeaderName href="#overview" prefix="AS218822">Network console</HeaderName>
        <HeaderNavigation aria-label="Network console navigation">
          <HeaderMenuItem href="#overview">Overview</HeaderMenuItem>
          <HeaderMenuItem href="#topology">Topology</HeaderMenuItem>
          <HeaderMenuItem href="#graphs">Graphs</HeaderMenuItem>
          <HeaderMenuItem href="#sessions">Sessions</HeaderMenuItem>
          <HeaderMenuItem href="#infrastructure">Infrastructure</HeaderMenuItem>
        </HeaderNavigation>
      </Header>

      <Content id="main-content">
        <Stack gap={7}>
          <Grid fullWidth id="overview">
            <Column sm={4} md={6} lg={12}>
              <Stack gap={3}>
                <p className="cds--type-label-01">PUBLIC TELEMETRY / IPV6 AUTONOMOUS SYSTEM</p>
                <h1 className="cds--type-heading-07">Network operations</h1>
                <p className="cds--type-body-compact-01">Live operational evidence for AS218822, refreshed every 30 seconds.</p>
              </Stack>
            </Column>
            <Column sm={4} md={2} lg={4}>
              <Stack gap={3}>
                <Button kind="secondary" renderIcon={Renew} disabled={loading} onClick={refresh}>Refresh telemetry</Button>
                <Tag type={error ? "red" : data ? "green" : "gray"}>{error ? "Telemetry unavailable" : data ? `Updated ${formatTime(data.generatedAt)}` : "Connecting"}</Tag>
              </Stack>
            </Column>
            {error && <Column sm={4} md={8} lg={16}><InlineNotification kind="error" lowContrast hideCloseButton title="Telemetry unavailable" subtitle={`${error} Try refreshing in a moment.`} /></Column>}
          </Grid>

          <Grid fullWidth>
            <Column sm={4} md={4} lg={4}>{summary ? <MetricTile label="BGP established" value={`${summary.bgpUp} / ${summary.bgpTotal}`} detail="Live sessions" status={bgpPercent === 100 ? "Healthy" : "Degraded"} statusType={bgpPercent === 100 ? "green" : "warm-gray"} progress={bgpPercent} /> : <Tile><SkeletonText heading /><SkeletonText /></Tile>}</Column>
            <Column sm={4} md={4} lg={4}>{summary ? <MetricTile label="Aggregate traffic" value={formatRate(inbound + outbound)} detail={`In ${formatRate(inbound)} / Out ${formatRate(outbound)}`} status="5 min rate" statusType="purple" /> : <Tile><SkeletonText heading /><SkeletonText /></Tile>}</Column>
            <Column sm={2} md={2} lg={2}>{summary ? <MetricTile label="Routers" value={`${summary.routersUp} / ${summary.routersTotal}`} detail="Online" progress={routerPercent} /> : <Tile><SkeletonText heading /></Tile>}</Column>
            <Column sm={2} md={2} lg={2}>{summary ? <MetricTile label="Pods" value={`${summary.containersReady} / ${summary.containersTotal}`} detail="Ready" progress={containerPercent} /> : <Tile><SkeletonText heading /></Tile>}</Column>
            <Column sm={2} md={2} lg={2}>{summary ? <MetricTile label="Alerts" value={String(summary.activeAlerts)} detail="Firing rules" status={summary.activeAlerts ? "Action required" : "Clear"} statusType={summary.activeAlerts ? "red" : "green"} /> : <Tile><SkeletonText heading /></Tile>}</Column>
            <Column sm={2} md={2} lg={2}>{summary ? <MetricTile label="RPKI" value={summary.vrps === null ? "N/A" : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(summary.vrps)} detail="VRPs" /> : <Tile><SkeletonText heading /></Tile>}</Column>
          </Grid>

          <Grid fullWidth id="topology">
            <Column sm={4} md={8} lg={16}>
              <Tile>
                <Stack gap={4}>
                  <div>
                    <h2 className="cds--type-heading-04">Live BGP topology</h2>
                    <p className="cds--type-helper-text-01">Logical routing relationships derived from current BGP session telemetry.</p>
                  </div>
                  {data ? <NetworkTopology protocols={data.protocols} /> : <SkeletonText paragraph lineCount={10} />}
                </Stack>
              </Tile>
            </Column>
          </Grid>

          <Grid fullWidth id="graphs">
            <Column sm={4} md={8} lg={9}>
              <Tile>
                <Stack gap={4}>
                  <h2 className="cds--type-heading-04">BGP availability</h2>
                  {bgpChartData.length ? <LineChart data={bgpChartData} options={{ ...chartBase, legend: { enabled: true } }} /> : <SkeletonText paragraph lineCount={6} />}
                </Stack>
              </Tile>
            </Column>
            <Column sm={4} md={8} lg={7}>
              <Tile>
                <Stack gap={4}>
                  <h2 className="cds--type-heading-04">Network throughput</h2>
                  {trafficChartData.length ? <LineChart data={trafficChartData} options={{ ...trafficOptions, legend: { enabled: true } }} /> : <SkeletonText paragraph lineCount={6} />}
                </Stack>
              </Tile>
            </Column>
          </Grid>

          <Grid fullWidth>
            <Column sm={4} md={8} lg={10} id="sessions">
            <DataTable rows={sessionRows} headers={sessionHeaders} size="sm">
              {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
                <TableContainer title="BGP sessions" description={summary ? `${summary.bgpUp} of ${summary.bgpTotal} established` : "Loading live state"}>
                  <Table {...getTableProps()}>
                    <TableHead><TableRow>{headers.map((header) => <TableHeader {...getHeaderProps({ header })} key={header.key}>{header.header}</TableHeader>)}</TableRow></TableHead>
                    <TableBody>{rows.map((row) => <TableRow {...getRowProps({ row })} key={row.id}>{row.cells.map((cell) => <TableCell key={cell.id}>{cell.info.header === "state" ? <Tag type={sessionRows.find((item) => item.id === row.id)?.up ? "green" : "red"} size="sm">{cell.value}</Tag> : cell.value}</TableCell>)}</TableRow>)}</TableBody>
                  </Table>
                </TableContainer>
              )}
            </DataTable>
            </Column>
            <Column sm={4} md={8} lg={6} id="infrastructure">
              <Stack gap={5}>
                <Tile><Stack gap={4}><h2 className="cds--type-heading-04">IPv6 probes</h2><StateList empty="No probes configured" items={data?.reachability.map((probe) => ({ id: `${probe.location}-${probe.target}`, name: probe.target, detail: probe.location, up: probe.reachable, upLabel: "Reachable", downLabel: "Failed" })) ?? []} /></Stack></Tile>
                <Tile><Stack gap={4}><h2 className="cds--type-heading-04">Workloads</h2><StateList empty="No workloads reported" items={data?.containers.map((container) => ({ id: `${container.pod}-${container.name}`, name: container.name, detail: container.pod, up: container.ready, upLabel: "Ready", downLabel: "Not ready" })) ?? []} /></Stack></Tile>
                <Tile><Stack gap={4}><h2 className="cds--type-heading-04">Active alerts</h2>{data?.alerts.length ? data.alerts.map((alert) => <InlineNotification key={`${alert.name}-${alert.location}`} kind="warning" lowContrast hideCloseButton title={alert.name.replaceAll("_", " ")} subtitle={[alert.severity, alert.location, alert.protocol].filter(Boolean).join(" / ")} />) : <InlineNotification kind="success" lowContrast hideCloseButton title="No active AS218822 alerts" />}</Stack></Tile>
              </Stack>
            </Column>
          </Grid>

          <Grid fullWidth>
            <Column sm={4} md={8} lg={16}>
              <Tile>
                <Stack gap={4}>
                  <h2 className="cds--type-heading-04">Network registry</h2>
                  <StructuredListWrapper>
                    <StructuredListBody>
                      <StructuredListRow><StructuredListCell><strong>Address family</strong></StructuredListCell><StructuredListCell>IPv6 only</StructuredListCell></StructuredListRow>
                      <StructuredListRow><StructuredListCell><strong>Origin prefix</strong></StructuredListCell><StructuredListCell>2a06:9801:ff0::/44</StructuredListCell></StructuredListRow>
                      <StructuredListRow><StructuredListCell><strong>Peering policy</strong></StructuredListCell><StructuredListCell><a href="https://as218822.net/peering/">Open policy</a></StructuredListCell></StructuredListRow>
                      <StructuredListRow><StructuredListCell><strong>Registry</strong></StructuredListCell><StructuredListCell><a href="https://www.peeringdb.com/net/43433">PeeringDB #43433</a></StructuredListCell></StructuredListRow>
                    </StructuredListBody>
                  </StructuredListWrapper>
                </Stack>
              </Tile>
            </Column>
          </Grid>
        </Stack>
      </Content>
    </Theme>
  );
}
