import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import bcrypt from "bcryptjs";

const hash = await bcrypt.hash("fixture-password", 4);

// Evaluate real handlers with inert boundaries: no DB, persisted secrets, or network.
function handler(route, name, overrides = {}) {
  const calls = { login: [], fail: [], success: [], session: [], rotated: [] };
  const settings = Object.freeze({ password: hash, requireLogin: true, ...overrides.settings });
  const cookieStore = { get: () => undefined };
  const context = {
    URL,
    process: { env: {} },
    NextResponse: {
      json: (body, options = {}) => ({
        body, status: options.status || 200, headers: options.headers,
        cookies: { set: (...args) => calls.rotated.push(args) },
      }),
    },
    getSettings: async () => settings,
    bcrypt,
    cookies: async () => cookieStore,
    getJwtSecret: () => "fixture-secret",
    setLoginCookies: async (...args) => calls.login.push(args),
    checkLock: () => ({ locked: false }),
    recordFail: (ip) => { calls.fail.push(ip); return { remainingBeforeLock: 4 }; },
    recordSuccess: (ip) => calls.success.push(ip),
    getClientIp: () => "fixture-ip",
    isLocalRequest: () => true,
    handleGuardSession: async () => ({ authenticated: false }),
    getDashboardAuthSession: async (token) => { calls.session.push(token); return { authenticated: true }; },
    ACCESS_TOKEN_COOKIE: "auth_token",
    REFRESH_TOKEN_COOKIE: "refresh_token",
    ...overrides.context,
  };
  const source = fs.readFileSync(new URL(`../../src/app/api/auth/${route}/route.js`, import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace(`export async function ${name}`, `async function ${name}`);
  const run = vm.runInNewContext(`(function () { ${source}; return ${name}; })()`, context);
  return { run, calls, settings, cookieStore };
}

function request(password = "fixture-password", rememberMe = false, host = "localhost") {
  return new Request(`http://${host}/api/auth/login`, {
    method: "POST", headers: { host, "Content-Type": "application/json" },
    body: JSON.stringify({ password, rememberMe }),
  });
}

for (const authMode of ["password", "sso", "both", "oidc", "saml"]) {
  test(`stored ${authMode} mode allows password recovery without changing settings`, async () => {
    const fixture = handler("login", "POST", { settings: {
      authMode, ssoType: "saml", samlEntryPoint: "https://fixture.invalid", samlCert: "fixture",
      oidcIssuerUrl: "https://fixture.invalid", oidcClientId: "fixture",
    } });
    const before = JSON.stringify(fixture.settings);
    const response = await fixture.run(request());
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(fixture.calls.login.length, 1);
    assert.equal(fixture.calls.login[0][0], fixture.cookieStore);
    assert.equal(JSON.stringify(fixture.calls.login[0][3]), "{}");
    assert.equal(fixture.calls.login[0][4], false);
    assert.equal(JSON.stringify(fixture.settings), before);
  });
}

test("wrong password never issues session; remember-me remains explicit boolean", async () => {
  const fixture = handler("login", "POST", { settings: { authMode: "sso" } });
  assert.equal((await fixture.run(request("wrong", true))).status, 401);
  assert.equal(fixture.calls.login.length, 0);
  assert.deepEqual(fixture.calls.fail, ["fixture-ip"]);
  await fixture.run(request("fixture-password", true));
  await fixture.run(request("fixture-password", "true"));
  assert.deepEqual(fixture.calls.login.map((args) => args[4]), [true, false]);
});

test("rate lock and disabled tunnel reject password without session", async () => {
  const locked = handler("login", "POST", { context: { checkLock: () => ({ locked: true, retryAfter: 60 }) } });
  const response = await locked.run(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers["Retry-After"], "60");
  assert.equal(locked.calls.login.length, 0);
  const tunnel = handler("login", "POST", { settings: { tunnelUrl: "http://fixture.invalid" } });
  assert.equal((await tunnel.run(request("fixture-password", true, "fixture.invalid"))).status, 403);
  assert.equal(tunnel.calls.login.length, 0);
});

test("remote default password cannot mint session; local default still works", async () => {
  const remote = handler("login", "POST", {
    settings: { password: null }, context: { isLocalRequest: () => false },
  });
  const response = await remote.run(request("123456", true));
  assert.equal(response.status, 403);
  assert.equal(response.body.mustChangePassword, true);
  assert.equal(remote.calls.login.length, 0);
  const local = handler("login", "POST", { settings: { password: null } });
  assert.equal((await local.run(request("123456"))).status, 200);
});

function assertPasswordMetadata(response, authenticated) {
  assert.equal(response.body.authMode, "password");
  assert.equal(response.body.loginMethod, "Password");
  assert.equal(response.body.displayName, "Password user");
  assert.equal(response.body.authenticated, authenticated);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "authMode", "authenticated", "displayName", "hasPassword", "loginMethod", "requireLogin",
  ]);
}

