"use client";
import { useCallback, useEffect, useState } from "react";

type Tab =
  | "overview"
  | "live"
  | "reviews"
  | "payouts"
  | "players"
  | "fraud"
  | "content"
  | "notifications"
  | "support"
  | "analytics"
  | "health"
  | "settings"
  | "audit";
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Home", icon: "⌂" },
  { id: "live", label: "Run the League", icon: "◉" },
  { id: "reviews", label: "Review Winners", icon: "✓" },
  { id: "payouts", label: "Pay Winners", icon: "₦" },
  { id: "players", label: "Players", icon: "♙" },
  { id: "fraud", label: "Safety & Integrity", icon: "⚠" },
  { id: "content", label: "Questions & Packs", icon: "▦" },
  { id: "notifications", label: "Notifications", icon: "✦" },
  { id: "support", label: "Support & Privacy", icon: "?" },
  { id: "analytics", label: "Analytics", icon: "↗" },
  { id: "health", label: "System Health", icon: "♥" },
  { id: "settings", label: "Settings", icon: "⚙" },
  { id: "audit", label: "Audit Log", icon: "≡" },
];
const tabDescriptions: Record<Tab, string> = {
  overview: "See what needs your attention today.",
  live: "Start one session, watch players, and close it safely.",
  reviews: "Check finalists before they become eligible for payment.",
  payouts: "Collect payout details and track payment completion.",
  players: "Find players and manage account access.",
  fraud: "Investigate risk signals and protect the competition.",
  content: "Prepare, review, and publish the question packs.",
  notifications: "Send player updates and review delivery history.",
  support: "Handle player questions, disputes, and privacy requests.",
  analytics: "Understand participation, outcomes, and operations.",
  health: "Check whether the services are working normally.",
  settings: "Manage roles and owner-console configuration.",
  audit: "Review the permanent record of admin actions.",
};
function tabFromLocation(): Tab {
  if (typeof window === "undefined") return "overview";
  const value = new URL(window.location.href).searchParams.get("tab");
  if (tabs.some((item) => item.id === value)) return value as Tab;
  const saved = window.localStorage.getItem("wbd-admin-tab");
  return tabs.some((item) => item.id === saved) ? (saved as Tab) : "overview";
}
const card = {
  background: "#17151b",
  border: "1px solid #302b38",
  borderRadius: 18,
  padding: 20,
};
async function get(path: string) {
  const r = await fetch(path, { credentials: "include", cache: "no-store" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(`${path}: ${data?.error?.message ?? "Request failed"}`);
  return data;
}
function localDateTime(value: string | number | Date) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export default function AdminConsole() {
  const [user, setUser] = useState<string | null>(null),
    [tab, setTabState] = useState<Tab>(tabFromLocation),
    [message, setMessage] = useState(""),
    [reviews, setReviews] = useState<any[]>([]),
    [payouts, setPayouts] = useState<any[]>([]),
    [payoutDetails, setPayoutDetails] = useState<any[]>([]),
    [players, setPlayers] = useState<any[]>([]),
    [competitions, setCompetitions] = useState<any[]>([]),
    [requests, setRequests] = useState<any[]>([]),
    [supportCases, setSupportCases] = useState<any[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [config, setConfig] = useState<any>(null),
    [health, setHealth] = useState<any>(null),
    [notificationStatus, setNotificationStatus] = useState<any>(null),
    [analytics, setAnalytics] = useState<any>(null),
    [releases, setReleases] = useState<any[]>([]),
    [releasesError, setReleasesError] = useState(""),
    [leaderboard, setLeaderboard] = useState<any>(null),
    [leaderboardArchive, setLeaderboardArchive] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const activeCompetitionID = (() => {
    const live = competitions.find((item: any) => item.status === "open" && Number(item.start_at ?? 0) <= Date.now() && Number(item.end_at ?? 0) > Date.now());
    if (live) return live.id;
    const upcoming = competitions
      .filter((item: any) => item.status === "scheduled" && Number(item.start_at ?? 0) > Date.now())
      .sort((a: any, b: any) => Number(a.start_at) - Number(b.start_at))[0];
    if (upcoming) return upcoming.id;
    return competitions.find((item: any) => item.status === "draft")?.id ?? "";
  })();
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    window.localStorage.setItem("wbd-admin-tab", next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState({}, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") !== tab) {
      url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
    }
    window.localStorage.setItem("wbd-admin-tab", tab);
  }, [tab]);
  useEffect(() => {
    const onPopState = () => setTabState(tabFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const load = useCallback(async () => {
    setBusy(true);
    setMessage("");
    const results = await Promise.allSettled([
      get("/api/v1/admin/cash/reviews"),
      get("/api/v1/admin/cash/payouts"),
      get("/api/v1/admin/cash/payout-details"),
      get("/api/v1/app-config"),
      get("/api/v1/admin/audit?limit=100"),
      get("/api/v1/admin/players?limit=100"),
      get("/api/v1/admin/competitions"),
      get("/api/v1/admin/privacy/requests"),
      get("/api/v1/admin/support/cases"),
      get("/api/v1/admin/content/releases"),
      get("/api/v1/admin/health"),
      get("/api/v1/admin/notifications/status"),
      get("/api/v1/admin/analytics"),
    ]);
    const [r, p, pd, c, a, pl, co, s, sc, cr, h, ns, an] = results;
    if (r.status === "fulfilled") setReviews(r.value.reviews ?? []);
    if (p.status === "fulfilled") setPayouts(p.value.payouts ?? []);
    if (pd.status === "fulfilled")
      setPayoutDetails(pd.value.payout_details ?? []);
    if (c.status === "fulfilled") setConfig(c.value);
    if (a.status === "fulfilled") setAudit(a.value.audit ?? []);
    if (pl.status === "fulfilled") setPlayers(pl.value.players ?? []);
    if (co.status === "fulfilled") setCompetitions(co.value.competitions ?? []);
    if (s.status === "fulfilled") setRequests(s.value.requests ?? []);
    if (sc.status === "fulfilled") setSupportCases(sc.value.cases ?? []);
    if (cr.status === "fulfilled") { setReleases(cr.value.releases ?? []); setReleasesError(""); }
    else setReleasesError(cr.status === "rejected" && cr.reason instanceof Error ? cr.reason.message : "Release history is temporarily unavailable.");
    if (h.status === "fulfilled") setHealth(h.value);
    if (ns.status === "fulfilled") setNotificationStatus(ns.value);
    if (an.status === "fulfilled") setAnalytics(an.value);
    const failures = results
      .filter((x, index) => x.status === "rejected" && index !== 9)
      .map((x) =>
        x.status === "rejected" && x.reason instanceof Error ? x.reason.message : "Request failed",
      );
    setMessage(
      failures.length
        ? `Some operations data could not load: ${failures.join(" · ")}`
        : "",
    );
    setLastUpdatedAt(Date.now());
    setBusy(false);
  }, []);
  useEffect(() => {
    get("/api/v1/admin/session")
      .then((x) => {
        setUser(x.email ?? "Apple owner");
        load();
      })
      .catch(() => setUser(null));
  }, [load]);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [user, load]);
  useEffect(() => {
    let cancelled = false;
    if (!competitions.length) return;
    Promise.all(competitions.slice(0, 25).map((item: any) => get(`/api/v1/admin/leaderboard?competition_id=${encodeURIComponent(item.id)}`).catch(() => null)))
      .then((items) => { if (!cancelled) setLeaderboardArchive(items.filter(Boolean)); });
    return () => { cancelled = true; };
  }, [competitions]);
  useEffect(() => {
    if (tab !== "live" && tab !== "reviews" && tab !== "overview") return;
    if (!activeCompetitionID) return;
    let cancelled = false;
    const refreshLeaderboard = async () => {
      try {
        const next = await get(`/api/v1/admin/leaderboard?competition_id=${encodeURIComponent(activeCompetitionID)}`);
        if (!cancelled) setLeaderboard(next);
      } catch {
        // The existing dashboard data remains visible if a poll transiently fails.
      }
    };
    const timer = window.setInterval(refreshLeaderboard, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tab, activeCompetitionID]);
  async function createPayout(review: any) {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/admin/cash/payouts", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          competition_id: review.competition_id,
          attempt_id: review.attempt_id,
          place: review.place ?? 1,
          amount_minor: review.amount_minor ?? 10000000,
          currency: "NGN",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data?.error?.message ?? "Payout creation failed");
      const n = data.notification;
      if (n?.sent > 0)
        setMessage(
          `Payout form request created for ${review.public_handle ?? "winner"} and push notification sent to ${n.sent} device${n.sent === 1 ? "" : "s"}.`,
        );
      else if (n?.eligible === 0)
        setMessage(
          `Payout form request created for ${review.public_handle ?? "winner"}, but no eligible notification device was registered. The winner must open the app and check the League results screen.`,
        );
      else
        setMessage(
          `Payout form request created for ${review.public_handle ?? "winner"}, but push delivery failed for ${n.failed ?? 0} device${n.failed === 1 ? "" : "s"}. The in-app League results status remains authoritative.`,
        );
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Payout failed");
    } finally {
      setBusy(false);
    }
  }
  async function decideReview(review: any, status: string, note: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/cash/reviews/${review.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data?.error?.message ?? "Review update failed");
      setMessage(`Review marked ${status}.`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Review update failed");
    } finally {
      setBusy(false);
    }
  }
  async function prepareReview(reviewCompetitionID = leaderboard?.competition?.id ?? competitions.find((item: any) => item.status === "locked" || item.status === "final")?.id ?? "") {
    if (!reviewCompetitionID) {
      setMessage("Choose a closed competition before preparing winner review.");
      return;
    }
    const reviewLeaderboard = reviewCompetitionID === leaderboard?.competition?.id ? leaderboard : leaderboardArchive.find((item: any) => item.competition?.id === reviewCompetitionID);
    if (!reviewLeaderboard?.closed || !window.confirm("Prepare the top three finalists for owner review?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/competitions/${encodeURIComponent(reviewCompetitionID)}/prepare-review`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not prepare review queue");
      setMessage(`${data.finalist_count ?? 0} finalist review records prepared.`);
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not prepare review queue"); } finally { setBusy(false); }
  }
  if (!user)
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#0b0a0d",
          color: "#fff4d7",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui",
          padding: 24,
        }}
      >
        <section style={{ ...card, maxWidth: 460, textAlign: "center" }}>
          <div style={{ fontSize: 48 }}>?</div>
          <h1 style={{ fontFamily: "Georgia", fontSize: 42, margin: "8px 0" }}>
            Wetin Be Dis
          </h1>
          <p style={{ color: "#b8afbd" }}>Owner operations centre</p>
          <a
            href="/api/v1/admin/auth/apple/start?return_to=/admin"
            style={{
              display: "block",
              background: "#f6b51b",
              color: "#17120a",
              fontWeight: 800,
              padding: 14,
              borderRadius: 12,
              textDecoration: "none",
            }}
          >
            Sign in with Apple
          </a>
        </section>
      </main>
    );
  const pending = reviews.filter((x) => x.status === "pending").length,
    cleared = reviews.filter((x) => x.status === "cleared").length,
    paid = payouts.filter((x) => x.status === "sent").length;
  return (
    <main
      className="owner-console-shell"
      style={{
        minHeight: "100vh",
        background: "#0b0a0d",
        color: "#fff4d7",
        fontFamily: "system-ui",
        display: "flex",
      }}
    >
      <aside
        className="owner-console-sidebar"
        style={{
          width: 245,
          borderRight: "1px solid #29252e",
          padding: 24,
          flexShrink: 0,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 42 }}>
          ❔ WETIN BE DIS
        </div>
        <div style={{ color: "#8d8592", fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Daily work</div>
        {tabs.slice(0, 7).map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: 0,
              borderRadius: 10,
              padding: "12px 14px",
              margin: "4px 0",
              background: tab === x.id ? "#2a242f" : "transparent",
              color: tab === x.id ? "#f6b51b" : "#c8c0ca",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {x.icon} <span style={{ marginLeft: 10 }}>{x.label}</span>
          </button>
        ))}
        <div style={{ color: "#8d8592", fontSize: 11, textTransform: "uppercase", letterSpacing: 2, margin: "24px 0 12px" }}>Tools</div>
        {tabs.slice(7).map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)} style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderRadius: 10, padding: "12px 14px", margin: "4px 0", background: tab === x.id ? "#2a242f" : "transparent", color: tab === x.id ? "#f6b51b" : "#c8c0ca", fontWeight: 700, cursor: "pointer" }}>
            {x.icon} <span style={{ marginLeft: 10 }}>{x.label}</span>
          </button>
        ))}
        <div
          style={{
            borderTop: "1px solid #29252e",
            marginTop: 28,
            paddingTop: 18,
            color: "#8d8592",
            fontSize: 13,
          }}
        >
          Owner
          <br />
          <span style={{ color: "#fff4d7" }}>{user}</span>
        </div>
        <button
          onClick={() =>
            fetch("/api/v1/admin/logout", { method: "POST" }).then(() =>
              location.reload(),
            )
          }
          style={{
            marginTop: 18,
            background: "transparent",
            border: 0,
            color: "#b8afbd",
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </aside>
      <section className="owner-console-content" style={{ flex: 1, padding: "34px 42px", maxWidth: 1250 }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "start",
            marginBottom: 30,
          }}
        >
          <div>
            <div
              style={{
                color: "#f6b51b",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
            >
              Owner console
            </div>
            <h1
              style={{ fontFamily: "Georgia", fontSize: 44, margin: "8px 0" }}
            >
              {tabs.find((x) => x.id === tab)?.label}
            </h1>
            <p style={{ color: "#a9a1ad", margin: 0 }}>
              {tabDescriptions[tab]}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <button
              onClick={load}
              disabled={busy}
              style={{
                background: "#f6b51b",
                border: 0,
                borderRadius: 10,
                padding: "11px 16px",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {busy ? "Refreshing…" : "Refresh data"}
            </button>
            <small style={{ display: "block", color: "#8d8592", marginTop: 7 }}>
              Auto-refreshes every 30 seconds{lastUpdatedAt ? ` · Updated ${new Date(lastUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
            </small>
          </div>
        </header>
        {message && (
          <div
            style={{
              ...card,
              borderColor: "#9b6b16",
              marginBottom: 18,
              color: "#ffd76b",
            }}
          >
            {message}
          </div>
        )}
        {tab === "overview" && (
          <Overview
            config={config}
            health={health}
            pending={pending}
            cleared={cleared}
            payouts={payouts.length}
            paid={paid}
            reviews={reviews}
            competitions={competitions}
            setTab={setTab}
          />
        )}{" "}
        {tab === "live" && <Live config={config} competitions={competitions} leaderboard={leaderboard} reload={load} notificationStatus={notificationStatus} reviews={reviews} payouts={payouts} payoutDetails={payoutDetails} prepareReview={prepareReview} decideReview={decideReview} createPayout={createPayout} />} {" "}
        {tab === "reviews" && (
            <Reviews
            reviews={reviews}
            payouts={payouts}
            leaderboard={leaderboard}
            leaderboardArchive={leaderboardArchive}
            competitions={competitions}
            prepareReview={prepareReview}
            createPayout={createPayout}
            decideReview={decideReview}
            setTab={setTab}
          />
        )}{" "}
        {tab === "payouts" && (
          <Payouts
            payouts={payouts}
            payoutDetails={payoutDetails}
            reload={load}
          />
        )}{" "}
        {tab === "players" && <Players players={players} />}{" "}
        {tab === "fraud" && (
          <Fraud reviews={reviews} decideReview={decideReview} />
        )}{" "}
        {tab === "content" && <ContentHub releases={releases} releasesError={releasesError} reload={load} />}{" "}
        {tab === "notifications" && <Notifications audit={audit} competitions={competitions} notificationStatus={notificationStatus} />} {" "}
        {tab === "support" && (
          <Support requests={requests} cases={supportCases} reload={load} />
        )}{" "}
        {tab === "analytics" && (
          <Analytics
            players={players}
            reviews={reviews}
            payouts={payouts}
            analytics={analytics}
          />
        )}{" "}
        {tab === "health" && <Health config={config} health={health} reload={load} />}{" "}
        {tab === "settings" && <Settings />}{" "}
        {tab === "audit" && <Audit audit={audit} />}
      </section>
    </main>
  );
}
function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div style={card}>
      <div
        style={{
          color: "#918894",
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 900,
          color: accent ? "#f6b51b" : "#fff4d7",
          marginTop: 8,
        }}
      >
        {value}
      </div>
    </div>
  );
}
function Overview(p: any) {
  const now = Date.now();
  const liveCompetition = (p.competitions ?? []).find((item: any) => item.status === "open" && Number(item.start_at ?? 0) <= now && Number(item.end_at ?? 0) > now);
  const upcoming = (p.competitions ?? [])
    .filter((item: any) => (item.status === "scheduled" || item.status === "open") && Number(item.start_at ?? 0) > now)
    .sort((a: any, b: any) => Number(a.start_at) - Number(b.start_at))[0];
  const live = (p.competitions ?? []).filter((item: any) => item.status === "open" && Number(item.start_at ?? 0) <= now && Number(item.end_at ?? 0) > now).length;
  const reviewRounds = (p.competitions ?? []).filter((item: any) => {
    if (item.status !== "locked" && item.status !== "final") return false;
    const attempts = Number(item.attempt_count ?? 0);
    if (attempts < 1) return false;
    const competitionReviews = (p.reviews ?? []).filter((review: any) => review.competition_id === item.id);
    return competitionReviews.length < Math.min(attempts, 3) || competitionReviews.some((review: any) => review.status === "queued" || review.status === "in_review" || review.status === "disputed" || review.status === "escalated");
  }).length;
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 14,
        }}
      >
        <Stat
          label="Round status"
          value={liveCompetition ? "Live" : p.competitions?.some((item: any) => item.status === "scheduled") ? "Scheduled" : "Closed"}
          accent
        />
        <Stat label="Pending reviews" value={p.pending} />
        <Stat label="Cleared winners" value={p.cleared} />
        <Stat label="Payouts" value={`${p.paid}/${p.payouts}`} />
      </div>
      <section style={{ ...card, marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>What needs attention</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <button onClick={() => p.setTab("reviews")} style={{ ...card, textAlign: "left", color: "#fff4d7", cursor: "pointer" }}><b>{p.pending} winner reviews</b><p style={{ color: "#aaa0ad", marginBottom: 0 }}>{p.pending ? "Review finalist integrity before payout." : "No winner reviews are waiting."}</p></button>
          <button onClick={() => p.setTab("live")} style={{ ...card, textAlign: "left", color: "#fff4d7", cursor: "pointer" }}><b>{upcoming ? "Next: " + upcoming.title : "No upcoming round"}</b><p style={{ color: "#aaa0ad", marginBottom: 0 }}>{upcoming ? `Starts ${new Date(Number(upcoming.start_at)).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Create or schedule the next competition."}</p></button>
          <button onClick={() => p.setTab("live")} style={{ ...card, textAlign: "left", color: "#fff4d7", cursor: "pointer" }}><b>{live} live · {reviewRounds} rounds needing review</b><p style={{ color: "#aaa0ad", marginBottom: 0 }}>Only closed rounds with submitted attempts appear here. Archive unwanted test rounds from Live League.</p></button>
        </div>
      </section>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 18,
          marginTop: 18,
        }}
      >
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Today’s operating picture</h2>
          <p style={{ color: "#aaa0ad" }}>
            Review winners, issue secure payout forms, and monitor the League
            from one place.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginTop: 22,
            }}
          >
            <div
              style={{ background: "#211c25", padding: 16, borderRadius: 12 }}
            >
              <b>Winner review</b>
              <p style={{ color: "#aaa0ad" }}>
                {p.pending} entries need attention.
              </p>
              <button
                onClick={() => p.setTab("reviews")}
                style={{
                  color: "#f6b51b",
                  background: "none",
                  border: 0,
                  padding: 0,
                  fontWeight: 800,
                }}
              >
                Open queue →
              </button>
            </div>
            <div
              style={{ background: "#211c25", padding: 16, borderRadius: 12 }}
            >
              <b>Payout operations</b>
              <p style={{ color: "#aaa0ad" }}>
                {p.payouts} payout records in this round.
              </p>
              <button
                onClick={() => p.setTab("payouts")}
                style={{
                  color: "#f6b51b",
                  background: "none",
                  border: 0,
                  padding: 0,
                  fontWeight: 800,
                }}
              >
                View payouts →
              </button>
            </div>
          </div>
        </section>
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>System status</h2>
          {[
            ["API", "database"],
            ["Apple admin login", "apple_admin"],
            ["Payout vault", "payout_vault"],
            ["Notifications", "notifications"],
          ].map(([label, key]) => {
            const check = p.health?.checks?.[key];
            const good = check?.status === "operational";
            return (
              <p key={key}>
                ● {label}{" "}
                <span
                  style={{
                    color: good
                      ? "#6ee7a1"
                      : check?.status === "degraded"
                        ? "#ffd76b"
                        : "#ff9c8b",
                  }}
                >
                  {check?.status ?? "Not checked"}
                </span>
              </p>
            );
          })}
        </section>
      </div>
    </>
  );
}
async function editAdminCompetition(c: any) {
  const title = window.prompt("Competition title:", c.title ?? c.slug);
  if (title === null) return;
  const status = window.prompt(
    "Status (draft, scheduled, open, locked, final, cancelled):",
    c.status ?? "draft",
  );
  if (status === null) return;
  const questionCount = window.prompt(
    "Question count:",
    String(c.question_count ?? 12),
  );
  if (questionCount === null) return;
  const packVersion = window.prompt(
    "Question-pack version (locked after first attempt):",
    c.pack_version ?? "",
  );
  if (packVersion === null) return;
  const prize1 = window.prompt(
    "1st-place prize (minor NGN units, e.g. 5000000):",
    "5000000",
  );
  if (prize1 === null) return;
  const prize2 = window.prompt("2nd-place prize (minor NGN units):", "3000000");
  if (prize2 === null) return;
  const prize3 = window.prompt("3rd-place prize (minor NGN units):", "2000000");
  if (prize3 === null) return;
  const startAt = window.prompt(
    "Opening time (ISO UTC, blank keeps current):",
    c.start_at ? new Date(c.start_at).toISOString() : "",
  );
  if (startAt === null) return;
  const endAt = window.prompt(
    "Closing time (ISO UTC, blank keeps current):",
    c.end_at ? new Date(c.end_at).toISOString() : "",
  );
  if (endAt === null) return;
  const reason = window.prompt("Reason for this competition change:");
  if (!reason?.trim()) return;
  if (
    !window.confirm(
      "Save this competition change and record it in the audit log?",
    )
  )
    return;
  const r = await fetch(
    `/api/v1/admin/competitions/${encodeURIComponent(c.id)}`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        status,
        question_count: Number(questionCount),
        pack_version: packVersion,
        prize_1_minor: Number(prize1),
        prize_2_minor: Number(prize2),
        prize_3_minor: Number(prize3),
        start_at: startAt || undefined,
        end_at: endAt || undefined,
        reason,
      }),
    },
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    window.alert(data?.error?.message ?? "Competition update failed");
    return;
  }
  window.alert("Competition updated.");
  location.reload();
}
async function createAdminCompetition() {
  const title = window.prompt("Competition title:");
  if (!title?.trim()) return;
  const slug = window.prompt(
    "Slug (lowercase letters, numbers, hyphens):",
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  );
  if (!slug?.trim()) return;
  const startAt = window.prompt(
    "Opening time (ISO UTC):",
    new Date(Date.now() + 3600000).toISOString(),
  );
  if (!startAt) return;
  const endAt = window.prompt(
    "Closing time (ISO UTC):",
    new Date(Date.now() + 86400000).toISOString(),
  );
  if (!endAt) return;
  const questionCount = window.prompt("Question count:", "12");
  if (questionCount === null) return;
  const reason = window.prompt("Reason for creating this competition:");
  if (!reason?.trim() || !window.confirm("Create this as a draft competition?"))
    return;
  const r = await fetch("/api/v1/admin/competitions", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      slug,
      start_at: startAt,
      end_at: endAt,
      question_count: Number(questionCount),
      reason,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    window.alert(data?.error?.message ?? "Competition creation failed");
    return;
  }
  window.alert("Draft competition created.");
  location.reload();
}
function Leaderboard({ data, title = "Live leaderboard" }: any) {
  const rows = data?.leaderboard ?? [];
  return <div style={{ ...card, marginTop: 18 }}><div style={{ display: "flex", justifyContent: "space-between" }}><h2 style={{ marginTop: 0 }}>{title}</h2><span style={{ color: "#6ee7a1" }}>{data?.closed ? "Closed" : "Live"}</span></div><p style={{ color: "#aaa0ad" }}>Authoritative server ranking · {rows.length} submitted attempts</p>{rows.length === 0 ? <p style={{ color: "#aaa0ad" }}>No submitted attempts yet.</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}><thead><tr>{["Rank","Player","Score","Time","Integrity","Review"].map((x) => <th key={x} style={{ textAlign: "left", padding: 9, color: "#aaa0ad", fontSize: 12 }}>{x}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((r: any) => <tr key={r.attemptId}><td style={{ padding: 9 }}>{r.rank}</td><td style={{ padding: 9, fontWeight: 700 }}>{r.publicHandle}</td><td style={{ padding: 9 }}>{r.correctCount}</td><td style={{ padding: 9 }}>{Math.round((r.adjustedTotalMs ?? 0) / 1000)}s</td><td style={{ padding: 9 }}>{r.integrity_status ?? "pending"}</td><td style={{ padding: 9 }}>{r.review_status ?? "not queued"}</td></tr>)}</tbody></table></div>}</div>;
}
function CompetitionEditor({ competition, onClose, onSaved }: any) {
  const [form, setForm] = useState(() => ({ title: competition.title ?? "", status: competition.status ?? "draft", question_count: String(competition.question_count ?? 12), pack_version: competition.pack_version ?? "", start_at: competition.start_at ? localDateTime(competition.start_at) : "", end_at: competition.end_at ? localDateTime(competition.end_at) : "", prize_1_minor: competition.prize_1_minor == null ? "" : String(Number(competition.prize_1_minor) / 100), prize_2_minor: competition.prize_2_minor == null ? "" : String(Number(competition.prize_2_minor) / 100), prize_3_minor: competition.prize_3_minor == null ? "" : String(Number(competition.prize_3_minor) / 100), reason: "" }));
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  async function save(e: React.FormEvent) { e.preventDefault(); setError(""); if (!form.reason.trim()) { setError("Add an audit reason before saving."); return; } if (!form.start_at || !form.end_at || new Date(form.end_at) <= new Date(form.start_at)) { setError("Closing time must be after opening time."); return; } const prizeValues = [form.prize_1_minor, form.prize_2_minor, form.prize_3_minor]; if (prizeValues.some((value) => !/^\d+$/.test(value) || Number(value) <= 0)) { setError("Enter positive prize amounts for all three places, in naira (NGN)."); return; } setBusy(true); try { const body = { ...form, question_count: Number(form.question_count), prize_1_minor: Math.round(Number(form.prize_1_minor) * 100), prize_2_minor: Math.round(Number(form.prize_2_minor) * 100), prize_3_minor: Math.round(Number(form.prize_3_minor) * 100), start_at: new Date(form.start_at).toISOString(), end_at: new Date(form.end_at).toISOString() }; const path = `/api/v1/admin/competitions/${encodeURIComponent(competition.id)}`; let response = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); let data = await response.json().catch(() => ({})); if (!response.ok && response.status === 409 && data?.error?.details?.can_replace && window.confirm(`${data.error.message}\n\nReplace the scheduled round with this one? The scheduled round will be cancelled and kept in the audit history.`)) { response = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, replace_existing: true }) }); data = await response.json().catch(() => ({})); } if (!response.ok) throw new Error(data?.error?.message ?? "Competition update failed"); onSaved?.(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Competition update failed"); } finally { setBusy(false); } }
  const input = { display: "block", width: "100%", boxSizing: "border-box" as const, marginTop: 5, padding: 10, background: "#0f0d12", color: "#fff4d7", border: "1px solid #453b4c", borderRadius: 8 };
  return <div style={{ ...card, marginTop: 14, borderColor: "#f6b51b" }}><div style={{ display: "flex", justifyContent: "space-between" }}><div><h2 style={{ margin: 0 }}>Edit existing round</h2><p style={{ color: "#aaa0ad", margin: "5px 0 0" }}>This edits an existing record only. To create a new session, close this panel and use <strong>Start Odogwu League</strong>. Saving here never creates another round.</p></div><button type="button" onClick={onClose} style={{ background: "#403944", color: "#fff4d7", border: 0, borderRadius: 8, padding: "7px 10px" }}>Close</button></div><form onSubmit={save}><div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginTop: 16 }}><label>Round name<input style={input} value={form.title} onChange={(e) => update("title", e.target.value)} /></label><label>Lifecycle status<select style={input} value={form.status} onChange={(e) => update("status", e.target.value)}><option value="draft">Draft — not visible</option><option value="scheduled">Scheduled — published, not open</option><option value="open">Open — players can enter</option><option value="locked">Locked — entries closed</option><option value="final">Final — review complete</option><option value="cancelled">Cancelled</option></select></label><label>Questions<input style={input} type="number" min="1" max="100" value={form.question_count} onChange={(e) => update("question_count", e.target.value)} /></label><label>Question-pack version<input style={input} value={form.pack_version} onChange={(e) => update("pack_version", e.target.value)} /></label><label>Opens at<input style={input} type="datetime-local" value={form.start_at} onChange={(e) => update("start_at", e.target.value)} /></label><label>Closes at<input style={input} type="datetime-local" value={form.end_at} onChange={(e) => update("end_at", e.target.value)} /></label><label>1st prize (NGN)<input style={input} type="number" value={form.prize_1_minor} onChange={(e) => update("prize_1_minor", e.target.value)} /></label><label>2nd prize (NGN)<input style={input} type="number" value={form.prize_2_minor} onChange={(e) => update("prize_2_minor", e.target.value)} /></label><label>3rd prize (NGN)<input style={input} type="number" value={form.prize_3_minor} onChange={(e) => update("prize_3_minor", e.target.value)} /></label><label style={{ gridColumn: "1 / -1" }}>Audit reason<input style={input} value={form.reason} onChange={(e) => update("reason", e.target.value)} placeholder="Why are you changing this round?" /></label></div>{error && <p style={{ color: "#ff9c8b" }}>{error}</p>}<button disabled={busy} type="submit" style={{ marginTop: 16, background: "#f6b51b", border: 0, borderRadius: 9, padding: "11px 15px", fontWeight: 800 }}>{busy ? "Saving…" : "Save round changes"}</button></form></div>;
}
function NewCompetitionEditor({ onClose, onSaved, onNotice }: any) {
  const [form, setForm] = useState({ title: "Odogwu League — Live Session", slug: "", question_count: "12", pack_version: "", prize_1_minor: "50000", prize_2_minor: "30000", prize_3_minor: "20000", start_at: localDateTime(Date.now() + 60000), end_at: localDateTime(Date.now() + 3600000), cash_enabled: true, notification_message: "", reason: "" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const input = { display: "block", width: "100%", boxSizing: "border-box" as const, marginTop: 5, padding: 10, background: "#0f0d12", color: "#fff4d7", border: "1px solid #453b4c", borderRadius: 8 };
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (!form.title.trim()) { setError("Add a round name."); return; }
    if (!form.reason.trim()) { setError("Add an audit reason before launching."); return; }
    if (new Date(form.end_at) <= new Date(form.start_at)) { setError("Closing time must be after opening time."); return; }
    const prizes = [form.prize_1_minor, form.prize_2_minor, form.prize_3_minor];
    if (prizes.some((value) => !/^\d+$/.test(value) || Number(value) <= 0)) { setError("Enter a positive prize amount for all three places."); return; }
    if (!window.confirm(`Launch “${form.title}” now? This opens entries and makes the round visible to players.`)) return;
    setBusy(true);
    try {
      async function post(path: string, body: any) { const r = await fetch(path, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.error?.message ?? `${path} failed`); return d; }
      const common = { reason: form.reason, title: form.title, slug: form.slug.trim() || `odogwu-league-${crypto.randomUUID()}`, question_count: Number(form.question_count), ...(form.pack_version.trim() ? { pack_version: form.pack_version.trim() } : {}), start_at: new Date(form.start_at).toISOString(), end_at: new Date(form.end_at).toISOString(), prize_1_minor: Number(form.prize_1_minor), prize_2_minor: Number(form.prize_2_minor), prize_3_minor: Number(form.prize_3_minor) };
      const proposedStart = Date.parse(common.start_at);
      const proposedEnd = Date.parse(common.end_at);
      const existing = await get("/api/v1/admin/competitions");
      const conflict = (existing.competitions ?? []).find((item: any) => {
        if (!["open", "scheduled"].includes(item.status) || item.id === common.slug) return false;
        const start = Number(item.start_at ?? 0);
        const end = Number(item.end_at ?? 0);
        return Number.isFinite(start) && Number.isFinite(end) && start < proposedEnd && end > proposedStart;
      });
      let replaceExisting = false;
      if (conflict) {
        if (conflict.status !== "scheduled") throw new Error(`This session overlaps the live round “${conflict.title}”. Stop it first or choose a different time.`);
        replaceExisting = window.confirm(`This session overlaps the scheduled round “${conflict.title}”. Replace that scheduled round? It will be cancelled and retained in the audit history.`);
        if (!replaceExisting) return;
      }
      // Check the banner window before provisioning anything so a rejected
      // launch cannot leave a draft round behind.
      const latest = await get("/api/v1/app-config");
      const scheduledBannerEnd = latest.events?.odogwu_league?.banner_ends_at ? Date.parse(latest.events.odogwu_league.banner_ends_at) : NaN;
      if (Number.isFinite(scheduledBannerEnd) && proposedStart >= scheduledBannerEnd) {
        throw new Error("This session starts after the banner’s scheduled hide time. Clear or move ‘Hide banner at’ before launching.");
      }
      // Odogwu rounds must be provisioned from the reviewed private pack.
      // A generic draft has no competition cards and is intentionally refused
      // by the player API, even if its banner/config is published.
      const created = await post("/api/v1/admin/competitions/one-day-simulation", { title: common.title, slug: common.slug, starts_at: common.start_at, ends_at: common.end_at, reason: common.reason });
      const startsNow = Date.parse(form.start_at) <= Date.now();
      const next = { ...latest, revision: Math.max(Number(latest.revision ?? 0) + 1, Date.now()), published_at: new Date().toISOString(), events: { ...latest.events, odogwu_league: { ...(latest.events?.odogwu_league ?? {}), headline: form.title, mode: form.cash_enabled ? "cash_ready" : "practice", starts_at: new Date(form.start_at).toISOString(), ends_at: new Date(form.end_at).toISOString(), visible_from: new Date(form.start_at).toISOString(), enabled: true, entry_enabled: true, home_placement: "banner", cash_enabled: form.cash_enabled } } };
      await post("/api/v1/admin/app-config/draft", { config: next, reason: form.reason });
      await post("/api/v1/admin/app-config/review", { revision: next.revision, reason: form.reason });
      await post("/api/v1/admin/app-config/publish", { revision: next.revision, reason: form.reason });
      let updateBody = { ...common, status: startsNow ? "open" : "scheduled", ...(replaceExisting ? { replace_existing: true } : {}) };
      try {
        await post(`/api/v1/admin/competitions/${encodeURIComponent(created.competition.id)}`, updateBody);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Competition update failed";
        if (!replaceExisting && message.includes("overlaps") && window.confirm(`${message}\n\nReplace the scheduled round? It will be cancelled and retained in the audit history.`)) {
          updateBody = { ...updateBody, replace_existing: true };
          await post(`/api/v1/admin/competitions/${encodeURIComponent(created.competition.id)}`, updateBody);
        } else throw error;
      }
      const notificationEvent = Date.parse(form.start_at) <= Date.now() ? "started" : "starts_soon";
      try {
        const notification = await post("/api/v1/admin/notifications/league-broadcast", { event: notificationEvent, competition_id: created.competition.id, ...(form.notification_message.trim() ? { body: form.notification_message.trim(), title: form.title } : {}) });
        const result = notification.notification ?? {};
        onNotice?.(`${notificationEvent === "started" ? "Session started" : "Session scheduled"}. Notification delivery: ${result.sent ?? 0} sent, ${result.failed ?? 0} failed, ${result.eligible ?? 0} eligible.`);
      } catch (notificationError) {
        onNotice?.(`Session launched successfully, but the automatic player notification could not be sent: ${notificationError instanceof Error ? notificationError.message : "notification service unavailable"}`);
      }
      onSaved?.(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Launch failed. Check Live League for the round state before retrying."); } finally { setBusy(false); }
  }
  return <section style={{ marginTop: 20, padding: "24px 0 30px", borderBottom: "1px solid #352d3c" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
      <div><h2 style={{ margin: 0 }}>Set up your round</h2><p style={{ color: "#aaa0ad", marginTop: 8 }}>Choose the time and prizes. We’ll handle the setup.</p></div>
      <button type="button" onClick={onClose} style={{ background: "none", color: "#fff4d7", border: "1px solid #453b4c", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Cancel</button>
    </div>
    <form onSubmit={save}>
      <label style={{ display: "block", marginBottom: 18 }}>Round name<input required style={input} value={form.title} onChange={(e) => update("title", e.target.value)} /></label>
      <div className="league-setup-grid">
        <label>Starts at<input required style={input} type="datetime-local" value={form.start_at} onChange={(e) => update("start_at", e.target.value)} /></label>
        <label>Ends at<input required style={input} type="datetime-local" value={form.end_at} onChange={(e) => update("end_at", e.target.value)} /></label>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, margin: "24px 0 14px" }}>
        <h3 style={{ margin: 0 }}>Prizes · NGN</h3>
        <label style={{ display: "flex", alignItems: "center" }}><input className="league-switch" role="switch" type="checkbox" checked={form.cash_enabled} onChange={(e) => setForm((current) => ({ ...current, cash_enabled: e.target.checked }))} />Cash prizes</label>
      </div>
      {form.cash_enabled ? <div className="league-prize-grid">
        {(["1", "2", "3"] as const).map((place, index) => {
          const key = `prize_${place}_minor` as "prize_1_minor" | "prize_2_minor" | "prize_3_minor";
          return <label key={place}>{["1st", "2nd", "3rd"][index]} place<input required min="1" step="1" style={input} type="number" value={Number(form[key]) / 100} onChange={(e) => update(key, String(Math.round(Number(e.target.value) * 100)))} /></label>;
        })}
      </div> : <p style={{ color: "#aaa0ad" }}>Practice round · no cash prizes.</p>}
      <label style={{ display: "block", marginTop: 22 }}>Announcement <span style={{ color: "#aaa0ad" }}>(optional)</span><textarea maxLength={240} rows={2} style={{ ...input, resize: "vertical" }} value={form.notification_message} onChange={(e) => update("notification_message", e.target.value)} placeholder="Add a message, or use the standard round announcement." /></label>
      <label style={{ display: "block", marginTop: 18 }}>Audit note<input required style={input} value={form.reason} onChange={(e) => update("reason", e.target.value)} placeholder="e.g. Evening League test" /></label>
      <details style={{ marginTop: 20, color: "#aaa0ad" }}>
        <summary style={{ cursor: "pointer" }}>Advanced settings</summary>
        <div className="league-setup-grid" style={{ marginTop: 14 }}>
          <label>Questions<input style={input} type="number" min="1" max="100" value={form.question_count} onChange={(e) => update("question_count", e.target.value)} /></label>
          <label>Session ID<input style={input} value={form.slug} onChange={(e) => update("slug", e.target.value)} placeholder="Automatically generated" /></label>
          <label>Pack version<input style={input} value={form.pack_version} onChange={(e) => update("pack_version", e.target.value)} placeholder="Use the reviewed pack version" /></label>
        </div>
      </details>
      {error && <p role="alert" style={{ color: "#ff9c8b" }}>{error}</p>}
      <button disabled={busy} type="submit" style={{ marginTop: 24, background: "#f6b51b", border: 0, borderRadius: 9, padding: "12px 20px", fontWeight: 800, cursor: "pointer" }}>{busy ? "Setting up…" : "Create round"}</button>
    </form>
  </section>;
}
function Live({ config, competitions = [], leaderboard, reload, notificationStatus = null, reviews = [], payouts = [], payoutDetails = [], prepareReview, decideReview, createPayout }: any) {
  const [view, setView] = useState(() => {
    if (typeof window === "undefined") return "round";
    return new URLSearchParams(window.location.search).get("section") === "announcements" ? "announcements" : "round";
  });
  const [scheduleHide, setScheduleHide] = useState(false);
  const [showRoundTools, setShowRoundTools] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState("");
  const [selectedLeaderboard, setSelectedLeaderboard] = useState<any>(leaderboard);
  const [completedLeaderboard, setCompletedLeaderboard] = useState<any>(null);
  useEffect(() => {
    const completed = competitions.filter((item: any) => ["locked", "final"].includes(item.status) && Number(item.attempt_count) > 0).sort((a: any, b: any) => Number(b.end_at) - Number(a.end_at))[0];
    let cancelled = false;
    if (!completed) { setCompletedLeaderboard(null); return; }
    get(`/api/v1/admin/leaderboard?competition_id=${encodeURIComponent(completed.id)}`).then((data) => { if (!cancelled) setCompletedLeaderboard(data); }).catch(() => { if (!cancelled) setCompletedLeaderboard(null); });
    return () => { cancelled = true; };
  }, [competitions, leaderboard]);
  const [announcement, setAnnouncement] = useState("");
  const league =
    config?.events?.odogwu_league ?? config?.events?.odogwu_league ?? null;
  const [draft, setDraft] = useState<any>(league);
  useEffect(() => setDraft(league), [config]);
  useEffect(() => setScheduleHide(Boolean(league?.banner_ends_at)), [league?.banner_ends_at]);
  useEffect(() => {
    const live = competitions.find((item: any) => item.status === "open" && Number(item.start_at ?? 0) <= Date.now() && Number(item.end_at ?? 0) > Date.now());
    const upcoming = competitions.filter((item: any) => (item.status === "scheduled" || item.status === "open") && Number(item.start_at ?? 0) > Date.now()).sort((a: any, b: any) => Number(a.start_at) - Number(b.start_at))[0];
    const current = competitions.find((item: any) => item.id === selectedCompetitionId);
    const preferred = live?.id ?? upcoming?.id ?? competitions.find((item: any) => (item.status === "locked" || item.status === "final") && Number(item.attempt_count) > 0)?.id ?? competitions.find((item: any) => item.status === "draft")?.id ?? "";
    if (!current) setSelectedCompetitionId(preferred);
  }, [competitions, selectedCompetitionId]);
  useEffect(() => {
    if (!selectedCompetitionId) {
      setSelectedLeaderboard(null);
      return;
    }
    let cancelled = false;
    get(`/api/v1/admin/leaderboard?competition_id=${encodeURIComponent(selectedCompetitionId)}`)
      .then((data) => { if (!cancelled) setSelectedLeaderboard(data); })
      .catch(() => { if (!cancelled) setSelectedLeaderboard(null); });
    return () => { cancelled = true; };
  }, [leaderboard, selectedCompetitionId]);
  function change(key: string, value: any) {
    setDraft((x: any) => ({ ...x, [key]: value }));
  }
  async function stopCompetition(item: any) {
    const reason = window.prompt(`Stop “${item.title}” now? This closes entries and preserves its leaderboard. Enter an audit reason:`);
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/competitions/${encodeURIComponent(item.id)}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "locked", reason }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not stop competition");
      setDone(`Stopped “${item.title}”. Its leaderboard is preserved for review.`);
      await reload?.();
    } catch (error) { setDone(error instanceof Error ? error.message : "Could not stop competition"); } finally { setBusy(false); }
  }
  async function archiveCompetition(item: any) {
    const reason = window.prompt(`Archive “${item.title}”? It will leave the operating queue but remain in the historical record. Enter an audit reason:`);
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/competitions/${encodeURIComponent(item.id)}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "cancelled", reason }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not archive competition");
      await reload?.();
    } catch (error) { setDone(error instanceof Error ? error.message : "Could not archive competition"); } finally { setBusy(false); }
  }
  async function deleteDraft(item: any) {
      const reason = window.prompt(`Permanently delete “${item.title}”? This is allowed only because nobody has entered it. Enter an audit reason:`);
    if (!reason?.trim() || !window.confirm("Delete this competition permanently? It has no attempts or review history. This cannot be undone.")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/competitions/${encodeURIComponent(item.id)}`, { method: "DELETE", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not delete empty round");
      await reload?.();
    } catch (error) { setDone(error instanceof Error ? error.message : "Could not delete draft"); } finally { setBusy(false); }
  }
  async function save(leaderboardOnly = false) {
    if (!draft || !config) return;
    setDone("");
    const reason = window.prompt(
      "Reason for this League configuration change:",
    );
    if (!reason?.trim()) return;
    let latest: any;
    try {
      latest = await get("/api/v1/app-config");
    } catch (e) {
      setDone(e instanceof Error ? e.message : "Could not load the latest configuration.");
      return;
    }
    const next = {
      ...latest,
      revision: Math.max(
        Number(latest.revision ?? config.revision ?? 0) + 1,
        Date.now(),
      ),
      published_at: new Date().toISOString(),
      events: {
        ...latest.events,
        odogwu_league: {
          ...(leaderboardOnly ? latest.events.odogwu_league : draft),
          show_last_leaderboard: draft.show_last_leaderboard !== false,
          starts_at: leaderboardOnly ? latest.events.odogwu_league.starts_at : draft.starts_at || null,
          ends_at: leaderboardOnly ? latest.events.odogwu_league.ends_at : draft.ends_at || null,
          visible_from: leaderboardOnly ? latest.events.odogwu_league.visible_from : draft.visible_from || null,
          headline: leaderboardOnly ? latest.events.odogwu_league.headline : draft.headline || null,
          home_placement: leaderboardOnly ? latest.events.odogwu_league.home_placement : draft.enabled === true ? "banner" : "none",
        },
      },
    };
    if (
      !window.confirm("Create, review, and publish this League configuration?")
    )
      return;
    setBusy(true);
    try {
      async function post(path: string, body: any) {
        const r = await fetch(path, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error?.message ?? `${path} failed`);
        return d;
      }
      await post("/api/v1/admin/app-config/draft", { config: next, reason });
      await post("/api/v1/admin/app-config/review", {
        revision: next.revision,
        reason,
      });
      await post("/api/v1/admin/app-config/publish", {
        revision: next.revision,
        reason,
      });
      setDone(`Published League revision ${next.revision}. Live state is now updated.`);
    } catch (e) {
      setDone(e instanceof Error ? e.message : "Configuration publish failed");
    } finally {
      setBusy(false);
    }
  }
  async function sendAnnouncement() {
    const message = announcement.trim();
    if (!message) return;
    if (!window.confirm("Send this Odogwu League announcement to players who opted into League updates?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/v1/admin/notifications/league-broadcast", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: selectedIsLive ? "started" : "starts_soon", competition_id: selectedCompetitionId || undefined, title: draft?.headline || "Odogwu League", body: message }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message ?? "Announcement could not be sent");
      const result = data.notification ?? {};
      setDone(`Announcement sent: ${result.sent ?? 0} sent, ${result.failed ?? 0} failed, ${result.eligible ?? 0} eligible.`);
      // Retain the message so the owner can retry delivery after a failure.
    } catch (error) { setDone(error instanceof Error ? error.message : "Announcement could not be sent"); } finally { setBusy(false); }
  }
  async function disable() {
    if (
      !window.confirm(
        "Disable the published app configuration and close entries?",
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/v1/admin/app-config/disable", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Emergency control used from owner dashboard.",
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(data?.error?.message ?? "Emergency disable failed");
      setDone(
        "Safe defaults are active and the published configuration is disabled.",
      );
    } catch (e) {
      setDone(e instanceof Error ? e.message : "Emergency disable failed");
    } finally {
      setBusy(false);
    }
  }
  const input = {
    display: "block",
    width: "100%",
    boxSizing: "border-box" as const,
    marginTop: 6,
    padding: 11,
    background: "#0f0d12",
    color: "#fff4d7",
    border: "1px solid #453b4c",
    borderRadius: 9,
  };
  const now = Date.now();
  const pipeline = competitions
    .map((item: any) => {
      const start = Number(item.start_at ?? 0);
      const end = Number(item.end_at ?? 0);
      const phase = item.status === "open" && start <= now && end > now
        ? "live"
        : (item.status === "scheduled" || item.status === "open") && start > now && end > now
          ? "upcoming"
          : item.status === "locked" || item.status === "final"
            ? "review"
            : item.status;
      const action = phase === "live" ? "Monitor leaderboard" : phase === "upcoming" ? "Open schedule" : phase === "review" ? "Review finalists" : item.status === "draft" ? "Finish setup" : "Manage round";
      return { ...item, phase, action };
    })
    .filter((item: any) => ["live", "upcoming", "draft"].includes(item.phase))
    .sort((a: any, b: any) => Number(a.start_at ?? 0) - Number(b.start_at ?? 0));
  const reviewCount = competitions.filter((item: any) => item.status === "locked" || item.status === "final").length;
  const phaseLabel: Record<string, string> = { live: "LIVE NOW", upcoming: "UPCOMING", review: "NEEDS REVIEW", draft: "DRAFT" };
  const phaseColor: Record<string, string> = { live: "#6ee7a1", upcoming: "#f6b51b", review: "#ffb38a", draft: "#aaa0ad" };
  const formatTime = (value: any) => value ? new Date(Number(value)).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Time not set";
  const operationalRounds = competitions.filter((item: any) => item.status !== "cancelled");
  const selectedRound = competitions.find((item: any) => item.id === selectedCompetitionId);
  const selectedPhase = pipeline.find((item: any) => item.id === selectedCompetitionId)?.phase ?? selectedRound?.status ?? "unknown";
  const selectedIsLive = selectedPhase === "live";
  const selectedIsHistorical = selectedPhase === "review" || selectedRound?.status === "locked" || selectedRound?.status === "final";
  const hasOperationalSession = Boolean(selectedRound && ["live", "upcoming", "draft"].includes(selectedPhase));
  const activeRound = pipeline.find((item: any) => item.phase === "live") ?? pipeline.find((item: any) => item.phase === "upcoming");
  const lastRound = competitions.filter((item: any) => ["locked", "final"].includes(item.status) && Number(item.attempt_count) > 0).sort((a: any, b: any) => Number(b.end_at) - Number(a.end_at))[0];
  const actionStyle = { background: "#f6b51b", color: "#17131c", border: 0, borderRadius: 9, padding: "12px 18px", fontWeight: 800, cursor: "pointer" };
  const visibleLeaderboard = activeRound?.phase === "live" ? selectedLeaderboard : completedLeaderboard;
  return (
    <section className={`league-workspace league-view-${view}`} style={{ display: "flex", flexDirection: "column" }}>
      <style>{`
        .league-workspace h2 { font-family: Georgia, serif; font-size: 30px; }
        .league-setup-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; }
        .league-prize-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:18px; }
        @media(max-width:700px) { .league-setup-grid,.league-prize-grid {grid-template-columns:1fr;} }
        .league-tabs { display:flex; gap:28px; border-bottom:1px solid #352d3c; margin-bottom:30px; }
        .league-tabs button { background:none; border:0; border-bottom:3px solid transparent; padding:14px 0; color:#aaa0ad; font:inherit; font-weight:700; cursor:pointer; }
        .league-tabs button[aria-selected=true] { color:#f6b51b; border-bottom-color:#f6b51b; }
        .league-workspace input[type=checkbox] { accent-color:#28a765; width:18px; height:18px; vertical-align:middle; margin-right:8px; }
        .league-workspace input.league-switch { appearance:none; -webkit-appearance:none; width:48px; height:28px; border:1px solid #655a70; border-radius:20px; background:#403944; position:relative; margin:0 12px 0 0; cursor:pointer; flex-shrink:0; transition:background .15s; }
        .league-workspace input.league-switch::before { content:""; position:absolute; width:20px; height:20px; border-radius:50%; background:#fff5df; top:3px; left:3px; transition:transform .15s; }
        .league-workspace input.league-switch:checked { background:#149651; border-color:#149651; }
        .league-workspace input.league-switch:checked::before { transform:translateX(20px); }
        .league-workspace input.league-switch:focus-visible { outline:2px solid #f6b51b; outline-offset:4px; }
        .league-workspace button:focus-visible { outline:2px solid #f6b51b; outline-offset:4px; }
        .league-view-announcements .league-display-fields, .league-view-display .league-announcement-fields { display:none; }
        .league-session-hero { display:flex; justify-content:space-between; align-items:center; gap:24px; padding:18px 0 32px; border-bottom:1px solid #352d3c; }
        .league-utilities { display:flex; flex-wrap:wrap; gap:20px; border-top:1px solid #352d3c; padding:20px 0; margin-top:28px; color:#aaa0ad; }
        @media(max-width:700px) { .league-tabs {gap:18px;} .league-session-hero {align-items:flex-start;flex-direction:column;} .league-tabs button {font-size:14px;} }
      `}</style>
      <nav className="league-tabs" role="tablist" aria-label="League controls">
        {[["round", "Round"], ["display", "Player display"], ["announcements", "Announcements"]].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => { setView(id); setDone(""); }}>{label}</button>)}
      </nav>
      {view === "round" && <>
        <div className="league-session-hero">
          <div><small style={{ color: activeRound?.phase === "live" ? "#6ee7a1" : "#aaa0ad", letterSpacing: 1.5 }}>{activeRound ? phaseLabel[activeRound.phase] : "CURRENT ROUND"}</small><h2 style={{ margin: "10px 0", fontSize: 38 }}>{activeRound?.title ?? "No active round"}</h2><p style={{ margin: 0, color: "#aaa0ad" }}>{activeRound ? `${formatTime(activeRound.start_at)} → ${formatTime(activeRound.end_at)}` : "Ready when you are."}</p></div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><button style={actionStyle} onClick={() => activeRound ? setEditing(activeRound) : setCreating(true)}>{activeRound ? "Edit schedule" : "Schedule a round"}</button>{activeRound?.phase === "live" && <button style={{ ...actionStyle, background: "#713b40", color: "white" }} onClick={() => stopCompetition(activeRound)}>Stop round</button>}</div>
        </div>
        {creating && <NewCompetitionEditor onClose={() => setCreating(false)} onSaved={reload} onNotice={setDone} />}
        {editing && <CompetitionEditor competition={editing} onClose={() => setEditing(null)} onSaved={reload} />}
        <div style={{ paddingTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><h2>{activeRound?.phase === "live" ? "Live table" : "Last completed round"}</h2>{lastRound && <button style={{ background: "none", border: 0, color: "#f6b51b", fontWeight: 800, cursor: "pointer" }} onClick={() => { setSelectedCompetitionId(lastRound.id); setShowRoundTools(true); }}>Review & payouts</button>}</div>
          {lastRound && !activeRound && <p style={{ color: "#aaa0ad" }}>{lastRound.title} · {formatTime(lastRound.end_at)} · {lastRound.attempt_count} players</p>}
          {visibleLeaderboard?.leaderboard?.length ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", marginTop: 22, textAlign: "left" }}><thead><tr>{["Rank", "Player", "Score", "Time"].map((label) => <th key={label} style={{ padding: "12px 8px", color: "#aaa0ad", fontSize: 12, borderBottom: "1px solid #352d3c", fontWeight: 600 }}>{label}</th>)}</tr></thead><tbody>{visibleLeaderboard.leaderboard.slice(0, 10).map((entry: any) => <tr key={entry.attemptId}><td style={{ padding: "16px 8px", borderBottom: "1px solid #352d3c", color: "#f6b51b" }}>{entry.rank}</td><td style={{ padding: "16px 8px", borderBottom: "1px solid #352d3c", fontWeight: 700 }}>{entry.publicHandle}</td><td style={{ padding: "16px 8px", borderBottom: "1px solid #352d3c" }}>{entry.correctCount}</td><td style={{ padding: "16px 8px", borderBottom: "1px solid #352d3c", color: "#aaa0ad" }}>{Math.round(Number(entry.adjustedTotalMs) / 1000)}s</td></tr>)}</tbody></table></div> : <p style={{ color: "#aaa0ad" }}>No submitted rounds yet.</p>}
        </div>
      </>}
      {view !== "round" && <div style={{ maxWidth: 720, padding: "4px 0 24px" }}>
        <div className="league-display-fields">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
          <div><h2 style={{ margin: 0 }}>What players see</h2><p style={{ color: "#aaa0ad", margin: "8px 0 20px", fontSize: 14 }}>Your banner stays visible until you turn it off.</p></div>
          <strong style={{ color: draft?.enabled ? "#6ee7a1" : "#aaa0ad" }}>{draft?.enabled ? "VISIBLE" : "HIDDEN"}</strong>
        </div>
        <label style={{ display: "flex", alignItems: "center", marginTop: 20, fontWeight: 700 }}><input className="league-switch" role="switch" type="checkbox" checked={draft?.enabled === true && draft?.home_placement === "banner"} onChange={(e) => { const enabled = e.target.checked; change("enabled", enabled); change("home_placement", enabled ? "banner" : "none"); }} /> Show Odogwu League banner</label>
        <label style={{ display: "flex", alignItems: "center", marginTop: 24, fontWeight: 700 }}><input className="league-switch" role="switch" type="checkbox" checked={draft?.show_last_leaderboard !== false} onChange={(e) => change("show_last_leaderboard", e.target.checked)} /> Show last leaderboard</label>
        <small style={{ color: "#aaa0ad" }}>Show the completed round’s standings to players.</small>
        <button type="button" onClick={() => save(true)} disabled={busy || !draft} style={{ display: "block", marginTop: 8, background: "#403944", color: "#fff4d7", border: 0, borderRadius: 8, padding: "9px 12px", fontWeight: 800 }}>Save leaderboard settings</button>
        <label style={{ display: "block", marginTop: 12 }}>Banner text<input value={draft?.headline ?? ""} onChange={(e) => change("headline", e.target.value)} style={input} placeholder="Odogwu League is live" /></label>
        <label style={{ display: "block", marginTop: 20 }}><input type="checkbox" checked={scheduleHide} onChange={(e) => { setScheduleHide(e.target.checked); if (!e.target.checked) change("banner_ends_at", null); }} />Schedule automatic hide</label>
        {scheduleHide && <label style={{ display: "block", marginTop: 12 }}>Hide at (your local time)<input name="odogwu-banner-hide-at" type="datetime-local" value={draft?.banner_ends_at ? localDateTime(draft.banner_ends_at) : ""} onChange={(e) => change("banner_ends_at", e.target.value ? new Date(e.target.value).toISOString() : null)} style={input} /></label>}
        <button onClick={() => save(false)} disabled={busy || !draft || (scheduleHide && !draft?.banner_ends_at)} style={{ ...actionStyle, marginTop: 20 }}>Save banner</button>
        </div>
        <div className="league-announcement-fields">
        <h2 style={{ marginTop: 0 }}>Send an announcement</h2><p style={{ color: "#aaa0ad" }}>A custom message for players with League updates on.</p>
        <label style={{ display: "block", marginTop: 12 }}>Notification message<textarea value={announcement} onChange={(e) => setAnnouncement(e.target.value)} maxLength={240} rows={2} style={{ ...input, resize: "vertical" }} placeholder="Odogwu League don open — enter now." /></label>
        <div style={{ marginTop: 12 }}>
          <div style={{ color: "#d6ccd9", fontSize: 12, marginTop: 3 }}>{notificationStatus ? `${notificationStatus.eligible_devices} device${notificationStatus.eligible_devices === 1 ? "" : "s"} across ${notificationStatus.eligible_players} player${notificationStatus.eligible_players === 1 ? "" : "s"}.` : "Checking notification readiness…"}</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16 }}><button onClick={sendAnnouncement} disabled={busy || !announcement.trim()} style={actionStyle}>Send announcement</button><small style={{ color: "#918894" }}>{announcement.length}/240</small></div>
        </div>
      </div>}
      {view === "round" && showRoundTools && <div style={{ order: 7, marginTop: 28 }}>
      <div
        style={{
          background: "#211c25",
          padding: 18,
          borderRadius: 12,
          marginBottom: 18,
          order: 1,
        }}
      >
        <b>{selectedIsHistorical ? "Historical round selected" : selectedIsLive ? "Active session" : "Session to operate"}</b>
        <label style={{ display: "block", marginTop: 8, color: "#aaa0ad" }}>
          Round to operate
          <select value={selectedCompetitionId} onChange={(e) => setSelectedCompetitionId(e.target.value)} style={input} disabled={!operationalRounds.length}>
            {!operationalRounds.length && <option value="">No active or scheduled session</option>}
            {operationalRounds.map((item: any) => <option key={item.id} value={item.id}>{item.title} · {item.status}</option>)}
          </select>
        </label>
        {!hasOperationalSession ? <div style={{ marginTop: 14, padding: 14, borderRadius: 10, background: "#211c25", border: "1px solid #453b4c" }}><strong>No active session</strong><p style={{ color: "#aaa0ad", fontSize: 13, margin: "6px 0 0" }}>There is no open or scheduled Odogwu League session. Start a new session below when you are ready.</p></div> : <><p style={{ color: "#aaa0ad", marginBottom: 4 }}>{selectedRound?.title}</p><small style={{ color: "#746b79" }}>ID: {selectedCompetitionId}</small><strong style={{ display: "block", marginTop: 6, color: league?.entry_enabled && selectedIsLive ? "#6ee7a1" : "#ffd76b" }}>{selectedIsLive && league?.entry_enabled ? "Entries open" : selectedIsLive ? "Entries closed" : selectedRound?.status === "scheduled" ? "Scheduled" : "Draft setup"}</strong><p style={{ color: "#aaa0ad", fontSize: 13, marginBottom: 0 }}>{selectedIsLive ? "Monitor the live leaderboard here. Use Emergency disable entries if you need to stop access immediately." : "Finish setup here, then open the session when you are ready."}</p>{selectedRound?.status === "scheduled" && <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}><button onClick={() => setEditing(selectedRound)} disabled={busy} style={{ background: "#403944", color: "#fff4d7", border: 0, borderRadius: 8, padding: "8px 11px", fontWeight: 800 }}>Edit scheduled round</button><button onClick={() => deleteDraft(selectedRound)} disabled={busy} style={{ background: "#713b40", color: "#fff", border: 0, borderRadius: 8, padding: "8px 11px", fontWeight: 800 }}>Delete scheduled round</button></div>}</>}
      </div>
      {hasOperationalSession && <div style={{ order: 2 }}><Leaderboard data={selectedLeaderboard} /></div>}
      {hasOperationalSession && <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2,1fr)",
          gap: 12,
          maxWidth: 760,
          order: 3,
        }}
      >
        <label>
          Mode
          <select
            value={draft?.mode ?? "practice"}
            onChange={(e) => change("mode", e.target.value)}
            style={input}
          >
            <option value="practice">Practice</option>
            <option value="cash_ready">Cash ready</option>
          </select>
        </label>
        <label>
          Starts at (your local time)
          <input
            type="datetime-local"
            value={draft?.starts_at ? localDateTime(draft.starts_at) : ""}
            disabled
            onChange={(e) =>
              change(
                "starts_at",
                e.target.value ? new Date(e.target.value).toISOString() : null,
              )
            }
            style={input}
          />
        </label>
        <label>
          Ends at (your local time)
          <input
            type="datetime-local"
            value={draft?.ends_at ? localDateTime(draft.ends_at) : ""}
            disabled
            onChange={(e) =>
              change(
                "ends_at",
                e.target.value ? new Date(e.target.value).toISOString() : null,
              )
            }
            style={input}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft?.entry_enabled === true}
            onChange={(e) => change("entry_enabled", e.target.checked)}
          />{" "}
          Entries enabled
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft?.cash_enabled === true}
            onChange={(e) => change("cash_enabled", e.target.checked)}
          />{" "}
          Cash enabled
        </label>
      </div>}
      {hasOperationalSession && <div
        style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap", order: 5 }}
      >
        <button
          onClick={() => save(false)}
          disabled={busy || !draft}
          style={{
            background: "#f6b51b",
            border: 0,
            borderRadius: 10,
            padding: "12px 16px",
            fontWeight: 800,
          }}
        >
          {busy ? "Publishing…" : "Save and publish League config"}
        </button>
        <button
          onClick={disable}
          disabled={busy || !league?.entry_enabled}
          style={{
            background: "#713b40",
            color: "#fff",
            border: 0,
            borderRadius: 10,
            padding: "12px 16px",
            fontWeight: 800,
          }}
        >
          {busy ? "Working…" : "Emergency disable entries"}
        </button>
      </div>}
      {done && <p style={{ color: "#ffd76b", order: 6 }}>{done}</p>}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 28,
          order: 0,
        }}
      >
        <h3 style={{ margin: 0 }}>Rounds & history</h3>
        <button
          onClick={() => setCreating(true)}
          style={{
            background: "#f6b51b",
            border: 0,
            borderRadius: 8,
            padding: "8px 11px",
            fontWeight: 800,
          }}
        >
          Start Odogwu League
        </button>
      </div>
      <div style={{ order: 8 }}>
      {competitions.length === 0 ? (
        <p style={{ color: "#aaa0ad" }}>No competitions returned.</p>
      ) : (
        competitions.slice(0, 8).map((c: any) => (
          <div
            key={c.id}
            style={{
              background: "#211c25",
              padding: 12,
              borderRadius: 10,
              marginTop: 8,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>
              <b>{c.title ?? c.slug}</b>
              <small style={{ display: "block", color: "#aaa0ad" }}>
                {c.status} · {c.attempt_count} attempts · {c.review_count}{" "}
                reviews
              </small>
            </span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <span style={{ color: c.status === "open" ? "#6ee7a1" : c.status === "cancelled" ? "#918894" : "#ffd76b", fontSize: 12, fontWeight: 800 }}>Lifecycle: {c.status}</span>
                <span style={{ color: c.content_status === "published" ? "#6ee7a1" : "#ffd76b", fontSize: 12, fontWeight: 800 }}>Content: {c.content_status}</span>
              </span>
              {Number(c.attempt_count ?? 0) === 0 && Number(c.review_count ?? 0) === 0 && <button onClick={() => deleteDraft(c)} disabled={busy} style={{ background: "#713b40", color: "#fff", border: 0, borderRadius: 7, padding: "6px 9px", fontWeight: 700 }}>Delete empty round</button>}
              {c.status !== "draft" && c.status !== "cancelled" && <button onClick={() => archiveCompetition(c)} disabled={busy} style={{ background: "#403944", color: "#fff4d7", border: 0, borderRadius: 7, padding: "6px 9px", fontWeight: 700 }}>Archive</button>}
              <button
                onClick={() => setEditing(c)}
                style={{
                  background: "#403944",
                  color: "#fff4d7",
                  border: 0,
                  borderRadius: 7,
                  padding: "6px 9px",
                  fontWeight: 700,
                }}
              >
                Edit details
              </button>
            </span>
          </div>
        ))
      )}
      </div>
      </div>}
      {view === "round" && showRoundTools && selectedIsHistorical && selectedRound && <div style={{ order: 5 }}>
        <h2>Finish this round</h2>
        <p style={{ color: "#aaa0ad" }}>Review the finalists, collect their details, approve payouts, and record completed payments here.</p>
        <Reviews key={selectedRound.id} reviews={reviews} payouts={payouts} leaderboard={selectedLeaderboard} competitions={[selectedRound]} prepareReview={prepareReview} decideReview={decideReview} createPayout={createPayout} />
        <Payouts payouts={payouts.filter((item: any) => item.competition_id === selectedRound.id)} payoutDetails={payoutDetails.filter((item: any) => item.competition_id === selectedRound.id)} reload={reload} />
      </div>}
      {done && <p role="status" style={{ color: "#ffd76b", order: 8 }}>{done}</p>}
      <div className="league-utilities" style={{ order: 9 }}><span style={{ color: league?.enabled ? "#6ee7a1" : "#aaa0ad" }}>Banner {league?.enabled ? "visible" : "hidden"}</span><span>Last leaderboard {league?.show_last_leaderboard !== false ? "visible" : "hidden"}</span><button onClick={() => setView("display")} style={{ background: "none", border: 0, color: "#f6b51b", cursor: "pointer", fontWeight: 700 }}>Edit player display</button><button onClick={() => setView("announcements")} style={{ background: "none", border: 0, color: "#f6b51b", cursor: "pointer", fontWeight: 700 }}>Write a message</button>{view === "round" && <button onClick={() => setShowRoundTools(!showRoundTools)} style={{ background: "none", border: 0, color: "#aaa0ad", cursor: "pointer" }}>{showRoundTools ? "Close history" : "View past rounds"}</button>}</div>
    </section>
  );
}
function Reviews({ reviews, payouts, createPayout, decideReview, leaderboard, leaderboardArchive = [], competitions = [], prepareReview, setTab }: any) {
  const [expandedArchive, setExpandedArchive] = useState<string | null>(null);
  const [selectedCompetitionID, setSelectedCompetitionID] = useState(() => leaderboard?.competition?.id ?? competitions.find((item: any) => item.status === "locked" || item.status === "final")?.id ?? "");
  useEffect(() => {
    const reviewable = competitions.find((item: any) => item.status === "locked" || item.status === "final")?.id ?? leaderboard?.competition?.id ?? "";
    if (!selectedCompetitionID || !competitions.some((item: any) => item.id === selectedCompetitionID)) {
      setSelectedCompetitionID(reviewable);
    }
  }, [competitions, leaderboard, selectedCompetitionID]);
  const activeLeaderboard = selectedCompetitionID === leaderboard?.competition?.id ? leaderboard : leaderboardArchive.find((item: any) => item.competition?.id === selectedCompetitionID);
  const activeReviews = reviews.filter((item: any) => item.competition_id === selectedCompetitionID);
  return (
    <section style={card}>
      <div style={{ background: "#211c25", padding: 16, borderRadius: 12, marginBottom: 16 }}>
        <b>Competition to review</b>
        <select value={selectedCompetitionID} onChange={(e) => setSelectedCompetitionID(e.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 8, padding: 11, background: "#0f0d12", color: "#fff4d7", border: "1px solid #453b4c", borderRadius: 9 }}>
          {competitions.filter((item: any) => item.status === "locked" || item.status === "final" || item.id === leaderboard?.competition?.id).map((item: any) => <option key={item.id} value={item.id}>{item.title} · {item.status}</option>)}
        </select>
      </div>
      <Leaderboard data={activeLeaderboard} title={activeLeaderboard?.closed ? "Top standings ready for review" : "Live standings"} />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2 style={{ marginTop: 0 }}>Winner review queue</h2>
        <span style={{ color: "#918894" }}>{activeReviews.length} records</span>
      </div>
      <div
        style={{
          background: "#211c25",
          border: "1px solid #6b5318",
          borderRadius: 10,
          padding: 13,
          color: "#d6ccd9",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <b style={{ color: "#ffd76b" }}>Clearance gate</b> · inspect the
        attempt, risk signals, and notes here. Only a cleared review can move
        to Payouts, where payout details and payment approval are handled.
      </div>
      {activeLeaderboard?.closed && <button onClick={() => prepareReview(selectedCompetitionID)} style={{ marginTop: 14, background: "#f6b51b", border: 0, borderRadius: 9, padding: "10px 13px", fontWeight: 800 }}>Review top three</button>}
      {activeReviews.length === 0 ? (
        <p style={{ color: "#aaa0ad" }}>
          No winner reviews found for the current round.
        </p>
      ) : (
        activeReviews.map((r: any) => (
          <div
            key={r.id}
            style={{
              background: "#211c25",
              padding: 16,
              borderRadius: 12,
              marginTop: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                  <b>{r.public_handle ?? "Winner"}</b>
                <div style={{ color: "#aaa0ad", fontSize: 13 }}>
                  {r.competition_title ?? "Competition"} · Status: {r.status} · Risk: {r.risk_score ?? "—"} · Attempt:{" "}
                  {String(r.attempt_id).slice(0, 8)}
                </div>
              </div>
              <span
                style={{
                  color: r.status === "cleared" ? "#6ee7a1" : "#ffd76b",
                  fontWeight: 800,
                }}
              >
                {r.status}
              </span>
            </div>
            <div style={{ marginTop: 12, color: "#d6ccd9", fontSize: 13 }}>
              <div>
                <b>Integrity signals:</b>{" "}
                {r.flags_json && r.flags_json !== "[]"
                  ? r.flags_json
                  : "No stored flags"}
              </div>
              {r.note && (
                <div style={{ color: "#aaa0ad", marginTop: 5 }}>
                  <b>Review note:</b> {r.note}
                </div>
              )}
            </div>
            {(r.status === "queued" || r.status === "in_review") && (
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button
                  onClick={() =>
                    decideReview(
                      r,
                      "in_review",
                      "Owner review started from admin console.",
                    )
                  }
                  style={{
                    background: "#403944",
                    color: "#fff4d7",
                    border: 0,
                    borderRadius: 9,
                    padding: "9px 12px",
                    fontWeight: 800,
                  }}
                >
                  Start review
                </button>
                <button
                  onClick={() =>
                    decideReview(
                      r,
                      "cleared",
                      "Winner cleared after owner review.",
                    )
                  }
                  style={{
                    background: "#1d6b4b",
                    color: "#fff",
                    border: 0,
                    borderRadius: 9,
                    padding: "9px 12px",
                    fontWeight: 800,
                  }}
                >
                  Clear winner
                </button>
                <button
                  onClick={() =>
                    decideReview(
                      r,
                      "voided",
                      "Winner rejected after owner review.",
                    )
                  }
                  style={{
                    background: "#713b40",
                    color: "#fff",
                    border: 0,
                    borderRadius: 9,
                    padding: "9px 12px",
                    fontWeight: 800,
                  }}
                >
                  Reject
                </button>
              </div>
            )}
            {r.status === "cleared" && (
              <div style={{ marginTop: 14 }}>
                {payouts.some((x: any) => x.attempt_id === r.attempt_id) ? <>
                  <div style={{ color: "#6ee7a1", fontSize: 12, marginBottom: 7 }}>Cleared · payout request created automatically</div>
                  {setTab && <button type="button" onClick={() => setTab("payouts")} style={{ background: "#f6b51b", border: 0, borderRadius: 9, padding: "10px 13px", fontWeight: 800 }}>Continue to payout queue →</button>}
                </> : <div style={{ color: "#ffd76b", fontSize: 12 }}>Cleared · no payout request found. All prize-winning finalists must be cleared and the round must be closed. Refresh to retry payout reconciliation; if all conditions are met and this remains, inspect the API error.</div>}
              </div>
            )}
          </div>
        ))
      )}
      <details style={{ ...card, marginTop: 22 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>View archived leaderboards <span style={{ color: "#aaa0ad", fontWeight: 400 }}>({leaderboardArchive.filter((item: any) => item.closed).length})</span></summary>
        <p style={{ color: "#aaa0ad", marginTop: 12 }}>Final standings are retained here for safekeeping, separate from the current review queue.</p>
        {leaderboardArchive.filter((item: any) => item.closed).map((item: any) => {
          const open = expandedArchive === item.competition.id;
          return <div key={item.competition.id} style={{ marginTop: 8, background: "#211c25", border: "1px solid #302b38", borderRadius: 10, overflow: "hidden" }}>
            <button type="button" onClick={() => setExpandedArchive(open ? null : item.competition.id)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, textAlign: "left", background: "transparent", color: "#fff4d7", border: 0, padding: "14px 16px", cursor: "pointer" }}>
              <span><b>{item.competition.title}</b><small style={{ display: "block", color: "#aaa0ad", marginTop: 4 }}>{item.leaderboard.length} submitted attempts · Closed</small></span>
              <span style={{ color: "#f6b51b", fontWeight: 800 }}>{open ? "Hide standings ↑" : "View standings →"}</span>
            </button>
            {open && <div style={{ padding: "0 12px 12px" }}><Leaderboard data={item} title="Final leaderboard" /></div>}
          </div>;
        })}
        {leaderboardArchive.filter((item: any) => item.closed).length === 0 && <p style={{ color: "#aaa0ad" }}>Closed competition standings will appear here after a round ends.</p>}
      </details>
    </section>
  );
}
function Payouts({ payouts, payoutDetails = [], reload }: any) {
  const [rows, setRows] = useState(payouts);
  const [busy, setBusy] = useState<string | null>(null);
  const [deliveryNotice, setDeliveryNotice] = useState("");
  useEffect(() => setRows(payouts), [payouts]);
  async function move(p: any, status: string) {
    const note = window.prompt(`Reason for marking payout ${status}:`);
    if (!note?.trim()) return;
    let reference = "";
    if (status === "sent") {
      reference = window.prompt("Provider transfer reference:")?.trim() ?? "";
      if (!reference) return;
    }
    setBusy(p.id);
    try {
      const r = await fetch(`/api/v1/admin/cash/payouts/${p.id}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          note,
          transfer_reference: reference || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(data?.error?.message ?? "Payout update failed");
      setRows(
        rows.map((item: any) =>
          item.id === p.id
            ? {
                ...item,
                status,
                transfer_reference: reference || item.transfer_reference,
              }
            : item,
        ),
      );
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Payout update failed");
    } finally {
      setBusy(null);
    }
  }
  async function reviewDetails(detail: any, status: string) {
    const note = window.prompt(`Reason for marking payout details ${status}:`);
    if (!note?.trim()) return;
    try {
      const r = await fetch(`/api/v1/admin/cash/payout-details/${detail.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(data?.error?.message ?? "Payout details review failed");
      await reload();
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Payout details review failed",
      );
    }
  }
  async function resendNotification(payout: any) {
    setBusy(payout.id);
    try {
      const r = await fetch(`/api/v1/admin/cash/payouts/${encodeURIComponent(payout.id)}/notify`, {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error?.message ?? "Notification resend failed");
      const n = data.notification ?? {};
      setDeliveryNotice(`Form request for ${payout.public_handle ?? "winner"}: ${n.sent ?? 0} sent, ${n.failed ?? 0} failed, ${n.eligible ?? 0} eligible. Use Send secure payout form to retry; it resends to eligible devices.`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Notification resend failed");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>Payouts</h2>
      {deliveryNotice && <p role="status" style={{ color: "#ffd76b" }}>{deliveryNotice}</p>}
      <p style={{ color: "#aaa0ad" }}>
        Clear the winner, approve their payout, then record the completed transfer.
        The owner can complete both approval and transfer recording.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, margin: "18px 0 22px" }}>
        {["pending", "approved", "sent", "failed", "cancelled"].map((status) => <div key={status} style={{ background: "#211c25", borderRadius: 10, padding: 12 }}><div style={{ color: "#918894", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{status}</div><strong style={{ display: "block", fontSize: 22, marginTop: 5 }}>{rows.filter((p: any) => p.status === status).length}</strong></div>)}
      </div>
      {rows.length === 0 ? (
        <p style={{ color: "#aaa0ad" }}>
          No payout records for the current round.
        </p>
      ) : (
        rows.map((p: any) => (
          <div
            key={p.id}
            style={{
              background: "#211c25",
              padding: 16,
              borderRadius: 12,
              marginTop: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b>{p.public_handle ?? "Winner"}</b>
              <span
                style={{
                  color: p.status === "sent" ? "#6ee7a1" : "#f6b51b",
                  fontWeight: 800,
                }}
              >
                {p.status}
              </span>
            </div>
            <div style={{ color: "#aaa0ad", fontSize: 13, marginTop: 5 }}>
              {p.competition_title ?? "Competition"} · ₦{Number(p.amount_minor ?? 0) / 100} · {p.currency ?? "NGN"}
              {p.transfer_reference && ` · Ref ${p.transfer_reference}`}
            </div>
            <div style={{ color: "#d6ccd9", fontSize: 12, marginTop: 8 }}>
              {p.status === "pending" ? "Awaiting owner approval." : p.status === "approved" ? "Approved. Record the transfer after paying the winner." : p.status === "sent" ? "Transfer recorded and closed." : p.status === "failed" ? "Transfer failed; review the failure note." : "This payout is closed."}
            </div>
            {p.status === "pending" && (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  disabled={busy === p.id}
                  onClick={() => resendNotification(p)}
                  style={{
                    background: "#403944",
                    color: "#fff4d7",
                    border: 0,
                    borderRadius: 8,
                    padding: "8px 11px",
                    fontWeight: 800,
                  }}
                >
                  Send secure payout form
                </button>
                <button
                  disabled={busy === p.id}
                  onClick={() => move(p, "approved")}
                  style={{
                    background: "#1d6b4b",
                    color: "#fff",
                    border: 0,
                    borderRadius: 8,
                    padding: "8px 11px",
                    fontWeight: 800,
                  }}
                >
                  Approve
                </button>
                <button
                  disabled={busy === p.id}
                  onClick={() => move(p, "failed")}
                  style={{
                    background: "#713b40",
                    color: "#fff",
                    border: 0,
                    borderRadius: 8,
                    padding: "8px 11px",
                    fontWeight: 800,
                  }}
                >
                  Mark failed
                </button>
              </div>
            )}
            {p.status === "approved" && (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  disabled={busy === p.id}
                  onClick={() => move(p, "sent")}
                  style={{
                    background: "#f6b51b",
                    color: "#17120a",
                    border: 0,
                    borderRadius: 8,
                    padding: "8px 11px",
                    fontWeight: 800,
                  }}
                >
                  Record completed payment
                </button>
                <button
                  disabled={busy === p.id}
                  onClick={() => move(p, "cancelled")}
                  style={{
                    background: "#713b40",
                    color: "#fff",
                    border: 0,
                    borderRadius: 8,
                    padding: "8px 11px",
                    fontWeight: 800,
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))
      )}
      <h3 style={{ marginTop: 28 }}>Submitted payout details</h3>
      {payoutDetails.length === 0 ? (
        <p style={{ color: "#aaa0ad" }}>
          No payout details have been submitted.
        </p>
      ) : (
        payoutDetails.map((d: any) => (
          <div
            key={d.id}
            style={{
              background: "#211c25",
              padding: 14,
              borderRadius: 10,
              marginTop: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b>
                {d.public_handle ?? "Winner"} · place {d.place}
              </b>
              <strong
                style={{
                  color:
                    d.status === "verified"
                      ? "#6ee7a1"
                      : d.status === "rejected"
                        ? "#ff9c8b"
                        : "#ffd76b",
                }}
              >
                {d.status}
              </strong>
            </div>
            <div style={{ color: "#aaa0ad", fontSize: 13, marginTop: 5 }}>
              {d.payout_details?.legal_name ?? "Details protected"} · submitted{" "}
              {new Date(d.submitted_at).toLocaleString()}
            </div>
            {d.payout_details ? (
              <details style={{ marginTop: 14, border: "1px solid #493c50", borderRadius: 12, background: "#17131c" }}>
                <summary style={{ cursor: "pointer", fontWeight: 800, padding: "14px 16px", color: "#ffd76b" }}>View payout details</summary>
                <dl style={{ margin: 0, padding: "0 16px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: 12, overflowWrap: "anywhere" }}>
                  {[
                    ["Name on account", d.payout_details.legal_name],
                    ["Bank", d.payout_details.bank_name],
                    ["Account number", d.payout_details.account_number],
                  ].map(([label, value]) => (
                    <div key={label} style={{ background: "#211c25", borderRadius: 9, padding: "13px 14px", border: "1px solid #352d3c" }}>
                      <dt style={{ color: "#b8aebe", fontSize: 12, marginBottom: 7 }}>{label}</dt>
                      <dd style={{ margin: 0, color: "#fff5df", fontWeight: 700, fontSize: 16, lineHeight: 1.5, ...(label === "Account number" ? { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontVariantNumeric: "tabular-nums", letterSpacing: "0.06em", userSelect: "all" as const } : {}) }}>{value || "Not provided"}</dd>
                    </div>
                  ))}
                </dl>
                <p style={{ margin: 0, padding: "12px 16px", borderTop: "1px solid #352d3c", fontSize: 12, lineHeight: 1.5, color: "#b8aebe" }}>Private winner details · Confirm the account name, bank and number before transferring.</p>
              </details>
            ) : <p style={{ color: "#ff9c8b" }}>Payout details could not be decrypted. Do not transfer until the details are available.</p>}
            {d.status === "submitted" && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => reviewDetails(d, "verified")}
                  style={{
                    background: "#1d6b4b",
                    color: "#fff",
                    border: 0,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontWeight: 700,
                  }}
                >
                  Verify details
                </button>
                <button
                  onClick={() => reviewDetails(d, "rejected")}
                  style={{
                    background: "#713b40",
                    color: "#fff",
                    border: 0,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontWeight: 700,
                  }}
                >
                  Reject details
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}
function Health({ config, health, reload }: any) {
  const checks = health?.checks ?? {};
  const leagueConfig = config?.events?.odogwu_league ?? {};
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function emergencyDisable() {
    if (!window.confirm("Emergency-disable the published configuration and close League entries? This action is audited.")) return;
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/v1/admin/app-config/disable", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Emergency control used from System Health." }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error?.message ?? "Emergency disable failed");
      setMessage("Emergency disable completed. New entries are closed and the action was recorded in the audit log.");
      await reload?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Emergency disable failed"); } finally { setBusy(false); }
  }
  return (
    <section>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2,1fr)",
          gap: 14,
        }}
      >
        {Object.entries(checks).map(([key, value]: any) => (
          <Stat
            key={key}
            label={key.replaceAll("_", " ")}
            value={value.status}
            accent={value.status === "operational"}
          />
        ))}
      </div>
      <section style={{ ...card, marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>Runtime controls</h2>
        <p style={{ color: "#aaa0ad" }}>
          Entries: {leagueConfig.entry_enabled ? "Enabled" : "Disabled"} · Cash
          competition: {leagueConfig.cash_enabled ? "Enabled" : "Disabled"}
        </p>
        <p style={{ color: "#aaa0ad", fontSize: 13 }}>
          Last checked:{" "}
          {health?.generated_at
            ? new Date(health.generated_at).toLocaleString()
            : "Not checked"}
        </p>
        {Object.entries(checks).map(([key, value]: any) => (
          <div
            key={key}
            style={{ borderTop: "1px solid #302b38", padding: "10px 0" }}
          >
            <b>{key.replaceAll("_", " ")}</b>
            <div style={{ color: "#aaa0ad", fontSize: 13, marginTop: 4 }}>
              {value.detail}
            </div>
          </div>
        ))}
      </section>
      <section style={{ ...card, marginTop: 18, borderColor: "#713b40" }}>
        <h2 style={{ marginTop: 0 }}>Emergency controls</h2>
        <p style={{ color: "#aaa0ad" }}>Use only when a live issue requires the League to stop accepting entries immediately. The action is owner-authenticated and permanently audited.</p>
        <button onClick={emergencyDisable} disabled={busy} style={{ background: "#713b40", color: "#fff", border: 0, borderRadius: 9, padding: "11px 14px", fontWeight: 800 }}>{busy ? "Disabling…" : "Emergency disable entries"}</button>
        {message && <p style={{ color: "#ffd76b" }}>{message}</p>}
      </section>
    </section>
  );
}
function Settings() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/v1/admin/settings", { credentials: "include" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);
  async function toggleRole(role: any) {
    const next = !Boolean(role.enabled);
    const reason = window.prompt(`Why are you ${next ? "enabling" : "disabling"} the ${role.label} role?`);
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/settings/roles/${encodeURIComponent(role.id)}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: next, reason }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? "Role update failed");
      setData((current: any) => ({ ...current, roles: (current?.roles ?? []).map((item: any) => item.id === role.id ? { ...item, enabled: next ? 1 : 0 } : item) }));
    } catch (error) { window.alert(error instanceof Error ? error.message : "Role update failed"); }
    finally { setBusy(false); }
  }
  async function editPermissions(role: any) {
    let current: string[] = [];
    try { current = typeof role.permissions_json === "string" ? JSON.parse(role.permissions_json) : (role.permissions_json ?? []); } catch { current = []; }
    const value = window.prompt("Permissions (comma-separated):", current.join(", "));
    if (value === null) return;
    const permissions = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
    const reason = window.prompt(`Why are you changing ${role.label} permissions?`);
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/admin/settings/roles/${encodeURIComponent(role.id)}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ permissions, reason }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? "Permission update failed");
      setData((currentData: any) => ({ ...currentData, roles: (currentData?.roles ?? []).map((item: any) => item.id === role.id ? { ...item, permissions_json: JSON.stringify(permissions) } : item) }));
    } catch (error) { window.alert(error instanceof Error ? error.message : "Permission update failed"); }
    finally { setBusy(false); }
  }
  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>Owner settings & roles</h2>
      <p style={{ color: "#aaa0ad" }}>
        Role definitions are ready for future delegation. Your current owner
        session remains the only active administrative access.
      </p>
      <div
        style={{
          background: "#211c25",
          padding: 16,
          borderRadius: 12,
          marginBottom: 14,
        }}
      >
        <b>Current access</b>
        <div style={{ color: "#aaa0ad", fontSize: 13, marginTop: 5 }}>
          {data?.owner ?? "Owner"} · {data?.current_access ?? "apple"}
        </div>
      </div>
      {(data?.roles ?? []).map((role: any) => (
        <div
          key={role.id}
          style={{
            background: "#211c25",
            padding: 14,
            borderRadius: 10,
            marginTop: 8,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>
            <b>{role.label}</b>
            <small style={{ display: "block", color: "#aaa0ad" }}>
              {role.role_key}
            </small>
            <small style={{ display: "block", color: "#aaa0ad", marginTop: 6 }}>
              Permissions: {(() => {
                try {
                  const permissions = typeof role.permissions_json === "string" ? JSON.parse(role.permissions_json) : role.permissions_json;
                  return Array.isArray(permissions) ? (permissions.length ? permissions.join(" · ") : "None assigned") : Object.keys(permissions ?? {}).filter((key) => permissions[key]).join(" · ") || "None assigned";
                } catch {
                  return "Permission data unavailable";
                }
              })()}
            </small>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 10, color: role.enabled ? "#6ee7a1" : "#ff9c8b", fontSize: 12 }}>
            {role.enabled ? "Enabled" : "Disabled"}
            {role.role_key !== "owner" && <><button type="button" disabled={busy} onClick={() => editPermissions(role)} style={{ background: "#403944", color: "#fff4d7", border: 0, borderRadius: 7, padding: "6px 8px", fontWeight: 700 }}>Permissions</button><button type="button" disabled={busy} onClick={() => toggleRole(role)} style={{ background: "#403944", color: "#fff4d7", border: 0, borderRadius: 7, padding: "6px 8px", fontWeight: 700 }}>{role.enabled ? "Disable" : "Enable"}</button></>}
          </span>
        </div>
      ))}
    </section>
  );
}
function Players({ players }: any) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState(players);
  const [loading, setLoading] = useState(false);
  useEffect(() => setRows(players), [players]);
  async function search(value: string) {
    setQuery(value);
    setLoading(true);
    try {
      const r = await fetch(
        `/api/v1/admin/players?limit=100&search=${encodeURIComponent(value)}`,
        { credentials: "include" },
      );
      const data = await r.json();
      if (r.ok) setRows(data.players ?? []);
    } finally {
      setLoading(false);
    }
  }
  async function decide(player: any, status: string) {
    const note = window.prompt(`Note for ${status} decision`);
    if (!note?.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(
        `/api/v1/admin/cash/players/${player.id}/eligibility`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status, note }),
        },
      );
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.error?.message ?? "Eligibility update failed");
      }
      await search(query);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Eligibility update failed",
      );
    } finally {
      setLoading(false);
    }
  }
  async function changeAccountState(player: any, action: "suspend" | "reinstate") {
    const note = window.prompt(`Reason to ${action} this account:`);
    if (!note?.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/v1/admin/players/${encodeURIComponent(player.id)}/account-state`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error?.message ?? "Account update failed");
      await search(query);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Account update failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <section style={card}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Player directory</h2>
        <span style={{ color: "#918894" }}>{rows.length} players</span>
      </div>
      <input
        value={query}
        onChange={(e) => search(e.target.value)}
        placeholder="Search handle, player ID, or verified phone"
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#0f0d12",
          border: "1px solid #453b4c",
          color: "#fff4d7",
          borderRadius: 10,
          padding: 12,
          marginBottom: 10,
        }}
      />
      {loading && <p style={{ color: "#aaa0ad" }}>Working…</p>}
      {!loading && rows.length === 0 ? (
        <p style={{ color: "#aaa0ad" }}>No players found.</p>
      ) : (
        rows.map((p: any) => (
          <div
            key={p.id}
            style={{
              background: "#211c25",
              padding: 15,
              borderRadius: 12,
              marginTop: 9,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <b>{p.public_handle}</b>
                <div style={{ color: "#aaa0ad", fontSize: 13 }}>
                  {p.account_state} · eligibility: {p.eligibility_status} ·{" "}
                  {p.attempt_count} attempts
                </div>
              </div>
              <span
                style={{
                  color:
                    p.eligibility_status === "eligible" ? "#6ee7a1" : "#ffd76b",
                  fontWeight: 800,
                }}
              >
                {p.phone_verified_at ? "Verified" : "Unverified"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
              <button
                onClick={() => decide(p, "eligible")}
                style={{
                  background: "#1d6b4b",
                  color: "#fff",
                  border: 0,
                  borderRadius: 8,
                  padding: "7px 10px",
                  fontWeight: 700,
                }}
              >
                Eligible
              </button>
              <button
                onClick={() => decide(p, "ineligible")}
                style={{
                  background: "#403944",
                  color: "#fff4d7",
                  border: 0,
                  borderRadius: 8,
                  padding: "7px 10px",
                  fontWeight: 700,
                }}
              >
                Ineligible
              </button>
              <button
                onClick={() => changeAccountState(p, "suspend")}
                style={{
                  background: "#713b40",
                  color: "#fff",
                  border: 0,
                  borderRadius: 8,
                  padding: "7px 10px",
                  fontWeight: 700,
                }}
              >
                Suspend account
              </button>
              {p.account_state === "suspended" && (
                <button
                  onClick={() => changeAccountState(p, "reinstate")}
                  style={{
                    background: "#1d6b4b",
                    color: "#fff",
                    border: 0,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontWeight: 700,
                  }}
                >
                  Reinstate account
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
function Fraud({ reviews, decideReview }: any) {
  const flagged = reviews.filter(
    (r: any) =>
      Number(r.risk_score ?? 0) > 0 || (r.flags_json && r.flags_json !== "[]"),
  );
  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2 style={{ marginTop: 0 }}>Fraud & integrity alerts</h2>
        <span style={{ color: flagged.length ? "#ff9c8b" : "#6ee7a1" }}>
          {flagged.length} flagged
        </span>
      </div>
      <p style={{ color: "#aaa0ad" }}>
        This queue surfaces risk-scored attempts and stored integrity flags
        before winner or payout decisions.
      </p>
      {flagged.length === 0 ? (
        <p style={{ color: "#aaa0ad" }}>
          No flagged attempts in the current competition.
        </p>
      ) : (
        flagged.map((r: any) => (
          <div
            key={r.id}
            style={{
              background: "#211c25",
              padding: 16,
              borderRadius: 12,
              marginTop: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b>{r.public_handle ?? "Unknown player"}</b>
              <strong style={{ color: "#ff9c8b" }}>Risk {r.risk_score}</strong>
            </div>
            <div style={{ color: "#aaa0ad", fontSize: 13, marginTop: 6 }}>
              Review: {r.status} · Attempt {String(r.attempt_id).slice(0, 12)}
            </div>
            <pre
              style={{ whiteSpace: "pre-wrap", color: "#d6ccd9", fontSize: 12 }}
            >
              {r.flags_json}
            </pre>
            {(r.status === "queued" || r.status === "in_review") && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={() =>
                    decideReview(
                      r,
                      "in_review",
                      "Integrity investigation started from Fraud & Integrity.",
                    )
                  }
                  style={{
                    background: "#403944",
                    color: "#fff4d7",
                    border: 0,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontWeight: 700,
                  }}
                >
                  Investigate
                </button>
                <button
                  onClick={() =>
                    decideReview(
                      r,
                      "voided",
                      "Attempt rejected after integrity review.",
                    )
                  }
                  style={{
                    background: "#713b40",
                    color: "#fff",
                    border: 0,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontWeight: 700,
                  }}
                >
                  Reject attempt
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}
function ContentHub({ releases = [], releasesError = "", reload }: any) {
  const [busyRelease, setBusyRelease] = useState<string | null>(null);
  const [releaseMessage, setReleaseMessage] = useState("");
  async function changeRelease(r: any, action: "rollback" | "revoke") {
    const reason = window.prompt(`${action === "rollback" ? "Restore" : "Revoke"} release ${r.revision}. Enter an audit reason:`);
    if (!reason?.trim()) return;
    if (!window.confirm(`${action === "rollback" ? "Restore" : "Revoke"} this content release?`)) return;
    setBusyRelease(r.id); setReleaseMessage("");
    try {
      const response = await fetch(`/api/v1/admin/content/releases/${action}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ release_id: r.id, reason }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message ?? `Release ${action} failed`);
      setReleaseMessage(`Release ${r.revision} ${action === "rollback" ? "restored" : "revoked"}.`);
      await reload?.();
    } catch (error) { setReleaseMessage(error instanceof Error ? error.message : `Release ${action} failed`); }
    finally { setBusyRelease(null); }
  }
  const contentTools = [
    { title: "Edit party cards", detail: "Find a card, change its wording or category, then save the edits.", href: "/card-review", action: "Open card editor" },
    { title: "Publish weekly content", detail: "Validate and publish the next Party and Solo content release.", href: "/content-admin#weekly-publisher", action: "Open publisher" },
    { title: "Review Solo candidates", detail: "Approve new Solo questions and prepare them for a release.", href: "/content-admin/solo-candidates", action: "Open candidate bank" },
    { title: "Manage Four Pics levels", detail: "Edit answers, categories, difficulty, photos, nudges and facts.", href: "/content-admin#four-pics", action: "Open Four Pics editor" },
    { title: "Manage categories", detail: "Choose which categories appear, their access, and the first category players see.", href: "/content-admin#categories", action: "Open category settings" },
  ];
  const playerTools = [
    { title: "Home pop-up", detail: "Schedule a one-time message shown inside the app. This is separate from push notifications.", href: "/content-admin#home-announcement", action: "Manage Home pop-up" },
    { title: "Push notifications", detail: "Send a general player announcement and review delivery results.", href: "/admin?tab=notifications", action: "Open notifications" },
    { title: "League announcements", detail: "Write an in-app League message or change what the League banner shows.", href: "/admin?tab=live&section=announcements", action: "Manage League messages" },
    { title: "App branding and Home", detail: "Manage the app logo, appearance and Home screen controls.", href: "/content-admin#branding", action: "Open app settings" },
    { title: "View active game content", detail: "Search the currently published Today’s 5 and Party Deck cards.", href: "/content-admin#published-catalog", action: "Browse active cards" },
  ];
  const toolCard = (item: { title: string; detail: string; href: string; action: string }) => (
    <a key={item.title} href={item.href} style={{ ...card, display: "block", color: "#fff4d7", textDecoration: "none", minHeight: 142 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>{item.title}</h3>
      <p style={{ color: "#aaa0ad", margin: "0 0 16px", lineHeight: 1.5 }}>{item.detail}</p>
      <span style={{ color: "#f6b51b", fontWeight: 800 }}>{item.action}</span>
    </a>
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Game content</h2>
        <p style={{ color: "#aaa0ad" }}>Edit cards here, then publish them through a reviewed content release.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
          {contentTools.map(toolCard)}
        </div>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Messages and app presentation</h2>
        <p style={{ color: "#aaa0ad" }}>Choose the right control: an in-app pop-up, a push notification, or a League message.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
          {playerTools.map(toolCard)}
        </div>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Published release history</h2>
        <p style={{ color: "#aaa0ad" }}>
          Every release remains immutable after publication; rollback and revoke
          stay behind the existing validation and owner audit gates.
        </p>
        {releasesError ? (
          <p style={{ color: "#ffb38a" }}>Release history is temporarily unavailable. The publisher remains available above. <small>{releasesError}</small></p>
        ) : releases.length === 0 ? (
          <p style={{ color: "#aaa0ad" }}>No release records returned.</p>
        ) : (
          releases.slice(0, 10).map((r: any) => (
            <div
              key={r.id}
              style={{
                borderTop: "1px solid #302b38",
                padding: "10px 0",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>
                <b>Revision {r.revision}</b>
                <small style={{ display: "block", color: "#aaa0ad" }}>
                  {r.effective_week_wat} · {r.asset_count} assets
                </small>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}><strong style={{ color: r.status === "published" ? "#6ee7a1" : "#ffd76b" }}>{r.status}</strong>{r.status === "published" && <button type="button" disabled={busyRelease === r.id} onClick={() => changeRelease(r, "revoke")} style={{ background: "#713b40", color: "#fff", border: 0, borderRadius: 7, padding: "6px 8px", fontWeight: 700 }}>Revoke</button>}{r.status !== "revoked" && r.status !== "published" && <button type="button" disabled={busyRelease === r.id} onClick={() => changeRelease(r, "rollback")} style={{ background: "#403944", color: "#fff4d7", border: 0, borderRadius: 7, padding: "6px 8px", fontWeight: 700 }}>Restore</button>}</span>
            </div>
          ))
        )}
        {releaseMessage && <p style={{ color: "#ffd76b" }}>{releaseMessage}</p>}
      </section>
    </div>
  );
}
function Support({ requests, cases = [], reload }: any) {
  const [rows, setRows] = useState(requests);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(requests), [requests]);
  async function update(request: any, status: string) {
    const note = window.prompt(`Note for ${status} status`);
    if (!note?.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/admin/privacy/requests/${request.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(data?.error?.message ?? "Request update failed");
      setRows(
        rows.map((item: any) =>
          item.id === request.id ? { ...item, status } : item,
        ),
      );
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Request update failed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function createCase() {
    const subject = window.prompt("Case subject:");
    if (!subject?.trim()) return;
    const message = window.prompt("Player message or case summary:");
    if (!message?.trim()) return;
    const category = window.prompt("Category (complaint, payout, login, dispute, privacy, other):", "other");
    if (!category?.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/v1/admin/support/cases", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, message, category, priority: "normal" }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error?.message ?? "Case creation failed");
      await reload?.();
    } catch (error) { window.alert(error instanceof Error ? error.message : "Case creation failed"); } finally { setBusy(false); }
  }
  async function updateCase(item: any, status: string) {
    const note = window.prompt(`Internal note for ${status}:`);
    if (!note?.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/admin/support/cases/${encodeURIComponent(item.id)}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, note }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error?.message ?? "Case update failed");
      await reload?.();
    } catch (error) { window.alert(error instanceof Error ? error.message : "Case update failed"); } finally { setBusy(false); }
  }
  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2 style={{ marginTop: 0 }}>Support & privacy operations</h2>
        <span style={{ color: "#918894" }}>{rows.length} requests</span>
      </div>
      <p style={{ color: "#aaa0ad" }}>
        Privacy requests are connected to the owner queue. Destructive deletion
        work remains protected by active-attempt, challenge, review, and payout
        holds in the API.
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22 }}>
        <h3 style={{ margin: 0 }}>Support cases</h3>
        <button onClick={createCase} disabled={busy} style={{ background: "#f6b51b", border: 0, borderRadius: 9, padding: "9px 12px", fontWeight: 800 }}>New case</button>
      </div>
      {cases.length === 0 ? <p style={{ color: "#aaa0ad" }}>No support cases are currently open.</p> : cases.map((item: any) => <div key={item.id} style={{ background: "#211c25", padding: 15, borderRadius: 12, marginTop: 9 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><b>{item.subject}</b><strong style={{ color: item.status === "resolved" || item.status === "closed" ? "#6ee7a1" : "#ffd76b" }}>{item.status}</strong></div><div style={{ color: "#aaa0ad", fontSize: 13, marginTop: 5 }}>{item.category} · {item.priority} · {item.public_handle ?? "Unlinked player"}</div><p style={{ marginBottom: 0, color: "#d6ccd9" }}>{item.message}</p>{!['resolved','closed','rejected'].includes(item.status) && <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}><button disabled={busy} onClick={() => updateCase(item, "investigating")} style={{ background: "#403944", color: "#fff4d7", border: 0, borderRadius: 8, padding: "7px 10px", fontWeight: 700 }}>Investigate</button><button disabled={busy} onClick={() => updateCase(item, "waiting_for_player")} style={{ background: "#403944", color: "#fff4d7", border: 0, borderRadius: 8, padding: "7px 10px", fontWeight: 700 }}>Wait for player</button><button disabled={busy} onClick={() => updateCase(item, "resolved")} style={{ background: "#1d6b4b", color: "#fff", border: 0, borderRadius: 8, padding: "7px 10px", fontWeight: 700 }}>Resolve</button></div>}</div>)}
      {rows.length === 0 ? (
        <p style={{ color: "#aaa0ad" }}>
          No privacy requests are currently queued.
        </p>
      ) : (
        rows.map((r: any) => (
          <div
            key={r.id}
            style={{
              background: "#211c25",
              padding: 15,
              borderRadius: 12,
              marginTop: 9,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b>
                {r.public_handle ?? "Player"} · {r.request_type}
              </b>
              <strong
                style={{ color: r.status === "queued" ? "#ffd76b" : "#6ee7a1" }}
              >
                {r.status}
              </strong>
            </div>
            <div style={{ color: "#aaa0ad", fontSize: 13, marginTop: 5 }}>
              {r.statement} · created {new Date(r.created_at).toLocaleString()}
            </div>
            {(r.status === "queued" || r.status === "in_review") && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  disabled={busy}
                  onClick={() => update(r, "in_review")}
                  style={{
                    background: "#403944",
                    color: "#fff4d7",
                    border: 0,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontWeight: 700,
                  }}
                >
                  Start review
                </button>
                <button
                  disabled={busy}
                  onClick={() => update(r, "completed")}
                  style={{
                    background: "#1d6b4b",
                    color: "#fff",
                    border: 0,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontWeight: 700,
                  }}
                >
                  Complete
                </button>
                <button
                  disabled={busy}
                  onClick={() => update(r, "denied")}
                  style={{
                    background: "#713b40",
                    color: "#fff",
                    border: 0,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontWeight: 700,
                  }}
                >
                  Deny
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}
function Analytics({ players, reviews, payouts, analytics }: any) {
  const totals = analytics?.totals ?? {};
  const playerCount = Number(totals.players ?? players.length),
    reviewCount = Number(totals.reviews ?? reviews.length),
    flagged = Number(
      totals.flagged ??
        reviews.filter((r: any) => Number(r.risk_score ?? 0) > 0).length,
    ),
    payoutCount = Number(totals.payouts ?? payouts.length),
    paid = Number(
      totals.paid_payouts ??
        payouts.filter((p: any) => p.status === "sent").length,
    );
  function exportCSV() {
    const rows: Array<Array<string | number>> = [
      [
        "player_count",
        "attempt_count",
        "submitted_attempts",
        "confirmed_attempts",
        "review_count",
        "flagged_attempts",
        "payout_count",
        "paid_count",
      ],
      [
        playerCount,
        Number(totals.attempts ?? 0),
        Number(totals.submitted_attempts ?? 0),
        Number(totals.confirmed_attempts ?? 0),
        reviewCount,
        flagged,
        payoutCount,
        paid,
      ],
    ];
    rows.push([]);
    rows.push(["competition_id", "competition", "status", "attempts", "reviews", "payouts"]);
    for (const item of analytics?.competitions ?? []) {
      rows.push([
        item.id ?? "",
        item.title ?? "",
        item.status ?? "",
        Number(item.attempts ?? 0),
        Number(item.reviews ?? 0),
        Number(item.payouts ?? 0),
      ]);
    }
    const csv = rows
      .map((row: Array<string | number>) =>
        row
          .map(
            (value: string | number) =>
              `"${String(value).replace(/"/g, '""')}"`,
          )
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `wetin-be-dis-operations-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <p style={{ color: "#aaa0ad", margin: 0 }}>
          Server-calculated production totals.
        </p>
        <button
          onClick={exportCSV}
          style={{
            background: "#f6b51b",
            border: 0,
            borderRadius: 9,
            padding: "10px 14px",
            fontWeight: 800,
          }}
        >
          Export CSV
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2,1fr)",
          gap: 14,
        }}
      >
        <Stat label="Players" value={playerCount} />
        <Stat label="Attempts" value={Number(totals.attempts ?? 0)} />
        <Stat
          label="Confirmed attempts"
          value={Number(totals.confirmed_attempts ?? 0)}
        />
        <Stat label="Winner reviews" value={reviewCount} />
        <Stat label="Flagged attempts" value={flagged} />
        <Stat
          label="Payout completion"
          value={`${paid}/${payoutCount}`}
          accent
        />
      </div>
      <div style={{ ...card, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Competition performance</h3>
          {analytics?.generated_at && (
            <span style={{ color: "#918894", fontSize: 12 }}>
              Updated {new Date(analytics.generated_at).toLocaleString()}
            </span>
          )}
        </div>
        {(analytics?.competitions ?? []).length === 0 ? (
          <p style={{ color: "#aaa0ad" }}>No competition performance data yet.</p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead>
                <tr style={{ color: "#918894", textAlign: "left", fontSize: 12 }}>
                  <th style={{ padding: "9px 8px" }}>Competition</th>
                  <th style={{ padding: "9px 8px" }}>Status</th>
                  <th style={{ padding: "9px 8px" }}>Attempts</th>
                  <th style={{ padding: "9px 8px" }}>Reviews</th>
                  <th style={{ padding: "9px 8px" }}>Payouts</th>
                </tr>
              </thead>
              <tbody>
                {(analytics.competitions ?? []).map((item: any) => (
                  <tr key={item.id} style={{ borderTop: "1px solid #302b38" }}>
                    <td style={{ padding: "11px 8px", fontWeight: 700 }}>{item.title ?? item.id}</td>
                    <td style={{ padding: "11px 8px", color: item.status === "open" ? "#6ee7a1" : "#ffd76b" }}>{item.status}</td>
                    <td style={{ padding: "11px 8px" }}>{item.attempts ?? 0}</td>
                    <td style={{ padding: "11px 8px" }}>{item.reviews ?? 0}</td>
                    <td style={{ padding: "11px 8px" }}>{item.payouts ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
function Notifications({ audit = [], competitions = [], notificationStatus = null }: any) {
  const [event, setEvent] = useState("general_announcement");
  const isGeneral = event === "general_announcement";
  const audience = isGeneral ? notificationStatus?.announcements : notificationStatus;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [competitionID, setCompetitionID] = useState(competitions.find((item: any) => item.status === "open")?.id ?? competitions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    if (competitions.length && !competitions.some((item: any) => item.id === competitionID)) {
      setCompetitionID(competitions.find((item: any) => item.status === "open")?.id ?? competitions[0].id);
    }
  }, [competitions, competitionID]);
  const persisted = audit
    .filter((item: any) => item.action === "notification_broadcast")
    .map((item: any) => {
      let details: any = {};
      try {
        details = JSON.parse(item.details_json ?? "{}");
      } catch {}
      return {
        event: details.event ?? "notification",
        competitionID: details.competition_id ?? "",
        at: new Date(item.changed_at).toISOString(),
        eligible: details.eligible ?? 0,
        sent: details.sent ?? 0,
        failed: details.failed ?? 0,
        removed: details.removed ?? 0,
        title: details.title ?? "",
        body: details.body ?? "",
      };
    });
  const displayed = [...history, ...persisted];
  async function send() {
    if (isGeneral && (!title.trim() || !body.trim())) {
      setResult("Enter both a title and message for your announcement.");
      return;
    }
    if (!window.confirm(isGeneral
      ? `Send this general announcement to ${audience?.eligible_devices ?? 0} eligible iOS devices with New decks and offers enabled?\n\n${title.trim()}\n${body.trim()}`
      : "Send this League notification to eligible devices?"))
      return;
    setBusy(true);
    setResult("");
    try {
      const r = await fetch(isGeneral ? "/api/v1/admin/notifications/announcement-broadcast" : "/api/v1/admin/notifications/league-broadcast", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event, ...(!isGeneral ? { competition_id: competitionID } : {}), ...(title.trim() || body.trim() ? { title: title.trim(), body: body.trim() } : {}) }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error?.message ?? "Notification failed");
      const n = data.notification ?? {};
      const entry = {
        event,
        competitionID: isGeneral ? "" : competitionID,
        at: new Date().toISOString(),
        eligible: n.eligible ?? 0,
        sent: n.sent ?? 0,
        failed: n.failed ?? 0,
        removed: n.removed ?? 0,
        title: title.trim(),
        body: body.trim(),
      };
      setHistory((items) => [entry, ...items].slice(0, 20));
      setResult(
        `Eligible: ${entry.eligible} · Sent: ${entry.sent} · Failed: ${entry.failed} · Removed: ${entry.removed}`,
      );
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Notification failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>{isGeneral ? "General announcement" : "League notifications"}</h2>
      <p style={{ color: "#aaa0ad" }}>
        {isGeneral
          ? 'Send a custom message to iOS players with “New decks and offers” enabled. No League banner or competition is required. Tapping opens the app without a League link.'
          : "Send an operational event to players who opted into League updates. Leave the copy blank for the default message, or customize both fields."}
      </p>
      <div style={{ background: audience?.eligible_devices ? "#173527" : "#3a2923", border: `1px solid ${audience?.eligible_devices ? "#2d8a60" : "#8a5a2d"}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
        <b>{audience?.eligible_devices ? "Notifications ready" : "No eligible devices right now"}</b>
        <div style={{ color: "#d6ccd9", fontSize: 13, marginTop: 4 }}>{audience ? `${audience.eligible_devices} opted-in ${isGeneral ? "iOS " : ""}device${audience.eligible_devices === 1 ? "" : "s"} across ${audience.eligible_players} player${audience.eligible_players === 1 ? "" : "s"}.` : "Checking notification readiness…"}</div>
      </div>
      <div style={{ display: "grid", gap: 12, maxWidth: 620 }}>
        <label>
          Event
          <select
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              marginTop: 6,
              padding: 11,
              background: "#0f0d12",
              color: "#fff4d7",
              border: "1px solid #453b4c",
              borderRadius: 9,
            }}
          >
            <option value="general_announcement">General announcement (iOS)</option>
            <option value="starts_soon">League: starts soon</option>
            <option value="started">Started</option>
            <option value="closing_soon">Closing soon</option>
            <option value="closed">Closed</option>
            <option value="provisional_results">Provisional results</option>
            <option value="results_ready">Results ready</option>
          </select>
        </label>
        {!isGeneral && <label>
          Competition
          <select
            value={competitionID}
            onChange={(e) => setCompetitionID(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              boxSizing: "border-box",
              marginTop: 6,
              padding: 11,
              background: "#0f0d12",
              color: "#fff4d7",
              border: "1px solid #453b4c",
              borderRadius: 9,
            }}
          >
            {competitions.length ? competitions.map((item: any) => <option key={item.id} value={item.id}>{item.title} · {item.status}</option>) : <option value="">No competition available</option>}
          </select>
        </label>}
        <label>
          Notification title <span style={{ color: "#918894", fontSize: 12 }}>{isGeneral ? "(required)" : "(optional)"}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={isGeneral ? "Na you make am sweet ❤️" : "Odogwu League don open 🏆"} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 11, background: "#0f0d12", color: "#fff4d7", border: "1px solid #453b4c", borderRadius: 9 }} />
          <small style={{ color: "#918894" }}>{title.length}/80</small>
        </label>
        <label>
          Notification message <span style={{ color: "#918894", fontSize: 12 }}>{isGeneral ? "(required)" : "(optional)"}</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={240} rows={3} placeholder={isGeneral ? "Thanks for playing WetinBeDis! Share the fun with your people." : "Your chance to climb the leaderboard is live."} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 11, background: "#0f0d12", color: "#fff4d7", border: "1px solid #453b4c", borderRadius: 9, resize: "vertical" }} />
          <small style={{ color: "#918894" }}>{body.length}/240</small>
        </label>
        <button
          onClick={send}
          disabled={busy || (isGeneral && (!title.trim() || !body.trim() || !audience?.eligible_devices))}
          style={{
            background: "#f6b51b",
            border: 0,
            borderRadius: 9,
            padding: 12,
            fontWeight: 800,
            width: "fit-content",
          }}
        >
          {busy ? "Sending…" : "Send notification"}
        </button>
      </div>
      {result && <p style={{ color: "#ffd76b" }}>{result}</p>}
      <h3 style={{ marginTop: 28 }}>
        Recent sends · {displayed.length} recorded
      </h3>
      {displayed.length === 0 ? (
        <p style={{ color: "#aaa0ad" }}>No notification broadcasts recorded.</p>
      ) : (
        displayed.map((item: any, index: number) => (
          <div
            key={`${item.at}-${index}`}
            style={{
              background: "#211c25",
              padding: 12,
              borderRadius: 10,
              marginTop: 8,
              color: "#d6ccd9",
              fontSize: 13,
            }}
          >
            <b>{item.event}</b> · {new Date(item.at).toLocaleString()}
            <div style={{ color: "#aaa0ad", marginTop: 4 }}>
              {item.eligible} eligible · {item.sent} sent · {item.failed} failed
              · {item.removed} removed
            </div>
            {item.title && <div style={{ color: "#fff4d7", marginTop: 5 }}>{item.title}</div>}
            {item.body && <div style={{ color: "#aaa0ad", marginTop: 3 }}>{item.body}</div>}
          </div>
        ))
      )}
    </section>
  );
}
function Audit({ audit }: any) {
  function exportAudit() {
    const headers = ["id", "action", "resource_type", "resource_id", "actor", "note", "changed_at"];
    const rows = audit.map((x: any) => headers.map((key) => key === "changed_at" ? new Date(x[key]).toISOString() : (x[key] ?? "")));
    const csv = [headers, ...rows].map((row) => row.map((value: any) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `wetin-be-dis-audit-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ marginTop: 0 }}>Audit log</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ color: "#918894" }}>{audit.length} events</span><button onClick={exportAudit} disabled={audit.length === 0} style={{ background: "#f6b51b", border: 0, borderRadius: 8, padding: "8px 10px", fontWeight: 800 }}>Export CSV</button></div>
      </div>
      {audit.length === 0 ? (
        <p style={{ color: "#aaa0ad" }}>No admin events recorded yet.</p>
      ) : (
        audit.map((x: any) => (
          <div
            key={x.id}
            style={{ borderTop: "1px solid #302b38", padding: "14px 0" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b>{x.action}</b>
              <span style={{ color: "#918894", fontSize: 12 }}>
                {new Date(x.changed_at).toLocaleString()}
              </span>
            </div>
            <div style={{ color: "#aaa0ad", fontSize: 13, marginTop: 5 }}>
              {x.resource_type}
              {x.resource_id
                ? ` · ${String(x.resource_id).slice(0, 12)}`
                : ""}{" "}
              · {x.actor}
            </div>
            <div style={{ color: "#d6ccd9", fontSize: 13, marginTop: 5 }}>
              {x.note}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p style={{ color: "#aaa0ad" }}>{text}</p>
    </section>
  );
}
