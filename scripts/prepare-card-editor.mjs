import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "content", "party-deck-catalog.json");
const publicDirectory = path.join(root, "public");
const targetPath = path.join(publicDirectory, "party-deck-catalog.json");
const cards = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!Array.isArray(cards) || cards.length < 350) throw new Error("Party deck catalog is not a valid card array.");
mkdirSync(publicDirectory, { recursive: true });
writeFileSync(targetPath, `${JSON.stringify(cards)}\n`, "utf8");
