/** Android data-only delivery keeps foreground/background notification preferences authoritative. */
export type LeagueNotificationEvent = "general_announcement" | "starts_soon" | "started" | "closing_soon" | "closed" | "provisional_results" | "results_ready" | "payout_details_required" | "payout_submitted" | "payout_approved" | "payout_sent" | "payout_failed" | "payout_cancelled";
export interface FCMEnvironment {
  WBD_FCM_SERVICE_ACCOUNT_JSON?: string;
  WBD_FCM_PROJECT_ID?: string;
}
interface FCMAccount { client_email: string; private_key: string; project_id: string }
export function fcmConfiguration(env: FCMEnvironment): FCMAccount {
  let account: Partial<FCMAccount>;
  try { account = JSON.parse(env.WBD_FCM_SERVICE_ACCOUNT_JSON ?? ""); }
  catch { throw new Error("Android push credentials are not configured."); }
  const project = env.WBD_FCM_PROJECT_ID?.trim() || account.project_id;
  if (!account.client_email || !account.private_key || !project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) {
    throw new Error("Android push credentials are incomplete.");
  }
  return { client_email: account.client_email, private_key: account.private_key, project_id: project };
}
function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function fcmAccessToken(env: FCMEnvironment, fetcher: typeof fetch = fetch): Promise<string> {
  const account = fcmConfiguration(env);
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const input = `${header}.${claims}`;
  let key: CryptoKey;
  try {
    const raw = atob(account.private_key.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""));
    key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(raw, char => char.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch { throw new Error("The Android push signing key could not be loaded."); }
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST", redirect: "error", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${base64Url(new Uint8Array(signature))}` }).toString(),
  });
  if (!response.ok) throw new Error("Android push authentication is unavailable.");
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Android push authentication returned no access token.");
  return payload.access_token;
}

export async function sendFCMLeagueNotification(
  env: FCMEnvironment, token: string, event: LeagueNotificationEvent, competitionID: string | null,
  accessToken: string, mediaURL?: string, customCopy?: { title: string; body: string }, fetcher: typeof fetch = fetch,
): Promise<Response> {
  const { project_id } = fcmConfiguration(env);
  const copy = customCopy ?? leagueNotificationCopy(event);
  return fetcher(`https://fcm.googleapis.com/v1/projects/${project_id}/messages:send`, {
    method: "POST", redirect: "error", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token, android: { priority: "HIGH", ttl: "3600s" }, data: {
      title: copy.title, body: copy.body, ...(event === "general_announcement" ? {} : { route: "league/odogwu" }), event,
      ...(competitionID ? { competition_id: competitionID } : {}), ...(mediaURL ? { media_url: mediaURL } : {}),
    } } }),
  });
}
export async function shouldRemovePushToken(platform: string, response: Response): Promise<boolean> {
  if (platform === "ios") return response.status === 410;
  if (platform !== "android" || response.ok) return false;
  try {
    const payload = await response.clone().json() as { error?: { details?: { "@type"?: string; errorCode?: string }[] } };
    return payload.error?.details?.some(value => value["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" && value.errorCode === "UNREGISTERED") ?? false;
  } catch { return false; }
}

export function leagueNotificationCopy(event: LeagueNotificationEvent): { title: string; body: string } {
return event === "general_announcement"
    ? { title: "WetinBeDis", body: "Open WetinBeDis for more ways to play." }
    : event === "starts_soon"
    ? {
        title: "Odogwu League starts soon 🏆",
        body: "A fresh 12-card round opens shortly. Get your phone and gist ready.",
      }
    : event === "started"
    ? {
        title: "Odogwu League don open 🏆",
        body: "Your chance to climb the leaderboard is live. Enter before the window closes.",
      }
    : event === "closing_soon"
      ? {
          title: "Odogwu League dey close soon ⏳",
          body: "You have 2 minutes left. Enter and complete your 12-card round before entries close.",
        }
      : event === "closed"
        ? {
        title: "Odogwu League entries don close",
        body: "The provisional table is now available. Final standings are still under review.",
        }
        : event === "provisional_results"
          ? {
            title: "Provisional Odogwu table is ready 📊",
            body: "See the current standings now. Positions may change during final review.",
          }
        : event === "results_ready"
          ? {
            title: "Odogwu League results are ready 🏆",
            body: "The round has been reviewed. Open the app to see the confirmed standings.",
          }
        : event === "payout_details_required"
          ? {
            title: "Submit your Odogwu payout details 🏆",
            body: "Your reviewed result is in the prize zone. Open the app to submit details securely.",
          }
        : event === "payout_submitted"
          ? { title: "Payout details received", body: "Your payout details are under manual review." }
        : event === "payout_approved"
          ? { title: "Payout approved ✅", body: "Your Odogwu payout has been approved for release." }
        : event === "payout_sent"
          ? { title: "Payout sent 🎉", body: "Your Odogwu payout has been sent. Check your Nigerian bank account." }
        : event === "payout_failed"
          ? { title: "Payout needs attention", body: "Your payout could not be completed. Open the app for next steps." }
        : { title: "Payout cancelled", body: "Your payout was cancelled. Open the app or contact support for help." };
}
