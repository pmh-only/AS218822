import assert from "node:assert/strict";
import test from "node:test";
import { createTunnelService, validCsrf } from "./tunnels.mjs";

class MemoryStore {
  connections = [];
  async read() { return { connections: structuredClone(this.connections), resourceVersion: "1" }; }
  async update(change) { const result = change(structuredClone(this.connections)); this.connections = result.connections; return result.value; }
}

const env = { WIREGUARD_ENDPOINT: "158.179.174.47:51820", WIREGUARD_PUBLIC_KEY: "A".repeat(43) + "=", WIREGUARD_CLIENT_PREFIX: "2001:db8:1:2", WIREGUARD_CONNECTION_LIMIT: "2" };

test("creates isolated random /128 tunnel configurations and never retains private keys", async () => {
  const store = new MemoryStore();
  const service = createTunnelService({ env, store });
  const first = await service.create("user-1", "Laptop");
  const second = await service.create("user-1", "Phone");
  assert.match(first.address, /^2001:db8:1:2:(?:[0-9a-f]{4}:){3}[0-9a-f]{4}$/);
  assert.notEqual(first.address, second.address);
  assert.match(first.config, /AllowedIPs = ::\/0/);
  assert.match(first.config, /Endpoint = 158\.179\.174\.47:51820/);
  assert.doesNotMatch(JSON.stringify(store.connections), /PrivateKey/);
  assert.equal((await service.list("user-2")).connections.length, 0);
  await assert.rejects(service.create("user-1", "Third"), /up to 2/);
});

test("only an owner can revoke a connection and CSRF values are checked safely", async () => {
  const store = new MemoryStore();
  const service = createTunnelService({ env, store });
  const connection = await service.create("owner", "Tablet");
  await assert.rejects(service.remove("someone-else", connection.id), /not found/);
  assert.equal(validCsrf({ csrf: "expected" }, "expected"), true);
  assert.equal(validCsrf({ csrf: "expected" }, "wrong"), false);
  await service.remove("owner", connection.id);
  assert.equal(store.connections.length, 0);
});
