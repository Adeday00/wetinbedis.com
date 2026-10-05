import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(testDirectory, "..");
const validator = path.join(siteDirectory, "scripts", "check-trend-intake.mjs");

function run(file) {
  return spawnSync(process.execPath, [validator, "--file", file], {
    cwd: siteDirectory,
    encoding: "utf8",
  });
}

test("trend intake keeps social discovery out of candidate and release content", (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wbd-trend-intake-"));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const intakePath = path.join(temporaryDirectory, "unsafe.json");
  fs.writeFileSync(intakePath, JSON.stringify({
    schema_version: 1,
    collection: "unsafe research",
    editorial_only: true,
    policy: "test",
    signals: [{
      id: "TS-001",
      platform: "tiktok",
      observed_wat: "2026-09-27T11:00:00+01:00",
      topic: "@creator's viral caption",
      why_it_might_be_fun: "People are talking about it.",
      source_content_copied: false,
      personal_data_saved: false,
      direct_post_link_saved: false,
      fact_checks: [{
        source_type: "official",
        title: "The post itself",
        url: "https://www.tiktok.com/@creator/video/123",
      }],
      reviewer_status: "Research hold",
    }],
  }));

  const result = run(intakePath);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, false);
  assert(payload.errors.some((error) => error.includes("handles")));
  assert(payload.errors.some((error) => error.includes("not a social post")));
  assert.equal(payload.promotion_performed, false);
});
