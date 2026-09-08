import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import * as oidc from "openid-client";

const token = () => randomBytes(32).toString("base64url");
const list = (value) => (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);

export function createAuth(env = process.env, discover = oidc.discovery) {
  const required = ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI", "OIDC_SESSION_SECRET"];
  const enabled = required.some((key) => env[key]);
  if (!enabled) return { enabled: false, session: async () => null, handle: async () => false };
  if (required.some((key) => !env[key])) throw new Error(`OIDC requires ${required.join(", ")}`);
  if (env.OIDC_SESSION_SECRET.length < 32) throw new Error("OIDC_SESSION_SECRET must contain at least 32 characters");

  const issuer = new URL(env.OIDC_ISSUER_URL);
  const redirect = new URL(env.OIDC_REDIRECT_URI);
  const local = redirect.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
  if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash) throw new Error("OIDC_ISSUER_URL must be an HTTPS issuer URL");
  if ((!local && redirect.protocol !== "https:") || redirect.pathname !== "/auth/callback" || redirect.search || redirect.hash || redirect.username || redirect.password) {
    throw new Error("OIDC_REDIRECT_URI must be https://<console>/auth/callback (HTTP is allowed only on loopback)");
  }
  const subjects = list(env.OIDC_ALLOWED_SUBJECTS);
  const groups = list(env.OIDC_ALLOWED_GROUPS);
  if (!subjects.length && !groups.length && env.OIDC_ALLOW_ANY_AUTHENTICATED !== "true") {
    throw new Error("Set OIDC_ALLOWED_SUBJECTS or OIDC_ALLOWED_GROUPS, or explicitly set OIDC_ALLOW_ANY_AUTHENTICATED=true");
  }
  const scopes = env.OIDC_SCOPES ?? `openid profile email${groups.length ? " groups" : ""}`;
  if (!scopes.split(/\s+/).includes("openid")) throw new Error("OIDC_SCOPES must include openid");
  const ttl = Number(env.OIDC_SESSION_TTL_SECONDS ?? 3600);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) throw new Error("OIDC_SESSION_TTL_SECONDS must be between 60 and 86400");
  const key = createHash("sha256").update(env.OIDC_SESSION_SECRET).digest();
  const prefix = local ? "console_" : "__Host-console_";
  const cookie = (name, value, age) => `${prefix}${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${local ? "" : "; Secure"}`;
  let configuration;
  async function config() {
    configuration ??= discover(issuer, env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET, undefined, {
      timeout: 5,
      execute: [oidc.enableNonRepudiationChecks],
    }).catch((error) => { configuration = undefined; throw error; });
    return configuration;
  }
  async function seal(payload, purpose, age) {
    return new EncryptJWT({ ...payload, purpose }).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuer(issuer.href).setAudience(env.OIDC_CLIENT_ID).setIssuedAt().setExpirationTime(`${age}s`).encrypt(key);
  }
  async function unseal(request, purpose) {
    const cookies = (request.headers.cookie ?? "").split(";").map((entry) => entry.trim());
    const value = cookies.find((entry) => entry.startsWith(`${prefix}${purpose}=`))?.slice(`${prefix}${purpose}=`.length);
    if (!value || value.length > 4096) return null;
    try {
      const { payload } = await jwtDecrypt(value, key, { issuer: issuer.href, audience: env.OIDC_CLIENT_ID, keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
      return payload.purpose === purpose ? payload : null;
    } catch { return null; }
  }
  const session = (request) => unseal(request, "session");

  async function handle(request, response, respond, pathname) {
    if (!["/auth/login", "/auth/callback", "/auth/logout"].includes(pathname)) return false;
    const method = pathname === "/auth/logout" ? "POST" : "GET";
    if (request.method !== method) {
      respond(response, 405, "Method not allowed\n", { allow: method });
      return true;
    }
    if (pathname === "/auth/logout") {
      const user = await session(request);
      const csrf = request.headers["x-csrf-token"];
      const received = Buffer.from(typeof csrf === "string" ? csrf : "");
      const expected = Buffer.from(user?.csrf ?? "");
      if (!user || request.headers.origin !== redirect.origin || received.length !== expected.length || !timingSafeEqual(received, expected)) {
        respond(response, 403, JSON.stringify({ error: "Sign-out request rejected. Refresh and try again." }), { "content-type": "application/json" });
      } else {
        respond(response, 204, "", { "set-cookie": cookie("session", "", 0) });
      }
      return true;
    }
    try {
      if (pathname === "/auth/login") {
        const verifier = oidc.randomPKCECodeVerifier();
        const state = token();
        const nonce = token();
        const url = oidc.buildAuthorizationUrl(await config(), {
          redirect_uri: redirect.href, scope: scopes, response_mode: "query", state, nonce,
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256",
        });
        respond(response, 302, "", { location: url.href, "set-cookie": cookie("transaction", await seal({ verifier, state, nonce }, "transaction", 600), 600) });
      } else {
        const transaction = await unseal(request, "transaction");
        if (!transaction) throw new Error("Missing or expired authorization transaction");
        // Never construct callback URLs from an untrusted Host / Forwarded header.
        const url = new URL(redirect.href);
        url.search = new URL(request.url, redirect.origin).search;
        const tokens = await oidc.authorizationCodeGrant(await config(), url, {
          pkceCodeVerifier: transaction.verifier, expectedState: transaction.state, expectedNonce: transaction.nonce, idTokenExpected: true,
        });
        const claims = tokens.claims();
        const memberships = claims?.[env.OIDC_GROUPS_CLAIM ?? "groups"];
        const allowed = claims && (subjects.includes(claims.sub) || (Array.isArray(memberships) && groups.some((group) => memberships.includes(group))) || env.OIDC_ALLOW_ANY_AUTHENTICATED === "true");
        if (!allowed) {
          respond(response, 302, "", { location: "/?auth_error=access_denied#operator", "set-cookie": [cookie("transaction", "", 0), cookie("session", "", 0)] });
          return true;
        }
        const age = Math.min(ttl, Math.floor(claims.exp - Date.now() / 1000));
        if (age <= 0) throw new Error("Expired identity token");
        const name = String(claims.name ?? claims.preferred_username ?? claims.sub).slice(0, 160);
        const value = await seal({ sub: claims.sub, name, csrf: token() }, "session", age);
        respond(response, 302, "", { location: "/#operator", "set-cookie": [cookie("transaction", "", 0), cookie("session", value, age)] });
      }
    } catch {
      // Provider responses and tokens can contain credentials; do not log them.
      respond(response, 302, "", { location: "/?auth_error=sign_in_failed#operator", "set-cookie": [cookie("transaction", "", 0), cookie("session", "", 0)] });
    }
    return true;
  }
  return { enabled, session, handle };
}
