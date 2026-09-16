import { generateKeyPairSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import https from "node:https";

const defaultPrefix = "2a06:9801:ff0:200";
const defaultDns = ["2606:4700:4700::1111", "2001:4860:4860::8888"];

const base64 = (value) => Buffer.from(value, "base64url").toString("base64");
const cleanName = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

function wireguardKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return {
    privateKey: base64(privateKey.export({ format: "jwk" }).d),
    publicKey: base64(publicKey.export({ format: "jwk" }).x),
  };
}

function randomAddress(prefix, used) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const host = randomBytes(8).toString("hex").match(/.{1,4}/g).join(":");
    const address = `${prefix}:${host}`;
    if (!used.has(address)) return address;
  }
  throw new Error("Unable to allocate an address");
}

function peersConfig(connections) {
  return connections.map(({ publicKey, address }) => `[Peer]\nPublicKey = ${publicKey}\nAllowedIPs = ${address}/128\n`).join("\n");
}

function clientConfig(connection, privateKey, options) {
  return `[Interface]\nPrivateKey = ${privateKey}\nAddress = ${connection.address}/128\nDNS = ${options.dns.join(", ")}\nMTU = 1420\n\n[Peer]\nPublicKey = ${options.serverPublicKey}\nEndpoint = ${options.endpoint}\nAllowedIPs = ::/0\nPersistentKeepalive = 25\n`;
}

export class KubernetesTunnelStore {
  constructor(env = process.env, request = https.request) {
    this.host = env.KUBERNETES_SERVICE_HOST;
    this.port = env.KUBERNETES_SERVICE_PORT_HTTPS ?? "443";
    this.namespacePath = env.KUBERNETES_NAMESPACE_PATH ?? "/var/run/secrets/kubernetes.io/serviceaccount/namespace";
    this.tokenPath = env.KUBERNETES_TOKEN_PATH ?? "/var/run/secrets/kubernetes.io/serviceaccount/token";
    this.caPath = env.KUBERNETES_CA_PATH ?? "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
    this.secret = env.WIREGUARD_STATE_SECRET ?? "wireguard-tunnels";
    this.request = request;
    this.credentials = null;
  }

  async setup() {
    if (!this.host) throw new Error("Tunnel state is not configured");
    this.credentials ??= Promise.all([readFile(this.namespacePath, "utf8"), readFile(this.tokenPath, "utf8"), readFile(this.caPath)]).then(([namespace, token, ca]) => ({ namespace: namespace.trim(), token: token.trim(), ca }));
    return this.credentials;
  }

  async call(method, body) {
    const { namespace, token, ca } = await this.setup();
    const payload = body == null ? null : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const request = this.request({ hostname: this.host, port: this.port, method, ca, path: `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(this.secret)}`, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) }, timeout: 5000 }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          let parsed;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reject(new Error("Invalid Kubernetes API response")); }
          if (response.statusCode < 200 || response.statusCode >= 300) return reject(Object.assign(new Error("Unable to update tunnel state"), { status: response.statusCode }));
          resolve(parsed);
        });
      });
      request.on("timeout", () => request.destroy(new Error("Kubernetes API timed out")));
      request.on("error", reject);
      if (payload) request.end(payload); else request.end();
    });
  }

  async read() {
    const secret = await this.call("GET");
    let connections = [];
    try { connections = JSON.parse(Buffer.from(secret.data?.["state.json"] ?? "W10=", "base64").toString("utf8")); } catch { throw new Error("Tunnel state is invalid"); }
    if (!Array.isArray(connections)) throw new Error("Tunnel state is invalid");
    return { connections, resourceVersion: secret.metadata.resourceVersion };
  }

  async write(connections, resourceVersion) {
    return this.call("PUT", { apiVersion: "v1", kind: "Secret", metadata: { name: this.secret, resourceVersion }, type: "Opaque", data: { "state.json": Buffer.from(JSON.stringify(connections)).toString("base64"), "peers.conf": Buffer.from(peersConfig(connections)).toString("base64") } });
  }

  async update(change) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.read();
      const result = change(structuredClone(current.connections));
      try { await this.write(result.connections, current.resourceVersion); return result.value; }
      catch (error) { if (error.status !== 409 || attempt === 4) throw error; }
    }
  }
}

export function createTunnelService({ env = process.env, store = new KubernetesTunnelStore(env) } = {}) {
  const options = {
    endpoint: env.WIREGUARD_ENDPOINT,
    serverPublicKey: env.WIREGUARD_PUBLIC_KEY,
    prefix: env.WIREGUARD_CLIENT_PREFIX ?? defaultPrefix,
    dns: (env.WIREGUARD_DNS ?? defaultDns.join(",")).split(",").map((value) => value.trim()).filter(Boolean),
    limit: Number(env.WIREGUARD_CONNECTION_LIMIT ?? 3),
  };
  const enabled = Boolean(options.endpoint && options.serverPublicKey);
  if (enabled && (!/^[A-Za-z0-9+/]{43}=$/.test(options.serverPublicKey) || !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10)) throw new Error("Invalid WireGuard service configuration");
  const visible = ({ id, name, address, createdAt }) => ({ id, name, address, createdAt });

  async function list(subject) {
    if (!enabled) return { enabled: false, connections: [] };
    const { connections } = await store.read();
    return { enabled: true, limit: options.limit, endpoint: options.endpoint, connections: connections.filter((item) => item.subject === subject).map(visible) };
  }

  async function create(subject, name) {
    if (!enabled) throw Object.assign(new Error("IP tunnel service is not configured"), { status: 503 });
    const normalized = cleanName(name);
    if (!normalized || normalized.length > 64) throw Object.assign(new Error("Connection name must be between 1 and 64 characters"), { status: 400 });
    const keys = wireguardKeys();
    return store.update((connections) => {
      if (connections.filter((item) => item.subject === subject).length >= options.limit) throw Object.assign(new Error(`You can have up to ${options.limit} connections`), { status: 409 });
      const connection = { id: randomUUID(), subject, name: normalized, address: randomAddress(options.prefix, new Set(connections.map((item) => item.address))), publicKey: keys.publicKey, createdAt: new Date().toISOString() };
      connections.push(connection);
      return { connections, value: { ...visible(connection), config: clientConfig(connection, keys.privateKey, options) } };
    });
  }

  async function remove(subject, id) {
    if (!enabled) throw Object.assign(new Error("IP tunnel service is not configured"), { status: 503 });
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(new Error("Connection not found"), { status: 404 });
    return store.update((connections) => {
      const index = connections.findIndex((item) => item.id === id && item.subject === subject);
      if (index < 0) throw Object.assign(new Error("Connection not found"), { status: 404 });
      connections.splice(index, 1);
      return { connections, value: true };
    });
  }
  return { enabled, list, create, remove };
}

export function validCsrf(session, received) {
  const actual = Buffer.from(typeof received === "string" ? received : "");
  const expected = Buffer.from(session?.csrf ?? "");
  return Boolean(session && actual.length === expected.length && timingSafeEqual(actual, expected));
}
