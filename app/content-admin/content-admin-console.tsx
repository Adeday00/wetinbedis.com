"use client";

import { useEffect, useMemo, useState } from "react";

type JsonObject = Record<string, unknown>;
type SponsorKind = "" | "commercial" | "prizeFunding";
type Notice = { tone: "good" | "bad" | "neutral"; title: string; lines: string[] };

const maximumFileBytes = 2 * 1_024 * 1_024;

function asObject(value: unknown): JsonObject | null {
  return value && !Array.isArray(value) && typeof value === "object"
    ? value as JsonObject
    : null;
}

function releaseWithSponsor(
  source: string,
  sponsorKind: SponsorKind,
  sponsorName: string,
  sponsorMessage: string,
): string {
  const value = asObject(JSON.parse(source));
  if (!value) throw new Error("The release must be a JSON object.");
  if (!sponsorKind) {
    delete value.sponsor;
  } else {
    if (!sponsorName.trim()) throw new Error("Sponsor name is required when a sponsor kind is set.");
    value.sponsor = {
      kind: sponsorKind,
      sponsor_name: sponsorName.trim(),
      ...(sponsorMessage.trim() ? { message: sponsorMessage.trim() } : {}),
    };
  }
  return JSON.stringify(value, null, 2);
}

function summaryNotice(payload: JsonObject, didPublish: boolean): Notice {
  const release = asObject(payload.release);
  const assets = asObject(release?.assets);
  const party = asObject(assets?.party_deck);
  const solo = asObject(assets?.solo_gist);
  return {
    tone: "good",
    title: didPublish ? "Release published" : "Release passed every check",
    lines: [
      `Revision ${String(release?.revision ?? "")} · ${String(release?.effective_week_wat ?? "")}`,
      `${String(party?.item_count ?? "?")} party cards · ${String(solo?.item_count ?? "?")} Solo questions`,
      didPublish
        ? "The manifest will activate only inside its WAT schedule."
        : "Review the summary, confirm below, then publish.",
    ],
  };
}

export function ContentAdminConsole() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [releaseJSON, setReleaseJSON] = useState("");
  const [sponsorKind, setSponsorKind] = useState<SponsorKind>("");
  const [sponsorName, setSponsorName] = useState("");
  const [sponsorMessage, setSponsorMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [validatedJSON, setValidatedJSON] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const canPublish = useMemo(
    () => authorized === true && confirmed && validatedJSON !== null && validatedJSON === releaseJSON,
    [authorized, confirmed, validatedJSON, releaseJSON],
  );

  useEffect(() => {
    fetch("/api/v1/admin/content/session", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("This signed-in account is not on the content-owner allowlist.");
        setAuthorized(true);
      })
      .catch((error: unknown) => {
        setAuthorized(false);
        setNotice({
          tone: "bad",
          title: "Publishing access denied",
          lines: [error instanceof Error ? error.message : "Owner verification failed."],
        });
      });
  }, []);

  function contentChanged(next: string) {
    setReleaseJSON(next);
    setValidatedJSON(null);
    setConfirmed(false);
    setNotice(null);
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (file.size > maximumFileBytes) {
      setNotice({ tone: "bad", title: "File is too large", lines: ["Release JSON must be 2 MB or less."] });
      return;
    }
    contentChanged(await file.text());
  }

  async function send(action: "validate" | "publish") {
    setBusy(true);
    setNotice(null);
    try {
      const prepared = releaseWithSponsor(releaseJSON, sponsorKind, sponsorName, sponsorMessage);
      if (prepared !== releaseJSON) setReleaseJSON(prepared);
      const response = await fetch(`/api/v1/admin/content/releases/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: prepared,
      });
      const payload = asObject(await response.json());
      if (!payload) throw new Error("The publisher returned an invalid response.");
      if (!response.ok) {
        const error = asObject(payload.error);
        const issues = Array.isArray(payload.issues)
          ? payload.issues.filter((issue): issue is string => typeof issue === "string").slice(0, 25)
          : [];
        throw new Error(
          issues.length > 0
            ? issues.join("\n")
            : String(error?.message ?? "The release was rejected."),
        );
      }
      setReleaseJSON(prepared);
      setValidatedJSON(action === "validate" ? prepared : null);
      setConfirmed(false);
      setNotice(summaryNotice(payload, action === "publish"));
    } catch (error) {
      const lines = (error instanceof Error ? error.message : "The release was rejected.")
        .split("\n")
        .filter(Boolean)
        .slice(0, 25);
      setValidatedJSON(null);
      setConfirmed(false);
      setNotice({ tone: "bad", title: "Release not accepted", lines });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-console" aria-busy={busy}>
      <div className="admin-panel">
        <div className="admin-panel-title">
          <div><span>1</span><h2>Load release JSON</h2></div>
          <label className="admin-file-button">
            Choose file
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => void loadFile(event.target.files?.[0])}
              disabled={authorized !== true || busy}
            />
          </label>
        </div>
        <textarea
          className="admin-json"
          value={releaseJSON}
          onChange={(event) => contentChanged(event.target.value)}
          placeholder="Paste a generated content release here…"
          spellCheck={false}
          disabled={authorized !== true || busy}
          aria-label="Content release JSON"
        />
      </div>

      <div className="admin-panel">
        <div className="admin-panel-title"><div><span>2</span><h2>Optional sponsor</h2></div></div>
        <p className="admin-help">This creates a labeled, non-clickable League placement for this release only.</p>
        <div className="admin-fields">
          <label>Kind
            <select value={sponsorKind} onChange={(event) => { setSponsorKind(event.target.value as SponsorKind); setValidatedJSON(null); }} disabled={busy}>
              <option value="">No sponsor</option>
              <option value="commercial">Commercial</option>
              <option value="prizeFunding">Prize funding</option>
            </select>
          </label>
          <label>Name
            <input maxLength={64} value={sponsorName} onChange={(event) => { setSponsorName(event.target.value); setValidatedJSON(null); }} disabled={!sponsorKind || busy} />
          </label>
          <label className="admin-field-wide">Message <span>(optional)</span>
            <input maxLength={180} value={sponsorMessage} onChange={(event) => { setSponsorMessage(event.target.value); setValidatedJSON(null); }} disabled={!sponsorKind || busy} />
          </label>
        </div>
      </div>

      <div className="admin-actions">
        <button className="button button-secondary" onClick={() => void send("validate")} disabled={authorized !== true || busy || !releaseJSON.trim()}>
          {busy ? "Checking…" : "Validate release"}
        </button>
        <label className="admin-confirm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={validatedJSON === null || busy} />
          I reviewed the week, counts, and sponsor label.
        </label>
        <button className="button button-primary" onClick={() => void send("publish")} disabled={!canPublish || busy}>
          Publish atomically
        </button>
      </div>

      {notice && (
        <div className={`admin-notice ${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}>
          <strong>{notice.title}</strong>
          <ul>{notice.lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
