import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Compile the source router directly so this security test cannot accidentally
// exercise an older deployment bundle and does not need platform-native Vite.
const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};

class Statement {
  constructor(db, sql, values = []) { Object.assign(this, { db, sql, values }); }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  async first() { return this.db.prepare(this.sql).get(...this.values) ?? null; }
  async run() { this.db.prepare(this.sql).run(...this.values); return { success: true }; }
}

test("review access requires authentication and the configured code, restores, reuses, and revokes on rotation", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const DB = { prepare: sql => new Statement(sqlite, sql), batch: async statements => Promise.all(statements.map(s => s.run())) };
  try {
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(n => n.endsWith(".sql")).sort()) {
      sqlite.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")).replaceAll("--> statement-breakpoint", ""));
    }
    const { handleApiRequest } = require("../worker/api/router.ts");
    const api = { fetch: handleApiRequest };
    const env = { DB, WBD_GOOGLE_REVIEW_ACCESS_CODE: "test-only-review-code-0123456789" };
    const call = (path, body, token, runtime = env) => api.fetch(new Request(`https://example.com/api/v1/${path}`, {
      method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    }), runtime);
    const path = "billing/google-play/review-access";
    assert.equal((await call(path, {})).status, 401);
    const guest = async () => (await (await call("players/guest", { platform: "android", app_version: "1.0.4" })).json()).session.token;
    const token = await guest();
    assert.equal((await call(path, { code: "wrong" }, token)).status, 403);
    assert.equal((await call(path, { code: "x".repeat(129) }, token)).status, 403);
    assert.equal((await call(path, { code: 123 }, token)).status, 403);
    assert.equal((await (await call(path, {}, token)).json()).entitlement.active, false);
    for (const reviewer of [token, await guest()]) {
      assert.equal((await (await call(path, { code: env.WBD_GOOGLE_REVIEW_ACCESS_CODE }, reviewer)).json()).entitlement.active, true);
      assert.equal((await (await call(path, {}, reviewer)).json()).entitlement.active, true);
    }
    assert.equal((await (await call(path, {}, token, { ...env, WBD_GOOGLE_REVIEW_ACCESS_CODE: "rotated-test-review-code-0123456789" })).json()).entitlement.active, false);
    assert.equal((await call(path, {}, token, { DB })).status, 503);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM google_play_purchases").get().n, 0);
    const grants = sqlite.prepare("SELECT code_hash FROM google_review_access").all();
    assert.equal(grants.length, 2);
    for (const grant of grants) assert.match(grant.code_hash, /^[a-f0-9]{64}$/);
  } finally { sqlite.close(); }
});
