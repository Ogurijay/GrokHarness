import assert from "node:assert/strict";
import test from "node:test";
import { hasWindowsUpdateAssets, isNewerVersion } from "../src/shared/desktop.ts";
import { containsGrokCredentials } from "../src/main/credential-presence.ts";
import { startGrokServe } from "../src/main/grok-process.ts";

test("stable numeric version ordering", () => {
  assert.equal(isNewerVersion("v0.10.0", "0.9.9"), true);
  assert.equal(isNewerVersion("1.0.0", "0.99.9"), true);
  assert.equal(isNewerVersion("0.6.0", "0.6.0"), false);
  assert.equal(isNewerVersion("0.5.9", "0.6.0"), false);
  for (const version of ["nightly", "0.7.0-beta.1", "", "0.7"]) assert.equal(isNewerVersion(version, "0.6.0"), false);
});

test("source-only or partial releases are not Windows updates", () => {
  assert.equal(hasWindowsUpdateAssets([]), false);
  assert.equal(hasWindowsUpdateAssets(null), false);
  assert.equal(hasWindowsUpdateAssets([{ name: "latest.yml" }]), false);
  assert.equal(hasWindowsUpdateAssets([{ name: "Grok-Harness-Setup-0.7.0.exe" }]), false);
  assert.equal(hasWindowsUpdateAssets([{ name: "latest.yml" }, { name: "Grok-Harness-Setup-0.7.0.exe" }]), true);
});

test("official OAuth key and legacy token formats only return credential presence", () => {
  const fake = "test-credential-not-a-real-secret";
  assert.equal(containsGrokCredentials({ issuer: { auth_mode: "oauth", key: fake } }), true);
  assert.equal(containsGrokCredentials({ account: { access_token: fake } }), true);
  assert.equal(containsGrokCredentials({ key: fake }), false);
  assert.equal(containsGrokCredentials({ email: "test@example.invalid" }), false);
  assert.equal(containsGrokCredentials({ auth_mode: "oauth", key: "" }), false);
});

test("cancelled startup never spawns a backend", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(startGrokServe("not-an-executable", controller.signal), /cancelled/);
});

test("in-flight startup cancellation returns promptly", { skip: !process.env.GROK_TEST_BINARY }, async () => {
  const controller = new AbortController();
  const starting = startGrokServe(process.env.GROK_TEST_BINARY, controller.signal);
  const timer = setTimeout(() => controller.abort(), 10);
  try { await assert.rejects(starting, /cancelled/); }
  finally { clearTimeout(timer); }
});
