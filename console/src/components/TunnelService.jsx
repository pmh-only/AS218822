import { useEffect, useState } from "react";
import { Button, InlineLoading, InlineNotification, Tag, TextInput } from "@carbon/react";
import { Add, Download, Login, TrashCan } from "@carbon/icons-react";
import { QRCodeSVG } from "qrcode.react";

export default function TunnelService({ auth, sessionValid }) {
  const [service, setService] = useState(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(path, options = {}) {
    const response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(10000), ...options });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? `Tunnel service returned ${response.status}.`);
    return body;
  }

  async function load() {
    if (!sessionValid) { setService(null); return; }
    try { setService(await request("/api/tunnels")); setError(""); }
    catch (reason) { setError(reason.message); }
  }

  useEffect(() => { load(); }, [sessionValid]);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setCreated(null);
    try {
      const connection = await request("/api/tunnels", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": auth.user.csrfToken }, body: JSON.stringify({ name }) });
      setCreated(connection);
      setName("");
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function revoke(connection) {
    if (!window.confirm(`Revoke “${connection.name}”? It will lose tunnel access immediately.`)) return;
    setBusy(true);
    try { await request(`/api/tunnels/${connection.id}`, { method: "DELETE", headers: { "x-csrf-token": auth.user.csrfToken } }); if (created?.id === connection.id) setCreated(null); await load(); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  function download() {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([created.config], { type: "application/x-wireguard-profile" }));
    link.download = `as218822-${created.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "tunnel"}.conf`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  if (!auth) return <div className="tunnel-wait"><InlineLoading description="Checking your session" /></div>;
  if (!sessionValid) return <div className="tunnel-signin"><div><h2>Sign in to create an IP tunnel</h2><p>Each account can create up to three personal connections. Your assigned IPv6 address is globally routed through AS218822.</p></div>{auth.enabled ? <Button href="/auth/login?return_to=/tunnels" renderIcon={Login}>Sign in with OIDC</Button> : <Tag type="red">Sign-in unavailable</Tag>}</div>;

  return <div className="tunnel-layout">
    {error && <InlineNotification kind="error" lowContrast hideCloseButton title="IP tunnel service" subtitle={error} />}
    <section className="tunnel-create" aria-labelledby="create-tunnel-title">
      <div><Tag type="green">IPv6 internet access</Tag><h2 id="create-tunnel-title">Create a connection</h2><p>Name this device. We assign a random public IPv6 address and generate a WireGuard configuration ready to import.</p></div>
      {service?.enabled === false ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Service not configured" subtitle="Tunnel provisioning is not available on this deployment." /> : <form onSubmit={create}>
        <TextInput id="connection-name" labelText="Device name" placeholder="e.g. Personal laptop" value={name} maxLength={64} required disabled={busy || !service} onChange={(event) => setName(event.target.value)} />
        <Button type="submit" renderIcon={Add} disabled={busy || !service || !name.trim() || service.connections.length >= service.limit}>{busy ? "Creating" : "Create connection"}</Button>
        {service && <p className="tunnel-quota">{service.connections.length} of {service.limit} connections used</p>}
      </form>}
    </section>

    {created && <section className="tunnel-result" aria-labelledby="tunnel-ready-title">
      <InlineNotification kind="success" lowContrast hideCloseButton title="Connection ready" subtitle="Download this configuration now. The private key is shown once and is not stored by AS218822." />
      <div className="tunnel-result-heading"><div><h2 id="tunnel-ready-title">{created.name}</h2><code>{created.address}/128</code></div><Button kind="secondary" renderIcon={Download} onClick={download}>Download .conf</Button></div>
      <div className="tunnel-profile"><div><label htmlFor="connection-config">WireGuard configuration</label><textarea id="connection-config" readOnly spellCheck="false" value={created.config} onFocus={(event) => event.target.select()} /></div><div className="tunnel-qr"><QRCodeSVG value={created.config} size={224} level="L" marginSize={2} title={`WireGuard configuration for ${created.name}`} role="img" /><strong>Scan to connect</strong><p>Open the WireGuard app and scan this code.</p></div></div>
    </section>}

    <section className="tunnel-connections" aria-labelledby="connections-title"><div className="tunnel-section-heading"><div><h2 id="connections-title">Your connections</h2><p>Revoke devices you no longer use. Lost configurations cannot be recovered because private keys are never retained.</p></div>{service?.endpoint && <div><span>Gateway</span><code>{service.endpoint}</code></div>}</div>
      {!service ? <InlineLoading description="Loading connections" /> : service.connections.length === 0 ? <div className="tunnel-empty"><strong>No connections yet</strong><p>Create one above, then import the downloaded file in the WireGuard app.</p></div> : <div className="connection-list">{service.connections.map((connection) => <article key={connection.id}><div><strong>{connection.name}</strong><code>{connection.address}/128</code><span>Created {new Date(connection.createdAt).toLocaleDateString()}</span></div><Button kind="danger--ghost" size="sm" renderIcon={TrashCan} disabled={busy} onClick={() => revoke(connection)}>Revoke</Button></article>)}</div>}
    </section>

    <section className="tunnel-help"><h2>Connect in three steps</h2><ol><li><span>1</span><div><strong>Create</strong><p>Make one connection for each device.</p></div></li><li><span>2</span><div><strong>Import</strong><p>Open the downloaded file with WireGuard.</p></div></li><li><span>3</span><div><strong>Activate</strong><p>Enable the tunnel to route IPv6 internet traffic.</p></div></li></ol><p className="tunnel-note">This is an IPv6-only service. The assigned address is public; normal internet safety and acceptable-use expectations apply.</p></section>
  </div>;
}
