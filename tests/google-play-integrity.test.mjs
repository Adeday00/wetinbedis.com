import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSigningDigest, playIntegrityConfiguration, playIntegrityRequestHash, playIntegrityAccessToken, validatePlayIntegrityVerdict, verifyPlayIntegrityToken } from "../worker/api/google-play-integrity.ts";

const certificate = Buffer.alloc(32, 17).toString("base64url");
const now = 1780000000000;
const requestHash = Buffer.alloc(32, 19).toString("base64url");
async function credentials() {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64")}\n-----END PRIVATE KEY-----`;
  const env = { WBD_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "integrity@test-project.iam.gserviceaccount.com", private_key: pem, token_uri: "https://attacker.example.test" }), WBD_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: "123456789012", WBD_PLAY_INTEGRITY_CERTIFICATE_SHA256: certificate };
  return { keys, env, config: playIntegrityConfiguration(env) };
}
function verdict() {
  return { requestDetails: { requestPackageName: "com.davidadekanbi.wetinbedis", requestHash, timestampMillis: String(now - 100) },
    appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: "com.davidadekanbi.wetinbedis", certificateSha256Digest: [certificate], versionCode: "5" },
    accountDetails: { appLicensingVerdict: "LICENSED" }, deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] } };
}
function expected(config) { return { config, requestHash, issuedAt: now - 1000, expiresAt: now + 89000, now }; }
const rejectCode = (code) => (error) => error.code === code;

test("Play Integrity requires a project, service identity and known signing certificate", async () => {
  const { env } = await credentials();
  for (const key of ["WBD_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON", "WBD_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER", "WBD_PLAY_INTEGRITY_CERTIFICATE_SHA256"]) assert.throws(() => playIntegrityConfiguration({ ...env, [key]: "" }), rejectCode("play_integrity_misconfigured"));
  assert.throws(() => playIntegrityConfiguration({ ...env, WBD_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: "https://other" }));
  assert.throws(() => playIntegrityConfiguration({ ...env, WBD_PLAY_INTEGRITY_MIN_VERSION_CODE: "0" }));
  assert.equal(playIntegrityConfiguration(env).minimumVersionCode, 5n);
  assert.equal(normalizeSigningDigest(Array(32).fill("11").join(":")), certificate);
  assert.equal(normalizeSigningDigest(`${certificate}=`), certificate);
  assert.equal(normalizeSigningDigest("not-a-certificate"), null);
});

test("request binding changes for every player, attempt, card, selection, purpose and nonce", async () => {
  const binding = { purpose: "cash_answer", challengeId: "challenge-1", nonce: "random-nonce", playerId: "player-1", attemptId: "attempt-1", ordinal: 1, selectedOptionId: "option-1" };
  const first = await playIntegrityRequestHash(binding); assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  for (const change of [{ playerId: "player-2" }, { attemptId: "attempt-2" }, { ordinal: 2 }, { selectedOptionId: "option-2" }, { selectedOptionId: null }, { nonce: "other-nonce" }, { challengeId: "challenge-2" }]) assert.notEqual(await playIntegrityRequestHash({ ...binding, ...change }), first);
  assert.notEqual(await playIntegrityRequestHash({ ...binding, purpose: "registration", ordinal: null, selectedOptionId: null }), first);
  await assert.rejects(playIntegrityRequestHash({ ...binding, purpose: "other" }));
  await assert.rejects(playIntegrityRequestHash({ ...binding, ordinal: 0 }));
});

test("the valid verdict is a licensed recognized signed app on a certified device", async () => {
  const { config } = await credentials();
  assert.deepEqual(validatePlayIntegrityVerdict(verdict(), expected(config)), { packageName: config.packageName, versionCode: "5", certificates: [certificate], tokenTimestampMs: now - 100 });
  assert.doesNotThrow(() => validatePlayIntegrityVerdict({ ...verdict(), testingDetails: {} }, expected(config)));
});

test("request identity, binding and freshness are checked before accepting a verdict", async () => {
  const { config } = await credentials();
  for (const mutation of [{ requestPackageName: "other.app" }, { requestHash: "different" }, { timestampMillis: String(now - 10000) }, { timestampMillis: String(now + 6000) }, { timestampMillis: "NaN" }, { timestampMillis: -1 }]) {
    const data = verdict(); Object.assign(data.requestDetails, mutation);
    assert.throws(() => validatePlayIntegrityVerdict(data, expected(config)), rejectCode("play_integrity_request_mismatch"));
  }
  assert.throws(() => validatePlayIntegrityVerdict(verdict(), { ...expected(config), expiresAt: now }), rejectCode("play_integrity_challenge_expired"));
});

