import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(testDirectory, "..");
const nodeBinary = process.execPath;
const candidateCheck = path.join(siteDirectory, "scripts", "check-solo-gist-candidates.mjs");
const candidatePromotion = path.join(
  siteDirectory,
  "scripts",
  "promote-solo-gist-candidates.mjs",
);
const catalogPath = path.join(siteDirectory, "content", "solo-gist-catalog.json");

function run(script, args = []) {
  return execFileSync(nodeBinary, [script, ...args], {
    cwd: siteDirectory,
    encoding: "utf8",
  });
}

test("candidate bank remains held and independently evidenced cards can be dry-run promoted", () => {
  const catalogBefore = fs.readFileSync(catalogPath, "utf8");

  const check = JSON.parse(run(candidateCheck));
  assert.equal(check.mechanically_valid, true);
  assert.equal(check.editorially_approved_cards, 0);
  assert.equal(check.candidate_cards, 35);

  const promotion = run(candidatePromotion, [
    "--approve", "SG-262,SG-263",
    "--dry-run", "true",
  ]);
  assert.match(promotion, /dry-run|approved|promotion/i);
  assert.equal(fs.readFileSync(catalogPath, "utf8"), catalogBefore);
});
