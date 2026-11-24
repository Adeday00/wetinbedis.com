"use client";

import { useCallback, useEffect, useState } from "react";

type Preview = {
  id: string;
  public_handle: string;
  rank_at_submission: number;
  display_name: string;
  bank_label: string;
  account_last4: string;
  country_code: string;
  submitted_at: number;
};

type QueuePayload = {
  message?: string;
  payout_previews?: Preview[];
  error?: { message?: string };
};

function submittedAt(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function RehearsalPayoutQueue() {
  const [rows, setRows] = useState<Preview[]>([]);
  const [message, setMessage] = useState("Loading the internal test queue…");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/admin/rehearsal/payout-previews", {
        credentials: "same-origin",
      });
      const payload = await response.json() as QueuePayload;
      if (!response.ok) throw new Error(payload.error?.message ?? "The test queue could not be loaded.");
      setRows(payload.payout_previews ?? []);
      setMessage(payload.message ?? "Internal test queue only. No entry in this list can be paid.");
    } catch (error) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : "The test queue could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="admin-panel rehearsal-queue" aria-busy={busy}>
      <div className="admin-panel-title">
        <div><span>3</span><h2>Internal winner-form queue</h2></div>
        <button className="button button-secondary" onClick={() => void load()} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh queue"}
        </button>
      </div>
      <p className="admin-help">
        This is the exact data stored by the rehearsal form: test name, test bank label, country, and final four dummy digits. It is separate from payouts and cannot be paid.
      </p>
      {rows.length === 0 ? (
        <div className="review-empty">No one has submitted the test form yet. A current top-three player will appear here after saving it in the app.</div>
      ) : (
        <div className="rehearsal-queue-table" role="region" aria-label="Internal payout form submissions" tabIndex={0}>
          <table>
            <thead>
              <tr><th>Rank</th><th>Player</th><th>Test name</th><th>Test bank</th><th>Dummy acct.</th><th>Country</th><th>Saved</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>#{row.rank_at_submission}</td>
                  <td>{row.public_handle}</td>
                  <td>{row.display_name}</td>
                  <td>{row.bank_label}</td>
                  <td>•••• {row.account_last4}</td>
                  <td>{row.country_code}</td>
                  <td>{submittedAt(row.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="admin-help rehearsal-queue-message">{message}</p>
    </section>
  );
}
