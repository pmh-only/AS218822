import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import * as oidc from "openid-client";
import { createAuth } from "./auth.mjs";

const env = {
  OIDC_ISSUER_URL: "https://issuer.example/", OIDC_CLIENT_ID: "console", OIDC_CLIENT_SECRET: "test-secret",
  OIDC_REDIRECT_URI: "https://console.example/auth/callback", OIDC_SESSION_SECRET: "test-only-secret-with-at-least-32-characters",
  OIDC_ALLOWED_GROUPS: "network-operators",
};

test("OIDC configuration fails closed", () => {
  assert.equal(createAuth({}).enabled, false);
  for (const invalid of [
    { OIDC_CLIENT_ID: "console" },
    { ...env, OIDC_SESSION_SECRET: "short" },
    { ...env, OIDC_ISSUER_URL: "http://issuer.example/" },
    { ...env, OIDC_REDIRECT_URI: "http://console.example/auth/callback" },
    { ...env, OIDC_REDIRECT_URI: "https://console.example/other" },
    { ...env, OIDC_ALLOWED_GROUPS: "" },
    { ...env, OIDC_SESSION_TTL_SECONDS: "Infinity" },
    { ...env, OIDC_SCOPES: "profile" },
  ]) assert.throws(() => createAuth(invalid));
});

test("real OIDC code flow checks PKCE, state, nonce, signature, issuer, expiry, and operator membership", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const { privateKey: wrongKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", use: "sig", alg: "RS256" };
  let authorization;
  let scenario = "valid";
  let exchanges = 0;
  const usedCodes = new Set();
  const transport = async (input, options) => {
    const url = new URL(input);
    if (url.pathname.includes(".well-known")) return Response.json({
      issuer: env.OIDC_ISSUER_URL, authorization_endpoint: "https://issuer.example/authorize", token_endpoint: "https://issuer.example/token",
      jwks_uri: "https://issuer.example/jwks", response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
    });
    if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
    assert.equal(url.pathname, "/token");
    exchanges++;
    const params = new URLSearchParams(options.body);
    assert.equal(params.get("redirect_uri"), env.OIDC_REDIRECT_URI);
    assert.equal(await oidc.calculatePKCECodeChallenge(params.get("code_verifier")), authorization.searchParams.get("code_challenge"));
    if (usedCodes.has(params.get("code"))) return Response.json({ error: "invalid_grant" }, { status: 400 });
    usedCodes.add(params.get("code"));
    const claims = {
      sub: "operator", name: "Network Operator", groups: scenario === "denied" ? ["visitors"] : ["network-operators"],
      nonce: scenario === "nonce" ? "wrong-nonce" : authorization.searchParams.get("nonce"),
    };
    const idToken = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(scenario === "issuer" ? "https://evil.example/" : env.OIDC_ISSUER_URL)
      .setAudience(scenario === "audience" ? "another-app" : env.OIDC_CLIENT_ID).setIssuedAt()
      .setExpirationTime(scenario === "expired" ? Math.floor(Date.now() / 1000) - 120 : "1h")
      .sign(scenario === "signature" ? wrongKey : privateKey);
    return Response.json({ access_token: "never-send-this-to-the-browser", token_type: "Bearer", expires_in: 3600, id_token: idToken });
  };
  const auth = createAuth(env, (issuer, id, secret, authentication, options) => oidc.discovery(issuer, id, secret, authentication, { ...options, [oidc.customFetch]: transport }));
  async function route(path, cookie = "", method = "GET") {
    const result = {};
    await auth.handle({ url: path, method, headers: { cookie, host: "evil.example" } }, {}, (_, status, body, headers) => Object.assign(result, { status, body, headers }), new URL(path, "https://console.example").pathname);
    return result;
  }
  async function login() {
    const response = await route("/auth/login");
    assert.equal(response.status, 302);
    authorization = new URL(response.headers.location);
    assert.equal(authorization.origin, "https://issuer.example");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorization.searchParams.get("redirect_uri"), env.OIDC_REDIRECT_URI);
    assert.match(response.headers["set-cookie"], /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
    return response.headers["set-cookie"].split(";")[0];
  }
  let transaction = await login();
  const state = authorization.searchParams.get("state");
  let response = await route(`/auth/callback?code=${state}&state=${state}`, transaction);
  assert.equal(response.headers.location, "/#operator");
  const sessionCookie = response.headers["set-cookie"][1].split(";")[0];
  assert.doesNotMatch(sessionCookie, /Network Operator|never-send-this/);
  const user = await auth.session({ headers: { cookie: sessionCookie } });
  assert.equal(user.name, "Network Operator");
  assert.ok(user.csrf);
  assert.equal(await auth.session({ headers: { cookie: `${sessionCookie}tampered` } }), null);
  response = await route(`/auth/callback?code=${state}&state=${state}`, transaction);
  assert.match(response.headers.location, /sign_in_failed/);

  transaction = await login();
  const before = exchanges;
  response = await route("/auth/callback?code=anything&state=wrong-state", transaction);
  assert.match(response.headers.location, /sign_in_failed/);
  assert.equal(exchanges, before);
  assert.match((await route("/auth/callback?code=anything&state=anything")).headers.location, /sign_in_failed/);
  for (scenario of ["nonce", "issuer", "audience", "expired", "signature", "denied"]) {
    transaction = await login();
    const state = authorization.searchParams.get("state");
    response = await route(`/auth/callback?code=${state}&state=${state}`, transaction);
    assert.match(response.headers.location, scenario === "denied" ? /access_denied/ : /sign_in_failed/, scenario);
    assert.ok(response.headers["set-cookie"].every((cookie) => cookie.includes("Max-Age=0")));
  }
});
