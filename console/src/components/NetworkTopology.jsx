import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import "./NetworkTopology.css";

const nodeTypes = { network: TopologyNode };

function displayName(value) {
  const labels = {
    asn218822: "ASN218822",
    bgpexchange: "BGP Exchange",
    bgptunnel: "BGP Tunnel",
    es: "ES",
    gretap: "GRETAP",
    hk: "HK",
    hkix: "HKIX",
    jp: "JP",
    no: "NO",
    nz: "NZ",
    pb: "PB",
    tw: "TW",
    uk: "UK",
    us: "US",
    v6: "IPv6",
  };
  return value.split(/[_-]/).map((part) => labels[part.toLowerCase()] ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function normalizedName(value) {
  return value.replace(/_v6$/, "").replaceAll("_", "-").toLowerCase();
}

function TopologyNode({ data }) {
  return (
    <div className={`topology-node topology-node--${data.kind} ${data.up ? "is-up" : "is-down"}`} title={`${data.label} / ${data.detail}`}>
      <Handle id="left" type="target" position={Position.Left} />
      <Handle id="top" type="target" position={Position.Top} />
      <div className="topology-node__status" aria-hidden="true" />
      <div>
        <p>{data.label}</p>
        <span>{data.detail}</span>
      </div>
      <Handle id="right" type="source" position={Position.Right} />
      <Handle id="bottom" type="source" position={Position.Bottom} />
    </div>
  );
}

function buildTopology(protocols) {
  const bgp = protocols.filter((protocol) => protocol.type === "BGP");
  const locations = [...new Set(bgp.map((protocol) => protocol.location))].sort((a, b) => {
    if (a === "core") return -1;
    if (b === "core") return 1;
    return a.localeCompare(b);
  });
  const locationNames = new Map(locations.map((location) => [normalizedName(location), location]));
  const internal = [];
  const externalByLocation = new Map(locations.map((location) => [location, []]));

  for (const protocol of bgp) {
    const linkedLocation = locationNames.get(normalizedName(protocol.name));
    if (linkedLocation && linkedLocation !== protocol.location) {
      internal.push({ ...protocol, linkedLocation });
    } else {
      externalByLocation.get(protocol.location).push(protocol);
    }
  }

  const groupGap = 88;
  const rowGap = 68;
  let cursorY = 0;
  const nodes = [];
  const edges = [];
  const routerY = new Map();

  for (const location of locations) {
    const peers = externalByLocation.get(location).sort((a, b) => a.name.localeCompare(b.name));
    const rows = Math.max(peers.length, 1);
    const startY = cursorY;
    const centerY = startY + ((rows - 1) * rowGap) / 2;
    const locationProtocols = bgp.filter((protocol) => protocol.location === location);
    const upCount = locationProtocols.filter((protocol) => protocol.up).length;
    routerY.set(location, centerY);
    nodes.push({
      id: `router:${location}`,
      type: "network",
      position: { x: 260, y: centerY },
      data: {
        kind: "router",
        label: displayName(location),
        detail: `${upCount} / ${locationProtocols.length} sessions`,
        up: locationProtocols.every((protocol) => protocol.up),
      },
      ariaLabel: `${displayName(location)} router, ${upCount} of ${locationProtocols.length} BGP sessions established`,
    });

    peers.forEach((peer, index) => {
      const peerId = `peer:${peer.location}:${peer.name}`;
      nodes.push({
        id: peerId,
        type: "network",
        position: { x: 540, y: startY + index * rowGap },
        data: {
          kind: "peer",
          label: displayName(peer.name),
          detail: peer.up ? "Established" : "Down",
          up: peer.up,
        },
        ariaLabel: `${displayName(peer.name)} BGP session, ${peer.up ? "established" : "down"}`,
      });
      edges.push({
        id: `edge:${peer.location}:${peer.name}`,
        source: `router:${location}`,
        sourceHandle: "right",
        target: peerId,
        targetHandle: "left",
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, color: peer.up ? "#42be65" : "#fa4d56" },
        className: peer.up ? "topology-edge--up" : "topology-edge--down",
      });
    });

    cursorY += rows * rowGap + groupGap;
  }

  const networkUp = bgp.length > 0 && bgp.every((protocol) => protocol.up);
  const networkY = Math.max(0, (cursorY - groupGap - rowGap) / 2);
  nodes.push({
    id: "network:as218822",
    type: "network",
    position: { x: 0, y: networkY },
    data: {
      kind: "as",
      label: "AS218822",
      detail: "IPv6 network",
      up: networkUp,
    },
    ariaLabel: `AS218822 IPv6 network, ${networkUp ? "all sessions established" : "one or more sessions down"}`,
  });

  for (const location of locations) {
    const locationProtocols = bgp.filter((protocol) => protocol.location === location);
    const up = locationProtocols.some((protocol) => protocol.up);
    edges.push({
      id: `edge:network:${location}`,
      source: "network:as218822",
      sourceHandle: "right",
      target: `router:${location}`,
      targetHandle: "left",
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: up ? "#a56eff" : "#fa4d56" },
      className: up ? "topology-edge--network" : "topology-edge--down",
    });
  }

  const internalLinks = new Map();
  for (const protocol of internal) {
    const pair = [protocol.location, protocol.linkedLocation].sort();
    const key = pair.join(":");
    const current = internalLinks.get(key) ?? { locations: pair, sessions: [] };
    current.sessions.push(protocol);
    internalLinks.set(key, current);
  }

  for (const [key, link] of internalLinks) {
    const [source, target] = link.locations.sort((a, b) => (routerY.get(a) ?? 0) - (routerY.get(b) ?? 0));
    const up = link.sessions.every((session) => session.up);
    edges.push({
      id: `edge:internal:${key}`,
      source: `router:${source}`,
      sourceHandle: "bottom",
      target: `router:${target}`,
      targetHandle: "top",
      type: "straight",
      markerStart: { type: MarkerType.ArrowClosed, color: up ? "#78a9ff" : "#fa4d56", orient: "auto-start-reverse" },
      markerEnd: { type: MarkerType.ArrowClosed, color: up ? "#78a9ff" : "#fa4d56" },
      className: up ? "topology-edge--internal" : "topology-edge--down",
    });
  }

  return { nodes, edges, bgp, locations };
}

export default function NetworkTopology({ protocols, stale = false }) {
  const { nodes, edges, bgp, locations } = buildTopology(protocols);
  const established = bgp.filter((protocol) => protocol.up).length;

  if (!bgp.length) {
    return <div className="topology-empty">No BGP topology is currently available.</div>;
  }

  return (
    <div className="topology">
      <div className="topology-summary">
        <span><i className="topology-key topology-key--up" />Established {established}</span>
        <span><i className="topology-key topology-key--down" />Down {bgp.length - established}</span>
        <span>{locations.length} routing locations</span>
        <span>{stale ? "Stale or incomplete snapshot" : "Current snapshot"}</span>
      </div>
      <div className="topology-canvas" role="img" aria-label={`Live BGP topology with ${locations.length} routing locations and ${established} of ${bgp.length} sessions established`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
          minZoom={0.25}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#393939" gap={28} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
    </div>
  );
}
