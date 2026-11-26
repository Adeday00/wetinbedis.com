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
  sponsorEnabled: boolean,
  sponsorKind: SponsorKind,
  sponsorName: string,
  sponsorMessage: string,
): string {
  const value = asObject(JSON.parse(source));
  if (!value) throw new Error("The release must be a JSON object.");
  if (!sponsorEnabled || !sponsorKind) {
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
  const [sponsorEnabled, setSponsorEnabled] = useState(false);
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

  useEffect(() => {
    const stagedRelease = sessionStorage.getItem("wbd.admin.prepared-content-release");
    if (!stagedRelease) return;
    sessionStorage.removeItem("wbd.admin.prepared-content-release");
    setReleaseJSON(JSON.stringify(JSON.parse(stagedRelease), null, 2));
    setNotice({
      tone: "neutral",
      title: "Reviewed Solo Gist cards loaded",
      lines: ["The scheduled release is ready for validation. Review its counts and schedule before publishing."],
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
      const prepared = releaseWithSponsor(releaseJSON, sponsorEnabled, sponsorKind, sponsorName, sponsorMessage);
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
        <p className="admin-help">Publish a labeled, non-clickable League placement for this release only. Leave it off to hide the sponsor area from players.</p>
        <label className="admin-switch-row" style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 18px", fontWeight: 700 }}>
          <input
            type="checkbox"
            role="switch"
            checked={sponsorEnabled}
            onChange={(event) => { setSponsorEnabled(event.target.checked); setValidatedJSON(null); setConfirmed(false); }}
            disabled={busy}
          />
          Show sponsor placement to players
        </label>
        <div className="admin-fields">
          <label>Kind
            <select value={sponsorKind} onChange={(event) => { setSponsorKind(event.target.value as SponsorKind); setValidatedJSON(null); }} disabled={!sponsorEnabled || busy}>
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

type ManagedCategory = {
  id: string;
  display_name: string;
  enabled: boolean;
  access: "free" | "full_gist" | "featured" | "temporary_unlock";
  content_release_id: string;
  style_key: string;
  icon_url: string | null;
  display_order: number;
  starts_at: string | null;
  ends_at: string | null;
};

function categoryID(name: string): string {
  const value = name.normalize("NFKD").toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 96);
  return value.length >= 2 ? value : "";
}

/** Owner-only controls backed by the same signed app-config publication API used by the app. */
export function CategoryManager() {
  const builtInCategories = ["Celebrities", "Culture", "Nollywood", "Celebrations", "Trending Now", "Food", "Music", "Naija Life", "Diaspora", "Slang", "Religion", "School"];
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [config, setConfig] = useState<JsonObject | null>(null);
  const [categories, setCategories] = useState<ManagedCategory[]>([]);
  const [defaultCategory, setDefaultCategory] = useState("Food");
  const [newName, setNewName] = useState("");
  const [releaseID, setReleaseID] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([
      fetch("/api/v1/admin/content/session", { credentials: "same-origin" }),
      fetch("/api/v1/app-config", { credentials: "same-origin" }),
      fetch("/api/v1/admin/content/catalog", { credentials: "same-origin" }),
    ]).then(async ([session, response, catalogResponse]) => {
      if (!session.ok) throw new Error("Sign in with the content-owner account to manage categories.");
      if (!response.ok) throw new Error("Could not load the published app settings.");
      if (!catalogResponse.ok) throw new Error("Could not load the current game categories.");
      const value = asObject(await response.json());
      if (!value) throw new Error("Published app settings were invalid.");
      setConfig(value);
      setDefaultCategory(String(asObject(value.setup)?.default_category ?? "Food"));
      const rows = Array.isArray(value.categories) ? value.categories : [];
      const configured: ManagedCategory[] = rows.map((row, index) => {
        const item = asObject(row) ?? {};
        return {
          id: String(item.id ?? ""), display_name: String(item.display_name ?? ""),
          enabled: item.enabled === true,
          access: (["free", "full_gist", "featured", "temporary_unlock"].includes(String(item.access)) ? item.access : "full_gist") as ManagedCategory["access"],
          content_release_id: String(item.content_release_id ?? ""), style_key: String(item.style_key ?? "generic_premium"),
          icon_url: typeof item.icon_url === "string" ? item.icon_url : null,
          display_order: Number.isInteger(item.display_order) ? Number(item.display_order) : index,
          starts_at: typeof item.starts_at === "string" ? item.starts_at : null,
          ends_at: typeof item.ends_at === "string" ? item.ends_at : null,
        };
      });
      const catalog = asObject(await catalogResponse.json());
      const catalogCategories = Array.isArray(catalog?.categories) ? catalog.categories : [];
      const configuredNames = new Set(configured.map((item) => item.display_name.toLocaleLowerCase()));
      const discovered = catalogCategories.flatMap((raw, index) => {
        const item = asObject(raw);
        const name = typeof item?.name === "string" ? item.name.trim() : "";
        const id = categoryID(name);
        if (!name || !id || configuredNames.has(name.toLocaleLowerCase())) return [];
        return [{ id, display_name: name, enabled: true, access: "full_gist" as const, content_release_id: "current", style_key: "generic_premium", icon_url: null, display_order: configured.length + index, starts_at: null, ends_at: null }];
      });
      setCategories([...configured, ...discovered]);
      setAuthorized(true);
    }).catch((error: unknown) => { setAuthorized(false); setMessage(error instanceof Error ? error.message : "Could not load category controls."); });
  }, []);

  function change(index: number, patch: Partial<ManagedCategory>) {
    setCategories((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function addCategory() {
    const name = newName.trim();
    const id = categoryID(name);
    if (!name || !id || !releaseID.trim()) { setMessage("Enter a category name and its published content release ID."); return; }
    if (categories.some((item) => item.id === id || item.display_name.toLocaleLowerCase() === name.toLocaleLowerCase())) { setMessage("That category already exists."); return; }
    setCategories((current) => [...current, { id, display_name: name, enabled: true, access: "full_gist", content_release_id: releaseID.trim(), style_key: "generic_premium", icon_url: null, display_order: current.length, starts_at: null, ends_at: null }]);
    setNewName(""); setReleaseID(""); setMessage("Category added to this draft. Publish a content release containing its cards before enabling it for players.");
  }

  function move(index: number, delta: number) {
    setCategories((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((item, display_order) => ({ ...item, display_order }));
    });
  }

  async function publishCategories() {
    if (!config) return;
    setBusy(true); setMessage("");
    try {
      const candidate = { ...config, revision: Number(config.revision ?? 0) + 1, published_at: new Date().toISOString(), setup: { default_category: defaultCategory }, categories: categories.map((item, display_order) => ({ ...item, icon_url: item.icon_url?.trim() || null, display_order })) };
      async function post(path: string, body: JsonObject) {
        const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const result = asObject(await response.json());
        if (!response.ok) throw new Error(Array.isArray(result?.issues) ? result.issues.join(" · ") : String(asObject(result?.error)?.message ?? `Request failed (${response.status}).`));
        return result ?? {};
      }
      const reason = "Remote category management";
      const validation = await post("/api/v1/admin/app-config/validate", { config: candidate });
      if (validation.valid !== true) throw new Error("The category settings did not pass validation.");
      await post("/api/v1/admin/app-config/draft", { config: candidate, reason });
      await post("/api/v1/admin/app-config/review", { revision: candidate.revision, reason });
      await post("/api/v1/admin/app-config/publish", { revision: candidate.revision, reason });
      setConfig(candidate); setMessage("Published. iPhone and Android will open the selected pack after their next remote-config refresh.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not publish category settings."); }
    finally { setBusy(false); }
  }

  return <section className="admin-panel" aria-busy={busy}>
    <div className="admin-panel-title"><div><span>★</span><h2>Remote category management</h2></div></div>
    <p className="admin-help">Add category cards in the card editor and publish a content release. Then set access here. Turn a category off to hide it in both apps; its cards remain in published releases.</p>
    {authorized === false && <div className="admin-notice bad" role="alert">{message}</div>}
    {authorized === true && <>
      <label className="admin-field-wide">Pack shown first in the hand picker
        <select value={defaultCategory} onChange={(event) => setDefaultCategory(event.target.value)} disabled={busy}>
          {[...new Set([...builtInCategories, ...categories.filter((item) => item.enabled).map((item) => item.display_name)])]
            .filter((name) => !categories.some((item) => item.display_name === name && !item.enabled))
            .map((name) => <option key={name} value={name}>{name === "Celebrations" ? "Detty December" : name}</option>)}
        </select>
      </label>
      <div className="admin-fields">
        {categories.map((item, index) => <div className="admin-field-wide" key={item.id} style={{ display: "grid", gridTemplateColumns: "minmax(130px,1fr) auto minmax(150px,1fr)", gap: 12, alignItems: "end", padding: "10px 0", borderBottom: "1px solid #ddd" }}>
          <label>Category<input value={item.display_name} onChange={(event) => change(index, { display_name: event.target.value })} maxLength={80} disabled={busy} /></label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={item.enabled} onChange={(event) => change(index, { enabled: event.target.checked })} disabled={busy} /> Enabled</label>
            <button type="button" aria-label={`Move ${item.display_name} up`} onClick={() => move(index, -1)} disabled={busy || index === 0}>↑</button>
            <button type="button" aria-label={`Move ${item.display_name} down`} onClick={() => move(index, 1)} disabled={busy || index === categories.length - 1}>↓</button>
          </div>
          <label>Content release ID<input value={item.content_release_id} onChange={(event) => change(index, { content_release_id: event.target.value })} maxLength={128} disabled={busy} /></label>
          <label>Category look<select value={item.style_key} onChange={(event) => change(index, { style_key: event.target.value })} disabled={busy}>{["generic_premium", "food", "music", "celebrities", "naija_life", "slang", "nollywood", "celebrations", "trending_now", "culture", "religion", "school", "diaspora"].map((key) => <option key={key} value={key}>{key.replaceAll("_", " ")}</option>)}</select></label>
          <label>Custom icon image URL<input value={item.icon_url ?? ""} onChange={(event) => change(index, { icon_url: event.target.value || null })} placeholder="https://… (optional)" disabled={busy} /></label>
        </div>)}
        <label>New category name<input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={80} placeholder="e.g. Naija Weddings" disabled={busy} /></label>
        <label>Published content release ID<input value={releaseID} onChange={(event) => setReleaseID(event.target.value)} maxLength={128} placeholder="e.g. party-2026-week-48" disabled={busy} /></label>
      </div>
      <div className="admin-actions"><button className="button button-secondary" onClick={addCategory} disabled={busy}>Add category</button><button className="button button-primary" onClick={() => void publishCategories()} disabled={busy || !config}>{busy ? "Publishing…" : "Publish category settings"}</button></div>
      {message && authorized && <div className="admin-notice neutral" role="status">{message}</div>}
    </>}
  </section>;
}

const themeOptions = [
  { key: "owambe", label: "Owambe (player appearance setting)" },
  { key: "lagos_night", label: "Lagos Night (dark)" },
  { key: "market_day", label: "Market Day (light)" },
];
const cardDisplayOptions = [
  { key: "classic", label: "Classic" },
  { key: "editorial", label: "Editorial serif" },
  { key: "bold", label: "Bold sign lettering" },
];

export function BrandingManager() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [config, setConfig] = useState<JsonObject | null>(null);
  const [logoURL, setLogoURL] = useState("");
  const [themeKey, setThemeKey] = useState("owambe");
  const [cardDisplay, setCardDisplay] = useState("classic");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([
      fetch("/api/v1/admin/content/session", { credentials: "same-origin" }),
      fetch("/api/v1/app-config", { credentials: "same-origin" }),
    ]).then(async ([session, response]) => {
      if (!session.ok) throw new Error("Sign in with the content-owner account to manage the brand settings.");
      if (!response.ok) throw new Error("Could not load the published app settings.");
      const value = asObject(await response.json());
      if (!value) throw new Error("Published app settings were invalid.");
      const branding = asObject(value.branding);
      setConfig(value);
      setLogoURL(typeof branding?.logo_url === "string" ? branding.logo_url : "");
      setThemeKey(typeof branding?.theme_key === "string" ? branding.theme_key : "owambe");
      setCardDisplay(typeof branding?.card_display === "string" ? branding.card_display : "classic");
      setAuthorized(true);
    }).catch((error: unknown) => {
      setAuthorized(false);
      setMessage(error instanceof Error ? error.message : "Could not load the brand controls.");
    });
  }, []);

  async function publish() {
    if (!config) return;
    setBusy(true); setMessage("");
    try {
      const candidate = {
        ...config,
        revision: Number(config.revision ?? 0) + 1,
        published_at: new Date().toISOString(),
        branding: { logo_url: logoURL.trim() || null, theme_key: themeKey, card_display: cardDisplay },
      };
      async function post(path: string, body: JsonObject) {
        const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const result = asObject(await response.json());
        if (!response.ok) throw new Error(Array.isArray(result?.issues) ? result.issues.join(" · ") : String(asObject(result?.error)?.message ?? `Request failed (${response.status}).`));
        return result ?? {};
      }
      const reason = "Remote brand presentation settings";
      const validation = await post("/api/v1/admin/app-config/validate", { config: candidate });
      if (validation.valid !== true) throw new Error("The brand settings did not pass validation.");
      await post("/api/v1/admin/app-config/draft", { config: candidate, reason });
      await post("/api/v1/admin/app-config/review", { revision: candidate.revision, reason });
      await post("/api/v1/admin/app-config/publish", { revision: candidate.revision, reason });
      setConfig(candidate);
      setMessage("Published. Compatible app versions will apply these settings on their next config refresh.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not publish brand settings."); }
    finally { setBusy(false); }
  }

  return <section className="admin-panel" aria-busy={busy}>
    <div className="admin-panel-title"><div><span>✦</span><h2>Remote brand controls</h2></div></div>
    <p className="admin-help">Change the in-app logo, a built-in theme, and a supported party-card treatment. This does not change the App Store icon. New controls require a compatible app version; old versions keep their bundled defaults.</p>
    {authorized === false && <div className="admin-notice bad" role="alert">{message}</div>}
    {authorized && <>
      <label className="admin-field-wide">In-app logo image URL<input type="url" value={logoURL} onChange={(event) => setLogoURL(event.target.value)} placeholder="https://… (blank uses the bundled mark)" disabled={busy} /></label>
      <div className="admin-fields">
        <label>Theme<select value={themeKey} onChange={(event) => setThemeKey(event.target.value)} disabled={busy}>{themeOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label>Party card display<select value={cardDisplay} onChange={(event) => setCardDisplay(event.target.value)} disabled={busy}>{cardDisplayOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      </div>
      <div className="admin-actions"><button className="button button-primary" onClick={() => void publish()} disabled={busy || !config}>{busy ? "Publishing…" : "Publish brand settings"}</button></div>
      {message && <div className="admin-notice neutral" role="status">{message}</div>}
    </>}
  </section>;
}

type HomeAnnouncementDraft = {
  id: string;
  enabled: boolean;
  headline: string;
  message: string;
  starts_at: string;
  ends_at: string;
};

function localDateTime(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function utcDateTime(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const defaultHomeAnnouncement: HomeAnnouncementDraft = {
  id: "gist-keeps-growing",
  enabled: false,
  headline: "The gist keeps growing!",
  message: "Thank you for playing Wetin Be Dis and bringing your people into the game.",
  starts_at: "",
  ends_at: "",
};

export function HomeAnnouncementManager() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [config, setConfig] = useState<JsonObject | null>(null);
  const [announcement, setAnnouncement] = useState<HomeAnnouncementDraft>(defaultHomeAnnouncement);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([
      fetch("/api/v1/admin/content/session", { credentials: "same-origin" }),
      fetch("/api/v1/app-config", { credentials: "same-origin" }),
    ]).then(async ([session, response]) => {
      if (!session.ok) throw new Error("Sign in with the content-owner account to manage Home announcements.");
      if (!response.ok) throw new Error("Could not load the published app settings.");
      const value = asObject(await response.json());
      if (!value) throw new Error("Published app settings were invalid.");
      setConfig(value);
      const home = asObject(value.home);
      const item = asObject(home?.announcement);
      if (item) {
        setAnnouncement({
          id: String(item.id ?? ""),
          enabled: item.enabled === true,
          headline: String(item.headline ?? ""),
          message: String(item.message ?? ""),
          starts_at: localDateTime(item.starts_at),
          ends_at: localDateTime(item.ends_at),
        });
      }
      setAuthorized(true);
    }).catch((error: unknown) => {
      setAuthorized(false);
      setMessage(error instanceof Error ? error.message : "Could not load Home announcement controls.");
    });
  }, []);

  async function publishAnnouncement() {
    if (!config) return;
    if (!announcement.id.trim() || !announcement.headline.trim() || !announcement.message.trim()) {
      setMessage("Add an announcement ID, headline, and message.");
      return;
    }
    if (announcement.enabled && !announcement.starts_at) {
      setMessage("Choose when the announcement should start before enabling it.");
      return;
    }
    if (announcement.starts_at && announcement.ends_at && new Date(announcement.ends_at) <= new Date(announcement.starts_at)) {
      setMessage("The end time must be later than the start time.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const home = asObject(config.home) ?? {};
      const candidate = {
        ...config,
        revision: Number(config.revision ?? 0) + 1,
        published_at: new Date().toISOString(),
        home: {
          ...home,
          announcement: {
            id: announcement.id.trim(),
            enabled: announcement.enabled,
            headline: announcement.headline.trim(),
            message: announcement.message.trim(),
            starts_at: utcDateTime(announcement.starts_at),
            ends_at: utcDateTime(announcement.ends_at),
          },
        },
      };
      async function post(path: string, body: JsonObject) {
        const response = await fetch(path, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = asObject(await response.json());
        if (!response.ok) throw new Error(Array.isArray(result?.issues) ? result.issues.join(" · ") : String(asObject(result?.error)?.message ?? `Request failed (${response.status}).`));
        return result ?? {};
      }
      const reason = announcement.enabled ? "Publish Home announcement" : "Update Home announcement";
      const validation = await post("/api/v1/admin/app-config/validate", { config: candidate });
      if (validation.valid !== true) throw new Error("The announcement settings did not pass validation.");
      await post("/api/v1/admin/app-config/draft", { config: candidate, reason });
      await post("/api/v1/admin/app-config/review", { revision: candidate.revision, reason });
      await post("/api/v1/admin/app-config/publish", { revision: candidate.revision, reason });
      setConfig(candidate);
      setMessage(announcement.enabled
        ? "Published. Supported iPhone and Android versions will show this once on Home during the scheduled window."
        : "Published with the announcement off. It will not appear in the apps.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not publish Home announcement settings.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="admin-panel" aria-busy={busy}>
    <div className="admin-panel-title"><div><span>✦</span><h2>Home announcement</h2></div></div>
    <p className="admin-help">Show a one-time, dismissible message on Home for players who open the app. This works independently of Odogwu League and does not require push permission. Players need an app version that supports Home announcements.</p>
    {authorized === false && <div className="admin-notice bad" role="alert">{message}</div>}
    {authorized === true && <>
      <div className="admin-fields">
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={announcement.enabled} onChange={(event) => setAnnouncement((current) => ({ ...current, enabled: event.target.checked }))} disabled={busy} />
          Show this announcement
        </label>
        <label>Announcement ID<input value={announcement.id} onChange={(event) => setAnnouncement((current) => ({ ...current, id: event.target.value }))} maxLength={96} disabled={busy} /><small>Each device sees an ID once. Change the ID to show a new announcement.</small></label>
        <label>Headline<input value={announcement.headline} onChange={(event) => setAnnouncement((current) => ({ ...current, headline: event.target.value }))} maxLength={140} disabled={busy} /></label>
        <label>Message<textarea value={announcement.message} onChange={(event) => setAnnouncement((current) => ({ ...current, message: event.target.value }))} maxLength={500} rows={3} disabled={busy} /></label>
        <label>Start showing at (your local time)<input type="datetime-local" value={announcement.starts_at} onChange={(event) => setAnnouncement((current) => ({ ...current, starts_at: event.target.value }))} disabled={busy} /></label>
        <label>Stop showing at (optional)<input type="datetime-local" value={announcement.ends_at} onChange={(event) => setAnnouncement((current) => ({ ...current, ends_at: event.target.value }))} disabled={busy} /></label>
      </div>
      <div className="admin-actions"><button className="button button-primary" onClick={() => void publishAnnouncement()} disabled={busy || !config}>{busy ? "Publishing…" : "Publish Home announcement"}</button></div>
      {message && <div className="admin-notice neutral" role="status">{message}</div>}
    </>}
  </section>;
}

export function OwnerCardPreviewAdminPanel() {
  const [active, setActive] = useState(false);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadStatus() {
    const response = await fetch("/api/v1/admin/card-preview/token", { credentials: "same-origin" });
    if (!response.ok) return;
    const payload = await response.json() as { active?: boolean; created_at?: number | null };
    setActive(payload.active === true);
    setCreatedAt(payload.created_at ?? null);
  }

  useEffect(() => { void loadStatus(); }, []);

  async function issueToken() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/admin/card-preview/token", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = await response.json() as { token?: string; created_at?: number; error?: { message?: string } };
      if (!response.ok || !payload.token) throw new Error(payload.error?.message ?? "The preview token could not be issued.");
      setToken(payload.token);
      setActive(true);
      setCreatedAt(payload.created_at ?? Date.now());
      setNotice("Copy this token into the iPhone now. It will not be shown again.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The preview token could not be issued.");
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setNotice("Copied. Paste it into the app’s Silent card preview screen.");
  }

  return (
    <section className="admin-console">
      <div className="admin-panel">
        <div className="admin-panel-title"><div><span>OWNER</span><h2>Silent card preview</h2></div></div>
        <p className="admin-help">Issue a read-only token for your phone to inspect the current published League cards. It cannot start games, submit answers, change standings, send notifications or create payouts.</p>
        <p className="admin-help">Status: <strong>{active ? "active" : "not configured"}</strong>{createdAt ? ` · issued ${new Date(createdAt).toLocaleString()}` : ""}</p>
        <div className="admin-actions">
          <button className="button button-primary" onClick={() => void issueToken()} disabled={busy}>
            {busy ? "Issuing…" : active ? "Rotate phone token" : "Issue phone token"}
          </button>
          {token && <button className="button button-secondary" onClick={() => void copyToken()}>Copy token</button>}
        </div>
        {token && <textarea className="admin-json" value={token} readOnly aria-label="One-time phone preview token" />}
        {notice && <div className="admin-notice neutral" role="status"><strong>{notice}</strong></div>}
      </div>
    </section>
  );
}

type CatalogQuestion = {
  id: string;
  category: string;
  answer_family: string;
  clues: string[];
  options: Array<{ id: string; label: string }>;
  correct_option_id: string;
};
type CatalogPartyCard = {
  "Card Number": number;
  ID: string;
  Difficulty: string;
  Category: string;
  "Main Word": string;
  "Forbidden Word 1": string;
  "Forbidden Word 2": string;
  "Forbidden Word 3": string;
};

export function OwnerContentCatalogPanel() {
  const [catalog, setCatalog] = useState<{
    generated_at?: number;
    today_wat?: string;
    solo?: { content_version?: string; daily_pack_date_wat?: string | null; questions?: CatalogQuestion[] };
    party_deck?: { source?: string; updated_at?: number | null; cards?: CatalogPartyCard[] };
    categories?: Array<{ name: string; count: number }>;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/admin/content/catalog", { credentials: "same-origin", cache: "no-store" });
      const payload = await response.json() as typeof catalog & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "The content catalog could not be loaded.");
      setCatalog(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The content catalog could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const categories = ["All", ...(catalog?.categories ?? []).map((item) => item.name)];
  const matches = (value: string) => !normalizedQuery || value.toLocaleLowerCase().includes(normalizedQuery);
  const todaysQuestions = (catalog?.solo?.questions ?? []).filter((question) =>
    (category === "All" || question.category === category)
    && matches(`${question.id} ${question.category} ${question.answer_family} ${question.clues.join(" ")} ${question.options.map((option) => option.label).join(" ")}`),
  );
  const partyCards = (catalog?.party_deck?.cards ?? []).filter((card) =>
    (category === "All" || card.Category === category)
    && matches(`${card.ID} ${card.Category} ${card["Main Word"]} ${card["Forbidden Word 1"]} ${card["Forbidden Word 2"]} ${card["Forbidden Word 3"]}`),
  );

  return (
    <section className="admin-console" aria-busy={busy}>
      <div className="admin-panel">
        <div className="admin-panel-title">
          <div><span>CONTENT</span><h2>Today&apos;s 5 &amp; regular categories</h2></div>
          <button className="button button-secondary" type="button" onClick={() => void load()} disabled={busy}>Refresh</button>
        </div>
        <p className="admin-help">Read-only view of the active published Solo pack and the regular Party Deck library. This is the same content the app receives.</p>
        {error && <div className="admin-notice bad" role="alert"><strong>{error}</strong></div>}
        {busy && !catalog ? <p className="admin-help">Loading the active catalog…</p> : catalog && (
          <>
            <div className="admin-actions">
              <strong>Today&apos;s 5 · {catalog.solo?.daily_pack_date_wat ?? catalog.today_wat ?? "—"}</strong>
              <span className="admin-help">{catalog.solo?.questions?.length ?? 0} cards · content {catalog.solo?.content_version ?? "—"}</span>
            </div>
            <div className="admin-fields">
              <label className="admin-field-wide">Search cards
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ID, category, clue, answer…" />
              </label>
              <label>Category
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              {todaysQuestions.length === 0 ? <p className="admin-help">No Today&apos;s 5 cards match this filter.</p> : todaysQuestions.map((question, index) => {
                const answer = question.options.find((option) => option.id === question.correct_option_id)?.label ?? "Unknown";
                return <details key={question.id} className="admin-panel" style={{ padding: 14 }} open={index === 0}>
                  <summary style={{ cursor: "pointer", fontWeight: 800 }}>{index + 1}. {question.category} · {question.id} <span style={{ color: "#f6b51b" }}>Answer: {answer}</span></summary>
                  <p className="admin-help">{question.clues.join(" · ")}</p>
                  <small>Options: {question.options.map((option) => option.label).join(" · ")}</small>
                </details>;
              })}
            </div>
          </>
        )}
      </div>

      <div className="admin-panel">
        <div className="admin-panel-title"><div><span>LIBRARY</span><h2>Regular category cards</h2></div></div>
        <p className="admin-help">{partyCards.length} matching Party Deck cards · source: {catalog?.party_deck?.source ?? "—"}{catalog?.party_deck?.updated_at ? ` · updated ${new Date(catalog.party_deck.updated_at).toLocaleString()}` : ""}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {(catalog?.categories ?? []).map((item) => <button key={item.name} type="button" onClick={() => setCategory(item.name)} style={{ background: category === item.name ? "#f6b51b" : "#302b38", color: category === item.name ? "#17151b" : "#fff4d7", border: 0, borderRadius: 999, padding: "7px 10px", fontWeight: 800 }}>{item.name} · {item.count}</button>)}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {partyCards.slice(0, 500).map((card) => <details key={card.ID} style={{ borderTop: "1px solid #302b38", padding: "10px 0" }}>
            <summary style={{ cursor: "pointer" }}><b>#{card["Card Number"]} · {card["Main Word"]}</b> <span style={{ color: "#aaa0ad" }}>· {card.Category} · {card.Difficulty}</span></summary>
            <p className="admin-help">Forbidden: {card["Forbidden Word 1"]}, {card["Forbidden Word 2"]}, {card["Forbidden Word 3"]}</p>
            <small>ID: {card.ID}</small>
          </details>)}
          {partyCards.length === 0 && <p className="admin-help">No regular cards match this filter.</p>}
        </div>
      </div>
    </section>
  );
}