test("unrecognized, wrongly signed, old, unlicensed and virtual devices cannot qualify", async () => {
  const { config } = await credentials();
  const mutations = [
    (v) => { v.appIntegrity.appRecognitionVerdict = "UNRECOGNIZED_VERSION"; }, (v) => { v.appIntegrity.packageName = "other.app"; },
    (v) => { v.appIntegrity.certificateSha256Digest = [Buffer.alloc(32, 18).toString("base64url")]; }, (v) => { v.appIntegrity.certificateSha256Digest = [certificate, "invalid"]; },
    (v) => { v.appIntegrity.certificateSha256Digest = []; }, (v) => { v.appIntegrity.versionCode = "4"; }, (v) => { v.accountDetails.appLicensingVerdict = "UNLICENSED"; },
    (v) => { v.deviceIntegrity.deviceRecognitionVerdict = ["MEETS_BASIC_INTEGRITY"]; }, (v) => { v.deviceIntegrity.deviceRecognitionVerdict = ["MEETS_VIRTUAL_INTEGRITY"]; },
    (v) => { delete v.deviceIntegrity.deviceRecognitionVerdict; }, (v) => { v.testingDetails = { isTestingResponse: true }; },
  ];
  for (const mutate of mutations) { const value = verdict(); mutate(value); assert.throws(() => validatePlayIntegrityVerdict(value, expected(config))); }
});

test("OAuth uses the Play Integrity scope, fixed Google endpoint and verifiable RSA assertion", async () => {
  const { config, keys } = await credentials(); let assertion;
  const token = await playIntegrityAccessToken(config, async (url, init) => {
    assert.equal(url, "https://oauth2.googleapis.com/token"); assert.equal(init.redirect, "error");
    assertion = new URLSearchParams(init.body).get("assertion"); return Response.json({ access_token: "dummy-access-token" });
  });
  assert.equal(token, "dummy-access-token");
  const [header, claims, signature] = assertion.split("."); const content = JSON.parse(Buffer.from(claims, "base64url"));
  assert.equal(content.scope, "https://www.googleapis.com/auth/playintegrity"); assert.equal(content.aud, "https://oauth2.googleapis.com/token"); assert.equal(content.exp - content.iat, 3600);
  assert.equal(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", keys.publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${claims}`)), true);
});

test("only Google's decoded response is used and no raw verdict is accepted from a client", async () => {
  const { config } = await credentials(); const requests = [];
  const result = await verifyPlayIntegrityToken({ ...expected(config), token: "dummy-encrypted-integrity-token" }, async (url, init) => {
    requests.push(url);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "dummy-access-token" });
    assert.equal(url, "https://playintegrity.googleapis.com/v1/com.davidadekanbi.wetinbedis:decodeIntegrityToken");
    assert.equal(init.headers.authorization, "Bearer dummy-access-token"); assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(init.body), { integrity_token: "dummy-encrypted-integrity-token" }); return Response.json({ tokenPayloadExternal: verdict() });
  });
  assert.equal(requests.length, 2); assert.equal(result.versionCode, "5");
});

test("OAuth reuse never caches device verdicts and credential rotation refreshes authorization", async () => {
  const { config } = await credentials(); let authorizationRequests = 0; let decodes = 0;
  const provider = async (url) => {
    if (url.includes("oauth2")) { authorizationRequests++; return Response.json({ access_token: `authorization-${authorizationRequests}`, expires_in: 3600 }); }
    decodes++; const payload = verdict();
    if (decodes === 2) payload.accountDetails.appLicensingVerdict = "UNLICENSED";
    return Response.json({ tokenPayloadExternal: payload });
  };
  const input = { ...expected(config), token: "dummy-encrypted-integrity-token" };
  await verifyPlayIntegrityToken(input, provider);
  await assert.rejects(verifyPlayIntegrityToken(input, provider));
  assert.equal(authorizationRequests, 1); assert.equal(decodes, 2);
  const rotated = await credentials();
  await verifyPlayIntegrityToken({ ...input, config: rotated.config }, provider);
  assert.equal(authorizationRequests, 2); assert.equal(decodes, 3);
});

test("expired challenges and invalid tokens never make an outbound provider request", async () => {
  const { config } = await credentials(); const outbound = async () => assert.fail("No outbound request is allowed");
  await assert.rejects(verifyPlayIntegrityToken({ ...expected(config), expiresAt: now, token: "dummy-encrypted-integrity-token" }, outbound));
  await assert.rejects(verifyPlayIntegrityToken({ ...expected(config), token: "short" }, outbound));
});

test("provider outages expose neither raw credentials nor error payloads", async () => {
  const { config } = await credentials();
  await assert.rejects(playIntegrityAccessToken(config, async () => Response.json({ error: "private-provider-data" }, { status: 403 })), (error) => error.code === "play_integrity_unavailable" && !error.message.includes("private-provider-data"));
  await assert.rejects(verifyPlayIntegrityToken({ ...expected(config), token: "dummy-encrypted-integrity-token" }, async (url) => url.includes("oauth2") ? Response.json({ access_token: "dummy-access-token" }) : new Response("private-provider-data", { status: 400 })), rejectCode("play_integrity_token_invalid"));
});
