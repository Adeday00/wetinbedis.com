import assert from "node:assert/strict";
import test from "node:test";
import { fcmAccessToken, fcmConfiguration, leagueNotificationCopy, sendFCMLeagueNotification, shouldRemovePushToken } from "../worker/api/push-delivery.ts";

async function credentials() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(raw).toString("base64")}\n-----END PRIVATE KEY-----`;
  return { pair, env: { WBD_FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "push@test-project.iam.gserviceaccount.com", private_key: pem, project_id: "test-project" }) } };
}

test("FCM authentication uses only the messaging scope and a signed short-lived assertion", async () => {
  const { pair, env } = await credentials();
  let assertion;
  const token = await fcmAccessToken(env, async (url, init) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(init.redirect, "error");
    const form = new URLSearchParams(init.body);
    assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    assertion = form.get("assertion");
    return Response.json({ access_token: "test-access-token" });
  });
  assert.equal(token, "test-access-token");
  const [header, claims, signature] = assertion.split(".");
  const data = JSON.parse(Buffer.from(claims, "base64url"));
  assert.equal(data.scope, "https://www.googleapis.com/auth/firebase.messaging");
  assert.equal(data.exp - data.iat, 3600);
  assert.equal(data.iss, "push@test-project.iam.gserviceaccount.com");
  assert.equal(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${claims}`)), true);
});

test("Android messages are data-only and retain the exact competition and event", async () => {
  const { env } = await credentials();
  await sendFCMLeagueNotification(env, "dummy-recipient", "results_ready", "completed-round-1", "test-access-token", "https://example.test/logo.png", undefined, async (url, init) => {
    assert.equal(url, "https://fcm.googleapis.com/v1/projects/test-project/messages:send");
    assert.equal(init.headers.authorization, "Bearer test-access-token");
    const { message } = JSON.parse(init.body);
    assert.equal(message.token, "dummy-recipient");
    assert.equal(message.notification, undefined, "notification payloads must not bypass local preference checks in the background");
    assert.deepEqual(message.data, { ...leagueNotificationCopy("results_ready"), route: "league/odogwu", event: "results_ready", competition_id: "completed-round-1", media_url: "https://example.test/logo.png" });
    return Response.json({ name: "test-message" });
  });
});

test("only an explicitly unregistered FCM device is removed", async () => {
  const gone = Response.json({ error: { details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } }, { status: 404 });
  assert.equal(await shouldRemovePushToken("android", gone), true);
  assert.equal(await shouldRemovePushToken("android", Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 })), false);
  assert.equal(await shouldRemovePushToken("ios", new Response(null, { status: 410 })), true);
});

test("invalid Android credentials never become an arbitrary outbound endpoint", () => {
  assert.throws(() => fcmConfiguration({}));
  assert.throws(() => fcmConfiguration({ WBD_FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "test", private_key: "test", project_id: "../../other" }) }));
});