test("old SSO settings and claims never expose SSO response metadata", async () => {
  for (const authMode of ["sso", "both", "oidc", "saml"]) {
    const fixture = handler("status", "GET", {
      settings: { authMode },
      context: {
        cookies: async () => ({ get: () => ({ value: "fixture-access" }) }),
        handleGuardSession: async () => ({ authenticated: true }),
        getDashboardAuthSession: async () => ({ authenticated: true, saml: true, oidc: true, samlEmail: "private@fixture.invalid" }),
      },
    });
    assertPasswordMetadata(await fixture.run(), true);
  }
});

test("status honors session guard; invalid session cannot be revived by stale cookie", async () => {
  const fixture = handler("status", "GET", {
    context: { cookies: async () => ({ get: () => ({ value: "stale-token" }) }) },
  });
  assertPasswordMetadata(await fixture.run(), false);
  assert.equal(fixture.calls.session.length, 0);
});

test("status rotation uses only current request tokens and preserves cookie options", async () => {
  const access = { httpOnly: true, sameSite: "lax" };
  const refresh = { httpOnly: true, sameSite: "lax", maxAge: 604800 };
  const fixture = handler("status", "GET", {
    context: {
      handleGuardSession: async ({ headers }) => ({
        authenticated: true, rotated: true,
        newAccessToken: headers.get("fixture-session"), newRefreshToken: "fixture-refresh",
        cookieOptions: { access, refresh },
      }),
    },
  });
  for (const token of ["session-A", "session-B"]) {
    assertPasswordMetadata(await fixture.run(new Request("http://localhost", { headers: { "fixture-session": token } })), true);
  }
  assert.deepEqual(fixture.calls.session, ["session-A", "session-B"]);
  assert.deepEqual(fixture.calls.rotated, [
    ["auth_token", "session-A", access], ["refresh_token", "fixture-refresh", refresh],
    ["auth_token", "session-B", access], ["refresh_token", "fixture-refresh", refresh],
  ]);
});

test("status failure defaults closed without SSO metadata", async () => {
  const fixture = handler("status", "GET", { context: { getSettings: async () => { throw new Error("fixture failure"); } } });
  const response = await fixture.run();
  assertPasswordMetadata(response, false);
  assert.equal(response.body.requireLogin, true);
});

test("removed SSO helpers/routes absent; login retains password and remember-me UI", () => {
  for (const path of [
    "src/lib/auth/oidc.js", "src/lib/auth/saml.js",
    "src/app/api/auth/oidc/start/route.js", "src/app/api/auth/oidc/callback/route.js", "src/app/api/auth/oidc/test/route.js",
    "src/app/api/auth/saml/start/route.js", "src/app/api/auth/saml/acs/route.js", "src/app/api/auth/saml/metadata/route.js", "src/app/api/auth/saml/test/route.js",
  ]) assert.equal(fs.existsSync(new URL(`../../${path}`, import.meta.url)), false, path);
  const page = fs.readFileSync(new URL("../../src/app/login/page.js", import.meta.url), "utf8");
  assert.doesNotMatch(page, /oidc|saml|sso|passwordAvailable/i);
  assert.match(page, /<RememberMeCheckbox/);
  assert.match(page, /<form onSubmit=\{handleLogin\}/);
  assert.match(page, /JSON.stringify\(\{ password, rememberMe \}\)/);
});
