import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function builtWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

const assets = {
  fetch: async () => new Response("Not found", { status: 404 }),
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("keeps the marketing homepage intact", async () => {
  const worker = await builtWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: assets },
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Wetin Be Dis — The Nigerian Party Guessing Game/i);
  assert.match(html, /How well do you/i);
  assert.match(html, /THE GIST STARTS HERE/i);
});

test("serves API health without a database", async () => {
  const worker = await builtWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/health"),
    { ASSETS: assets },
    context,
  );

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("x-request-id"));
  assert.deepEqual(await response.json(), {
    service: "wetin-be-dis-competition-api",
    api_version: "2026-08-24",
    status: "ok",
    database_configured: false,
  });
});

test("fails closed when phone verification is not configured", async () => {
  const worker = await builtWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/auth/phone/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+2348012345678" }),
    }),
    { ASSETS: assets },
    context,
  );

  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error.code, "phone_verification_unavailable");
  assert.equal(payload.error.details.available, false);
});

test("does not silently create guest accounts without D1", async () => {
  const worker = await builtWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/players/guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "ios", app_version: "1.0" }),
    }),
    { ASSETS: assets },
    context,
  );

  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error.code, "database_unavailable");
});

test("serves the exact app-ads authorization from the public static route", async () => {
  const worker = await builtWorker();
  const expected = await readFile(new URL("../public/app-ads.txt", import.meta.url), "utf8");
  const response = await worker.fetch(
    new Request("http://localhost/app-ads.txt"),
    {
      ASSETS: {
        fetch: async (input) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.pathname === "/app-ads.txt") {
            return new Response(expected, {
              headers: { "content-type": "text/plain; charset=utf-8" },
            });
          }
          return new Response("Not found", { status: 404 });
        },
      },
    },
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain\b/i);
  assert.equal(
    (await response.text()).trim(),
    "google.com, pub-1519312264256479, DIRECT, f08c47fec0942fa0",
  );
});
