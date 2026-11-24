"use client";

import { useEffect, useMemo, useState } from "react";

type JsonObject = Record<string, unknown>;
type Level = JsonObject & { id: number; enabled?: boolean };
type Pack = { version?: number; content_version?: string; levels: Level[] };
type State = { pack: Pack | null; revision: number; updated_at?: number | null; updated_by?: string | null };

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

export function PicsPackAdminPanel() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [revision, setRevision] = useState(0);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");

  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin/pics-pack", { credentials: "same-origin", cache: "no-store" });
      const body = object(await response.json());
      if (!response.ok) throw new Error(String(object(body?.error)?.message ?? "Could not load the remote Pics pack."));
      const state = body as unknown as State;
      setRevision(Number(state.revision ?? 0));
      setSource(state.pack ? JSON.stringify(state.pack, null, 2) : "");
      setAuthorized(true);
    } catch (error) {
      setAuthorized(false);
      setMessage(error instanceof Error ? error.message : "Owner access could not be verified.");
    } finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, []);

  const pack = useMemo(() => {
    try {
      const parsed = object(JSON.parse(source));
      return parsed && Array.isArray(parsed.levels) ? parsed as unknown as Pack : null;
    } catch { return null; }
  }, [source]);
  const visibleLevels = useMemo(() => (pack?.levels ?? []).filter((level) =>
    `${level.id} ${String(level.answer ?? "")} ${String(level.category ?? "")}`.toLowerCase().includes(filter.toLowerCase()),
  ), [filter, pack]);
  const enabledCount = pack?.levels.filter((level) => level.enabled !== false).length ?? 0;

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setMessage("Pack JSON must be 4 MB or smaller."); return; }
    setSource(await file.text());
    setMessage("Pack loaded. Review level visibility, then save to publish it to players.");
  }

  function setLevelEnabled(id: number, enabled: boolean) {
    if (!pack) return;
    setSource(JSON.stringify({ ...pack, levels: pack.levels.map((level) => level.id === id ? { ...level, enabled } : level) }, null, 2));
  }

  async function save() {
    if (!pack) { setMessage("Load valid pack JSON before saving."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/admin/pics-pack", {
        method: "PUT", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected_revision: revision, pack }),
      });
      const body = object(await response.json());
      if (!response.ok) {
        const issues = Array.isArray(body?.issues) ? body.issues.filter((issue): issue is string => typeof issue === "string") : [];
        throw new Error(issues.length ? issues.slice(0, 20).join("\n") : String(object(body?.error)?.message ?? "The Pics pack was not saved."));
      }
      setRevision(Number(body?.revision ?? revision + 1));
      setSource(JSON.stringify(body?.pack ?? pack, null, 2));
      setMessage(`Published revision ${String(body?.revision ?? revision + 1)} · ${enabledCount} active levels. Devices will fetch it when they open Wetin Be Dis Pics.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The Pics pack was not saved."); }
    finally { setBusy(false); }
  }

  return (
    <section className="admin-console" aria-busy={busy}>
      <div className="admin-panel">
        <div className="admin-panel-title">
          <div><span>4</span><h2>Remote Four Pics levels</h2></div>
          <label className="admin-file-button">Load pack JSON<input type="file" accept="application/json,.json" onChange={(event) => void chooseFile(event.target.files?.[0])} disabled={authorized !== true || busy} /></label>
        </div>
        <p className="admin-help">Hide a level to remove it from play, restore it later, or edit its answer, category, difficulty, and four photo records below. Photos can use an existing bundled asset name or an HTTPS <code>image_url</code>.</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "12px 0" }}>
          <span>{pack ? `${enabledCount} active · ${pack.levels.length} total · revision ${revision}` : "No remote pack published yet. Load the app’s pics_levels.json to start."}</span>
          <button type="button" onClick={() => void load()} disabled={busy}>Reload</button>
        </div>
        {pack && <>
          <input aria-label="Filter levels" placeholder="Find level by answer, category, or ID" value={filter} onChange={(event) => setFilter(event.target.value)} style={{ width: "100%", marginBottom: 10 }} />
          <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #302b38", borderRadius: 10, marginBottom: 12 }}>
            {visibleLevels.slice(0, 250).map((level) => <div key={level.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", borderBottom: "1px solid #302b38" }}>
              <span><b>#{level.id}</b> · {String(level.answer ?? "(no answer)")} <small style={{ color: "#aaa0ad" }}>· {String(level.category ?? "")}</small></span>
              <button type="button" onClick={() => setLevelEnabled(Number(level.id), level.enabled === false)}>{level.enabled === false ? "Restore" : "Hide"}</button>
            </div>)}
            {visibleLevels.length > 250 && <p style={{ padding: 12 }}>Showing first 250 matches; use the filter to narrow the list.</p>}
          </div>
        </>}
        <textarea className="admin-json" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Load pics_levels.json or paste a pack document…" spellCheck={false} disabled={authorized !== true || busy} aria-label="Four Pics pack JSON" />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" onClick={() => void save()} disabled={authorized !== true || busy || !pack}>{busy ? "Saving…" : "Publish Four Pics pack"}</button>
        </div>
        {message && <pre role="status" style={{ whiteSpace: "pre-wrap", color: message.includes("Published") ? "#6ee7a1" : "#ffd76b" }}>{message}</pre>}
      </div>
    </section>
  );
}
