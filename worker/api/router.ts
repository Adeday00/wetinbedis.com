import { playIntegrityConfiguration, playIntegrityRequestHash, verifyPlayIntegrityToken, PlayIntegrityError, type PlayIntegrityEnv } from "./google-play-integrity";
import { claimAttemptDeviceBinding } from "./attempt-device-binding";
import { fcmAccessToken, fcmConfiguration, leagueNotificationCopy, sendFCMLeagueNotification, shouldRemovePushToken, type LeagueNotificationEvent } from "./push-delivery";
import {
  API_VERSION,
  CompetitionDomainError,
  canonicalCompetitionPack,
  canonicalSubmission,
  publicCompetitionCard,
  rankLeaderboard,
  scoreServerTimedSubmission,
  scoreSubmission,
  validateCompetitionPack,
  type CompetitionCard,
  type LeaderboardScore,
  type ServerTimedAnswer,
  type SubmittedAnswer,
} from "./domain";
import {
  createBase64UrlNonce,
  createOpaqueToken,
  decryptPushToken,
  decryptConfidentialPayload,
  encryptConfidentialPayload,
  encryptPushToken,
  sha256Hex,
  signPlayOnCallTicket,
  verifyPlayOnCallTicket,
} from "./crypto";
import { getPhoneVerificationProvider } from "./phone-verification";
import bundledPublicRelease from "../../content/releases/2026-W35-r1.json";
import bundledCompetitionPractice from "../../content/competition-practice-fixture.json";
import bundledPartyDeckCatalog from "../../content/party-deck-catalog.json";
import {
  PARTY_DECK_KIND,
  REMOTE_CONTENT_SCHEMA_VERSION,
  SOLO_GIST_KIND,
  validateAndPrepareContentRelease,
  type PreparedContentRelease,
} from "./content";
import {
  validateCompetitionIsolation,
  type PublicContentDocuments,
} from "./content-isolation";
import {
  createPlayOnCallRoomCode,
  normalizePlayOnCallDisplayName,
  normalizePlayOnCallRoomCode,
  PLAY_ON_CALL_TICKET_TTL_MS,
  type PlayOnCallMode,
} from "../play-on-call-protocol";
import {
  safeDefaultAppConfig,
  validateAppConfig,
  type AppConfigDocument,
} from "./app-config";
import { resolveLeagueSchedule } from "./league-schedule";
import {
  base64,
  cashAnswerBinding,
  decodeBase64Url,
  sha256HexBytes,
  verifyAppAttestCashAnswer,
  verifyAppAttestRegistration,
  type AppAttestEnvironment,
} from "./apple-app-attest";
import { appleAuthorization, appleCallback, appleLogout, appleSession, appleStart } from "./apple-auth";

export interface ApiEnv extends PlayIntegrityEnv {
  DB?: D1Database;
  PLAY_ON_CALL_ROOMS?: DurableObjectNamespace;
  WBD_CONTENT_ADMIN_TOKEN?: string;
  WBD_CARD_PREVIEW_TOKEN?: string;
  WBD_CONTENT_ADMIN_USER_IDS?: string;
  WBD_CONTENT_ADMIN_EMAILS?: string;
  WBD_APPLE_TEAM_ID?: string;
  WBD_APPLE_KEY_ID?: string;
  WBD_APPLE_CLIENT_ID?: string;
  WBD_APPLE_PRIVATE_KEY?: string;
  WBD_ADMIN_SESSION_SECRET?: string;
  WBD_APPLE_ALLOWED_EMAILS?: string;
  WBD_APPLE_ALLOWED_SUBS?: string;
  WBD_PUSH_TOKEN_ENCRYPTION_SECRET?: string;
  WBD_PAYOUT_DATA_ENCRYPTION_SECRET?: string;
  WBD_APNS_KEY_ID?: string;
  WBD_APNS_TEAM_ID?: string;
  WBD_APNS_PRIVATE_KEY?: string;
  WBD_APNS_BUNDLE_ID?: string;
  WBD_APNS_HOST?: string;
  WBD_FCM_SERVICE_ACCOUNT_JSON?: string;
  WBD_FCM_PROJECT_ID?: string;
  WBD_PLAY_ON_CALL_SIGNING_SECRET?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  FIREBASE_WEB_API_KEY?: string;
  WBD_GOOGLE_REVIEW_ACCESS_CODE?: string;
  /** Expected iOS App ID, for example TEAMID.com.example.app. */
  WBD_APP_ATTEST_APP_ID?: string;
  /** `development` for physical-Xcode QA and `production` for TestFlight. */
  WBD_APP_ATTEST_ENVIRONMENT?: string;
  /** Set to `true` only after owner approval explicitly adds Android to prize-entry scope. */
  WBD_ANDROID_CASH_ENTRY_ENABLED?: string;
}

async function registerAppAttestKey(
  request: Request,
  env: ApiEnv,
  attemptId: string,
): Promise<Response> {
  const { appID, environment } = appAttestConfiguration(env);
  const db = database(env);
  const player = await authenticate(request, db);
  const attemptToken = request.headers.get("x-wbd-attempt-token") ?? "";
  if (!/^wbd_a_[A-Za-z0-9_-]{40,80}$/.test(attemptToken)) {
    throw new ApiError(401, "attempt_token_required", "The signed attempt token is required.");
  }
  const proof = requiredAppAttestation(await readJsonObject(request));
  const challenge = await db
    .prepare(
      `SELECT c.challenge_b64, c.expires_at
       FROM app_attest_challenges c
       JOIN attempts a ON a.id = c.attempt_id
       WHERE c.id = ?1 AND c.player_id = ?2 AND c.attempt_id = ?3
         AND c.purpose = 'registration' AND c.consumed_at IS NULL
         AND a.attempt_token_hash = ?4 AND a.status = 'started'
       LIMIT 1`,
    )
    .bind(proof.challengeID, player.id, attemptId, await sha256Hex(attemptToken))
    .first<{ challenge_b64: string; expires_at: number }>();
  if (!challenge || challenge.expires_at <= Date.now()) {
    throw new ApiError(409, "app_attest_challenge_invalid", "This device-verification challenge is no longer valid.");
  }
  const nonce = decodeBase64Url(challenge.challenge_b64);
  if (!nonce) {
    throw new ApiError(503, "app_attest_challenge_corrupt", "Device verification could not continue.");
  }
  let verified: Awaited<ReturnType<typeof verifyAppAttestRegistration>>;
  try {
    verified = await verifyAppAttestRegistration({
      appID,
      environment,
      keyID: proof.keyID,
      challenge: nonce,
      attestationObject: proof.attestationObject,
    });
  } catch {
    throw new ApiError(403, "app_attestation_invalid", "This device could not be verified.");
  }

  const now = Date.now();
  const consumed = await db
    .prepare(
      `UPDATE app_attest_challenges
       SET consumed_at = ?2
       WHERE id = ?1 AND consumed_at IS NULL AND expires_at > ?2
       RETURNING id`,
    )
    .bind(proof.challengeID, now)
    .first<{ id: string }>();
  if (!consumed) {
    throw new ApiError(409, "app_attest_challenge_replayed", "This device-verification challenge was already used.");
  }
  const timing = await db
    .prepare(
      `SELECT c.question_count, c.per_card_limit_ms, c.upload_grace_ms
       FROM attempts a JOIN competitions c ON c.id = a.competition_id
       WHERE a.id = ?1 AND a.player_id = ?2 AND a.status = 'started'
       LIMIT 1`,
    )
    .bind(attemptId, player.id)
    .first<{ question_count: number; per_card_limit_ms: number; upload_grace_ms: number }>();
  if (!timing) {
    throw new ApiError(409, "cash_attempt_required", "This cash attempt is not active.");
  }
  // Registration happens before a cash card is released. Rebase the official
  // clock now so App Attest never consumes a player's 12 × 12 second round.
  const clockOrigin = await claimAttemptDeviceBinding(db, attemptId, player.id, "ios-app-attest", now);
  const playDeadlineAt = clockOrigin + timing.question_count * timing.per_card_limit_ms;
  const submitDeadlineAt = playDeadlineAt + timing.upload_grace_ms;
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE app_attest_keys
           SET revoked_at = ?2, updated_at = ?2
           WHERE player_id = ?1 AND revoked_at IS NULL AND key_id <> ?3`,
        )
        .bind(player.id, now, proof.keyID),
      db
        .prepare(
        `INSERT INTO app_attest_keys (
          key_id, player_id, app_id, environment, public_key_pem,
          assertion_counter, receipt_b64, attested_at, last_verified_at,
          revoked_at, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, NULL, ?8, ?8)`,
      )
      .bind(
        proof.keyID,
        player.id,
        appID,
        environment,
        verified.publicKeyPem,
        verified.signCount,
        base64(verified.receipt),
        now,
      ),
      db
        .prepare(
          `UPDATE attempts
           SET started_at = ?2, play_deadline_at = ?3, submit_deadline_at = ?4,
               updated_at = ?2
           WHERE id = ?1 AND status = 'started'`,
        )
        .bind(attemptId, clockOrigin, playDeadlineAt, submitDeadlineAt),
      db
        .prepare(
          `UPDATE attempt_card_issues
           SET issued_at = ?2
           WHERE attempt_id = ?1 AND ordinal = 1 AND answered_at IS NULL`,
        )
        .bind(attemptId, clockOrigin),
    ]);
  } catch {
    // An attestation key must never be treated as registered locally unless
    // its public key and counter were both durably stored by the Worker.
    throw new ApiError(409, "app_attest_key_registration_failed", "Device verification could not be saved. Register a new device key.");
  }

  return json({
    device: {
      status: "verified",
      key_id: proof.keyID,
      environment,
      verified_at: now,
    },
  }, 201);
}

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type AuthenticatedPlayer = {
  id: string;
  publicHandle: string;
  accountState: string;
  phoneVerifiedAt: number | null;
  countryCode: string | null;
  eligibilityStatus: string;
  acceptedRulesVersion: string | null;
};

type NotificationPreferences = {
  leagueUpdatesEnabled: boolean;
  friendInvitesEnabled: boolean;
  offersEnabled: boolean;
};

type CompetitionRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  content_status: string;
  rules_version: string;
  pack_version: string;
  scoring_version: string;
  question_count: number;
  per_card_limit_ms: number;
  upload_grace_ms: number;
  entry_mode: string;
  eligible_countries_json?: string | null;
  country_code: string;
  minimum_age: number;
  currency: string;
  opens_at: number;
  closes_at: number;
  score_review_closes_at: number;
};

type CardRow = {
  id: string;
  source_card_id: string;
  position: number;
  content_version: string;
  category: string;
  answer_family: string;
  clues_json: string;
  correct_option_id: string;
  difficulty: "standard" | "hard";
  editorial_status: string;
  voided_at: number | null;
};

type OptionRow = {
  card_id: string;
  option_id: string;
  position: number;
  label: string;
  category: string;
  answer_family: string;
};

type AttemptRow = {
  id: string;
  competition_id: string;
  competition_slug: string;
  status: string;
  rules_version: string;
  pack_version: string;
  pack_hash: string | null;
  scoring_version: string;
  delivery_protocol: "practice_batch_v1" | "cash_sequential_v1";
  current_rules_version: string;
  current_pack_version: string;
  current_scoring_version: string;
  started_at: number;
  play_deadline_at: number;
  submit_deadline_at: number;
  submitted_at: number | null;
  correct_count: number | null;
  adjusted_total_ms: number | null;
  hard_card_ms: number | null;
  score_status: string;
  question_count: number;
  per_card_limit_ms: number;
  upload_grace_ms: number;
};

type AttemptCardIssueRow = {
  ordinal: number;
  card_id: string;
  issued_at: number;
  answered_at: number | null;
};

type ServerTimedAttemptAnswerRow = AttemptCardIssueRow & {
  selected_option_id: string;
};

type ContentReleaseRow = {
  id: string;
  revision: number;
  schema_version: number;
  status: "published" | "superseded" | "revoked";
  effective_week_wat: string;
  effective_from_ms: number;
  expires_at_ms: number;
  minimum_app_version: string;
  sponsor_kind: "commercial" | "prizeFunding" | null;
  sponsor_name: string | null;
  sponsor_message: string | null;
  sponsor_campaign_title: string | null;
  sponsor_logo_url: string | null;
  published_by: string;
  published_at: number;
};

type ContentAssetRow = {
  release_id: string;
  kind: "party_deck" | "solo_gist";
  content_version: string;
  sha256: string;
  byte_count: number;
  item_count: number;
  payload_json: string;
};

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_CONTENT_JSON_BYTES = 2 * 1024 * 1024;
const PARTY_DECK_EDITOR_ID = "current";
const PARTY_DECK_EDITOR_MIN_CARDS = 350;
const PARTY_DECK_EDITOR_MAX_CARDS = 2_000;
const PARTY_DECK_EDITOR_CATEGORY_ALIASES = new Map([
  ["Afrobeats Songs", "Music"],
  ["Street & Hustle", "Naija Life"],
  ["Festive", "Celebrations"],
  ["Wetin Dey Trend", "Trending Now"],
]);
const REQUIRED_CASH_LAUNCH_GATES = [
  "official_rules_and_eligibility",
  "phone_verification",
  "ios_app_attest",
  "android_play_integrity",
  "trusted_timing_and_private_content",
  "fraud_review_operations",
  "payout_operations_and_funding",
  "privacy_retention_and_deletion",
  "production_tests_and_incident_response",
] as const;
type CashLaunchGateKey = (typeof REQUIRED_CASH_LAUNCH_GATES)[number];
const APP_ATTEST_CHALLENGE_TTL_MS = 2 * 60 * 1_000;
// This exact, temporary competition is allowed to exercise the server-backed
// cash UI and sequential timing without enabling payouts. Remove the database
// competition after device QA; never reuse this exception for a public event.
const SERVER_REHEARSAL_SLUG = "gist-league-internal-rehearsal";
const LEAGUE_PER_CARD_LIMIT_MS = 8_000;
const ODOGWU_ELIGIBLE_COUNTRIES = ["US", "NG", "CA", "GB"] as const;
const MAX_LEADERBOARD_ROWS = 10_000;
const PUBLIC_LEADERBOARD_ROWS = 100;
const GOOGLE_PLAY_PACKAGE_NAME = "com.davidadekanbi.wetinbedis";
const GOOGLE_PLAY_PRODUCT_ID = "com.davidadekanbi.wetinbedis.fullgist";

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function etagMatches(request: Request, etag: string): boolean {
  const candidates = (request.headers.get("if-none-match") ?? "")
    .split(",")
    .map((value) => value.trim());
  return candidates.includes("*") || candidates.includes(etag);
}

function cacheableJsonResponse(
  request: Request,
  body: unknown,
  options: {
    etag: string;
    cacheControl: string;
    lastModifiedMs?: number;
    extraHeaders?: Record<string, string>;
  },
): Response {
  const headers = new Headers({
    "cache-control": options.cacheControl,
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    etag: options.etag,
    ...options.extraHeaders,
  });
  if (options.lastModifiedMs) {
    headers.set("last-modified", new Date(options.lastModifiedMs).toUTCString());
  }
  if (etagMatches(request, options.etag)) return new Response(null, { status: 304, headers });
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof PlayIntegrityError) error = new ApiError(error.status, error.code, error.message);
  if (error instanceof ApiError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        request_id: requestId,
      },
      error.status,
      { "x-request-id": requestId },
    );
  }

  if (error instanceof CompetitionDomainError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        request_id: requestId,
      },
      400,
      { "x-request-id": requestId },
    );
  }

  console.error("Wetin Be Dis API error", { requestId, error });
  return json(
    {
      error: {
        code: "internal_error",
        message: "The request could not be completed.",
      },
      request_id: requestId,
    },
    500,
    { "x-request-id": requestId },
  );
}

function database(env: ApiEnv): D1Database {
  if (!env.DB) {
    throw new ApiError(
      503,
      "database_unavailable",
      "The competition database is not configured for this environment.",
    );
  }
  return env.DB;
}

function allowlist(value: string | undefined, normalizeCase = false): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => (normalizeCase ? entry.toLocaleLowerCase("en-US") : entry)),
  );
}

type ContentAdminAuthorization = {
  publishedBy: string;
  method: "bearer" | "siwc" | "apple";
};

async function authorizeCardPreview(request: Request, env: ApiEnv): Promise<ContentAdminAuthorization> {
  const authorization = request.headers.get("authorization") ?? "";
  const tokenMatch = /^Bearer (.{16,512})$/.exec(authorization);
  if (!tokenMatch) {
    throw new ApiError(401, "card_preview_authentication_required", "Owner card preview access is not configured for this device.");
  }
  const suppliedHash = await sha256Hex(tokenMatch[1]);
  let accepted = false;
  try {
    const active = await database(env).prepare(`SELECT token_hash FROM owner_card_preview_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`).first<{ token_hash: string }>();
    accepted = active?.token_hash === suppliedHash;
  } catch {
    // Older deployments can use the Worker secret until the migration is applied.
    const configuredToken = env.WBD_CARD_PREVIEW_TOKEN?.trim();
    accepted = Boolean(configuredToken && await sha256Hex(configuredToken) === suppliedHash);
  }
  if (!accepted) {
    throw new ApiError(403, "card_preview_forbidden", "This device is not authorized to preview League cards.");
  }
  return { publishedBy: "card-preview-owner", method: "bearer" };
}

async function recordAdminAudit(
  db: D1Database,
  authorization: ContentAdminAuthorization,
  action: string,
  resourceType: string,
  resourceID: string | null,
  note: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.prepare(`INSERT INTO admin_audit_log
    (id, actor, action, resource_type, resource_id, note, details_json, changed_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(crypto.randomUUID(), authorization.publishedBy, action, resourceType, resourceID, note.slice(0, 2_000), JSON.stringify(details), Date.now())
    .run();
}

async function listAdminAudit(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 500);
  const resourceType = url.searchParams.get("resource_type")?.trim() ?? "";
  const db = database(env);
  const result = await db.prepare(`SELECT id, actor, action, resource_type, resource_id, note, details_json, changed_at
    FROM admin_audit_log ${resourceType ? "WHERE resource_type = ?1" : ""}
    ORDER BY changed_at DESC LIMIT ?${resourceType ? "2" : "1"}`)
    .bind(...(resourceType ? [resourceType, limit] : [limit])).all();
  return json({ audit: result.results ?? [] });
}

async function authorizeContentAdmin(
  request: Request,
  env: ApiEnv,
): Promise<ContentAdminAuthorization> {
  const apple = await appleAuthorization(request, env);
  if (apple) return { publishedBy: `apple:${apple.sub}`, method: "apple" };
  const configuredToken = env.WBD_CONTENT_ADMIN_TOKEN?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const tokenMatch = /^Bearer (.{16,512})$/.exec(authorization);
  if (configuredToken && tokenMatch) {
    const [expectedHash, suppliedHash] = await Promise.all([
      sha256Hex(configuredToken),
      sha256Hex(tokenMatch[1]),
    ]);
    if (expectedHash === suppliedHash) {
      return { publishedBy: "content-cli", method: "bearer" };
    }
  }

  const allowedUserIDs = allowlist(env.WBD_CONTENT_ADMIN_USER_IDS);
  const allowedEmails = allowlist(env.WBD_CONTENT_ADMIN_EMAILS, true);
  const userID = request.headers.get("oai-authenticated-user-id")?.trim() ?? "";
  const email =
    request.headers
      .get("oai-authenticated-user-email")
      ?.trim()
      .toLocaleLowerCase("en-US") ?? "";

  if (!configuredToken && allowedUserIDs.size === 0 && allowedEmails.size === 0 && !env.WBD_ADMIN_SESSION_SECRET) {
    throw new ApiError(
      503,
      "content_admin_unconfigured",
      "Content publishing is not configured for this environment.",
    );
  }
  if (!userID || !email) {
    throw new ApiError(
      401,
      "content_admin_authentication_required",
      "Sign in with the approved owner account to manage content.",
    );
  }
  if (!allowedUserIDs.has(userID) && !allowedEmails.has(email)) {
    throw new ApiError(
      403,
      "content_admin_forbidden",
      "This account is not allowed to publish game content.",
    );
  }
  return { publishedBy: `chatgpt:${userID}`, method: "siwc" };
}

function assertContentAdminOrigin(
  request: Request,
  authorization: ContentAdminAuthorization,
): void {
  if (authorization.method === "bearer") return;
  const suppliedOrigin = request.headers.get("origin");
  const expectedOrigin = new URL(request.url).origin;
  if (suppliedOrigin === expectedOrigin) return;
  if (!suppliedOrigin) {
    const referer = request.headers.get("referer");
    if (referer) {
      try {
        if (new URL(referer).origin === expectedOrigin) return;
      } catch {
        // Treat malformed referrers as untrusted below.
      }
    }
  }
  {
    throw new ApiError(
      403,
      "content_admin_origin_invalid",
      "Content changes must be submitted from the owner console.",
    );
  }
}

/**
 * A shared command-line token is useful for content automation, but every
 * cash movement must have an individually attributable operator. Otherwise a
 * single copied token could impersonate both creator and approver.
 */
function assertIndividualPayoutOperator(authorization: ContentAdminAuthorization): void {
  if (authorization.method === "bearer") {
    throw new ApiError(
      409,
      "payout_individual_operator_required",
      "Cash payout actions require an individually attributable approved owner account, not the shared content token.",
    );
  }
}

async function readJsonObject(
  request: Request,
  options: {
    optional?: boolean;
    maximumBytes?: number;
    requireApplicationJSON?: boolean;
  } = {},
): Promise<Record<string, unknown>> {
  const maximumBytes = options.maximumBytes ?? MAX_JSON_BYTES;
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = Number(contentLengthHeader ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new ApiError(413, "payload_too_large", "The JSON payload is too large.");
  }
  if (options.requireApplicationJSON) {
    const mediaType = (request.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLocaleLowerCase("en-US");
    if (mediaType !== "application/json") {
      throw new ApiError(
        415,
        "content_type_invalid",
        "Use application/json for content changes.",
      );
    }
  }

  if (request.body === null && options.optional) return {};

  let value: unknown;
  try {
    if (request.body === null) {
      throw new Error("missing body");
    }
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel("payload_too_large");
        throw new ApiError(413, "payload_too_large", "The JSON payload is too large.");
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.optional && contentLength === 0) return {};
    throw new ApiError(400, "invalid_json", "A valid JSON object is required.");
  }

  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ApiError(400, "invalid_json", "A valid JSON object is required.");
  }
  return value as Record<string, unknown>;
}

function apiPath(pathname: string): string {
  // Native clients should use URL composition rather than string concatenation,
  // but normalizing repeated separators here keeps a harmless trailing slash in
  // a configured base URL from turning an authenticated API request into a 404.
  const normalized = pathname.replace(/\/{2,}/g, "/");
  if (normalized === "/api/v1/") return "/api/v1";
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function assertMethod(request: Request, expected: string): void {
  if (request.method !== expected) {
    throw new ApiError(405, "method_not_allowed", `Use ${expected} for this endpoint.`);
  }
}

async function authenticate(
  request: Request,
  db: D1Database,
): Promise<AuthenticatedPlayer> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{20,160})$/.exec(authorization);
  if (!match) {
    throw new ApiError(401, "authentication_required", "A valid player session is required.");
  }

  const tokenHash = await sha256Hex(match[1]);
  const now = Date.now();
  const row = await db
    .prepare(
      `SELECT
        p.id,
        p.public_handle,
        p.account_state,
        p.phone_verified_at,
        p.country_code,
        p.eligibility_status,
        p.accepted_rules_version
      FROM player_sessions s
      JOIN players p ON p.id = s.player_id
      WHERE s.token_hash = ?1
        AND s.revoked_at IS NULL
        AND s.expires_at > ?2
        AND p.account_state != 'suspended'
      LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first<{
      id: string;
      public_handle: string;
      account_state: string;
      phone_verified_at: number | null;
      country_code: string | null;
      eligibility_status: string;
      accepted_rules_version: string | null;
    }>();

  if (!row) {
    throw new ApiError(401, "invalid_session", "The player session is invalid or expired.");
  }

  return {
    id: row.id,
    publicHandle: row.public_handle,
    accountState: row.account_state,
    phoneVerifiedAt: row.phone_verified_at,
    countryCode: row.country_code,
    eligibilityStatus: row.eligibility_status,
    acceptedRulesVersion: row.accepted_rules_version,
  };
}

type FirebaseIdentity = { uid: string; phoneNumber: string };

async function verifyFirebaseIDToken(token: string, env: ApiEnv): Promise<FirebaseIdentity> {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new ApiError(401, "invalid_firebase_token", "The Firebase sign-in token is invalid.");
  }
  const apiKey = env.FIREBASE_WEB_API_KEY;
  if (!apiKey) throw new ApiError(503, "firebase_verifier_misconfigured", "Firebase verification is not configured yet.");
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: token }),
  });
  if (!response.ok) throw new ApiError(401, "invalid_firebase_token", "The Firebase sign-in token could not be verified.");
  const payload = await response.json() as { users?: Array<{ localId?: string; phoneNumber?: string }> };
  const identity = payload.users?.[0];
  if (!identity?.localId || !identity.phoneNumber) throw new ApiError(401, "phone_verification_required", "A verified phone account is required.");
  return { uid: identity.localId, phoneNumber: identity.phoneNumber };
}

async function linkFirebaseLeagueProfile(request: Request, env: ApiEnv): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const firebaseToken = request.headers.get("x-firebase-id-token") ?? "";
  const identity = await verifyFirebaseIDToken(firebaseToken, env);
  const payload = await readJsonObject(request, { maximumBytes: 8_000, requireApplicationJSON: true });
  const displayName = typeof payload.display_name === "string" ? payload.display_name.trim() : "";
  const suppliedCountryCode = typeof payload.country_code === "string" ? payload.country_code.trim().toUpperCase() : "";
  const countryCode = suppliedCountryCode === "UK" ? "GB" : suppliedCountryCode;
  const rulesVersion = typeof payload.rules_version === "string" ? payload.rules_version.trim() : "";
  const eligibilityAttestation = payload.eligibility_attestation;
  if (!/^[A-Za-z0-9_ .'-]{2,24}$/.test(displayName)) throw new ApiError(400, "invalid_display_name", "Choose a 2–24 character public display name.");
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new ApiError(400, "invalid_country", "Country must use a two-letter country code.");
  if (!rulesVersion) throw new ApiError(400, "rules_acceptance_required", "The current League rules must be accepted.");
  if (
    !eligibilityAttestation || Array.isArray(eligibilityAttestation) || typeof eligibilityAttestation !== "object"
    || (eligibilityAttestation as Record<string, unknown>).minimum_age_confirmed !== true
    || (eligibilityAttestation as Record<string, unknown>).location_confirmed !== true
  ) {
    throw new ApiError(
      400,
      "eligibility_attestation_required",
      "Confirm the published age and location requirements before joining the League.",
    );
  }
  const normalizedUsername = displayName.toLocaleLowerCase("en-US");
  const now = Date.now();
  const existing = await db.prepare(`SELECT player_id FROM username_registry WHERE normalized_username = ?1 LIMIT 1`).bind(normalizedUsername).first<{ player_id: string }>();
  if (existing && existing.player_id !== player.id) throw new ApiError(409, "username_unavailable", "That username is already taken.");
  try {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO username_registry (normalized_username, player_id, claimed_at) VALUES (?1, ?2, ?3)`).bind(normalizedUsername, player.id, now),
      // League entry is immediate after phone verification, rules acceptance,
      // and the age/location attestation. Fraud, score-integrity, and payout
      // checks remain server-side and happen before any prize is confirmed.
      db.prepare(`UPDATE players SET public_handle = ?1, firebase_uid = ?2, phone_lookup_hash = ?3, phone_verified_at = ?4, account_state = 'phone_verified', country_code = ?5, eligibility_status = 'eligible', accepted_rules_version = ?6, eligibility_attested_at = ?4, updated_at = ?4 WHERE id = ?7`).bind(displayName, identity.uid, await sha256Hex(identity.phoneNumber), now, countryCode, rulesVersion, player.id),
    ]);
  } catch (error) {
    throw new ApiError(409, "username_unavailable", "That username is already taken.", { cause: String(error) });
  }
  return json({ profile: { public_handle: displayName, country_code: countryCode, verification_level: "phone_verified", eligibility_status: "eligible", accepted_rules_version: rulesVersion } });
}

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemBytes(pem: string): ArrayBuffer {
  const encoded = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function googlePlayAccessToken(env: ApiEnv): Promise<string> {
  if (!env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
    throw new ApiError(503, "billing_verifier_misconfigured", "Google Play purchase verification is not configured yet.");
  }
  let account: { client_email?: string; private_key?: string };
  try {
    account = JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) as typeof account;
  } catch {
    throw new ApiError(503, "billing_verifier_misconfigured", "The Google Play verifier credentials are invalid.");
  }
  if (!account.client_email || !account.private_key) {
    throw new ApiError(503, "billing_verifier_misconfigured", "The Google Play verifier credentials are incomplete.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemBytes(account.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new ApiError(503, "billing_verifier_misconfigured", "The Google Play verifier key could not be loaded.");
  }
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(`${signingInput}.${base64Url(new Uint8Array(signature))}`)}`,
  });
  if (!tokenResponse.ok) {
    throw new ApiError(502, "billing_verifier_unavailable", "Google Play verification is temporarily unavailable.");
  }
  const payload = await tokenResponse.json() as { access_token?: string };
  if (!payload.access_token) throw new ApiError(502, "billing_verifier_unavailable", "Google Play did not return a verifier token.");
  return payload.access_token;
}

async function googleReviewAccess(request: Request, env: ApiEnv): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const body = await readJsonObject(request, { maximumBytes: 1024, requireApplicationJSON: true });
  const configured = env.WBD_GOOGLE_REVIEW_ACCESS_CODE?.trim();
  if (!configured || configured.length < 24) {
    throw new ApiError(503, "review_access_unavailable", "Review access is temporarily unavailable.");
  }
  const codeHash = await sha256Hex(configured);
  if (body.code !== undefined) {
    if (typeof body.code !== "string" || body.code.trim().length > 128 || await sha256Hex(body.code.trim()) !== codeHash) {
      throw new ApiError(403, "review_code_invalid", "The review access code is incorrect.");
    }
    await db.prepare(`INSERT INTO google_review_access (player_id, code_hash, granted_at)
      VALUES (?1, ?2, ?3) ON CONFLICT(player_id) DO UPDATE SET code_hash = excluded.code_hash, granted_at = excluded.granted_at`)
      .bind(player.id, codeHash, Date.now()).run();
  }
  const grant = await db.prepare("SELECT code_hash FROM google_review_access WHERE player_id = ?1 LIMIT 1")
    .bind(player.id).first<{ code_hash: string }>();
  return json({ entitlement: { product_id: GOOGLE_PLAY_PRODUCT_ID, active: grant?.code_hash === codeHash, source: "google_review", verified_at: Date.now() } });
}

async function verifyGooglePlayPurchase(request: Request, env: ApiEnv): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const body = await readJsonObject(request, { maximumBytes: 16_000, requireApplicationJSON: true });
  const productId = typeof body.product_id === "string" ? body.product_id : "";
  const purchaseToken = typeof body.purchase_token === "string" ? body.purchase_token.trim() : "";
  if (productId !== GOOGLE_PLAY_PRODUCT_ID || purchaseToken.length < 20 || purchaseToken.length > 4096) {
    throw new ApiError(400, "purchase_invalid", "The Google Play purchase details are invalid.");
  }

  const tokenHash = await sha256Hex(purchaseToken);
  const existing = await db.prepare("SELECT player_id FROM google_play_purchases WHERE token_hash = ?1 LIMIT 1").bind(tokenHash).first<{ player_id: string }>();
  if (existing && existing.player_id !== player.id) {
    throw new ApiError(409, "purchase_already_linked", "This purchase is already linked to another player.");
  }

  const accessToken = await googlePlayAccessToken(env);
  const purchaseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const googleResponse = await fetch(purchaseUrl, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!googleResponse.ok) {
    throw new ApiError(502, "purchase_verification_failed", "Google Play could not verify this purchase.");
  }
  const purchase = await googleResponse.json() as {
    purchaseState?: number;
    acknowledgementState?: number;
    orderId?: string;
  };
  const verifiedAt = Date.now();
  const active = purchase.purchaseState === 0;
  if (!active) {
    return json({ entitlement: { product_id: productId, active: false, source: "google_play", verified_at: verifiedAt } });
  }

  let acknowledgedAt: number | null = purchase.acknowledgementState === 1 ? verifiedAt : null;
  if (purchase.acknowledgementState !== 1) {
    const acknowledgement = await fetch(`${purchaseUrl}:acknowledge`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ developerPayload: "wetinbedis-fullgist-v1" }),
    });
    if (!acknowledgement.ok && acknowledgement.status !== 409) {
      throw new ApiError(502, "purchase_acknowledgement_failed", "Google Play could not finish confirming this purchase.");
    }
    acknowledgedAt = verifiedAt;
  }

  await db.batch([
    db.prepare(`INSERT INTO google_play_purchases (token_hash, player_id, product_id, package_name, order_id, purchase_state, acknowledged_at, verified_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
      ON CONFLICT(token_hash) DO UPDATE SET player_id = excluded.player_id, order_id = excluded.order_id, purchase_state = excluded.purchase_state, acknowledged_at = excluded.acknowledged_at, verified_at = excluded.verified_at, updated_at = excluded.updated_at`).bind(tokenHash, player.id, productId, GOOGLE_PLAY_PACKAGE_NAME, purchase.orderId ?? null, purchase.purchaseState ?? 0, acknowledgedAt, verifiedAt),
    db.prepare(`INSERT INTO player_entitlements (player_id, product_id, source, active, updated_at)
      VALUES (?1, ?2, 'google_play', 1, ?3)
      ON CONFLICT(player_id, product_id) DO UPDATE SET source = excluded.source, active = 1, updated_at = excluded.updated_at`).bind(player.id, productId, verifiedAt),
  ]);

  return json({ entitlement: { product_id: productId, active: true, source: "google_play", verified_at: verifiedAt } });
}

function playerPayload(player: AuthenticatedPlayer) {
  return {
    id: player.id,
    public_handle: player.publicHandle,
    verification_level: player.phoneVerifiedAt ? "phone_verified" : "guest",
    eligibility_status: player.eligibilityStatus,
    accepted_rules_version: player.acceptedRulesVersion,
  };
}

/**
 * Remove only data that has reached its declared guest-session lifetime.
 *
 * This deliberately does not touch a player that has a competition attempt
 * or a score challenge: those records can still be needed for the published
 * review window. It also does not touch a verified account. A future cash
 * competition needs its separately approved retention/deletion worker; this
 * is the safe lifecycle rule that applies to the current anonymous preview.
 */
async function pruneExpiredGuestSessions(
  db: D1Database,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare("DELETE FROM player_sessions WHERE expires_at <= ?1")
      .bind(now),
    db
      .prepare(
        `DELETE FROM players
         WHERE account_state = 'guest'
           AND NOT EXISTS (
             SELECT 1 FROM player_sessions
             WHERE player_sessions.player_id = players.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM attempts
             WHERE attempts.player_id = players.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM score_challenges
             WHERE score_challenges.player_id = players.id
           )`,
      ),
  ]);
}

async function createGuestSession(request: Request, env: ApiEnv): Promise<Response> {
  const payload = await readJsonObject(request, { optional: true });
  const platform =
    typeof payload.platform === "string" ? payload.platform.toLowerCase() : "unknown";
  if (!new Set(["ios", "android", "web", "unknown"]).has(platform)) {
    throw new ApiError(400, "invalid_platform", "Platform must be ios, android, web, or unknown.");
  }
  const appVersion =
    typeof payload.app_version === "string" ? payload.app_version.trim() : null;
  if (appVersion && appVersion.length > 50) {
    throw new ApiError(400, "invalid_app_version", "App version is too long.");
  }

  const db = database(env);
  const now = Date.now();
  await pruneExpiredGuestSessions(db, now);
  const playerId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const publicHandle = `GIST-${playerId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const sessionToken = createOpaqueToken("wbd_s");
  const sessionTokenHash = await sha256Hex(sessionToken);
  const expiresAt = now + SESSION_TTL_MS;

  await db.batch([
    db
      .prepare(
        `INSERT INTO players (
          id, public_handle, account_state, eligibility_status, created_at, updated_at
        ) VALUES (?1, ?2, 'guest', 'guest', ?3, ?3)`,
      )
      .bind(playerId, publicHandle, now),
    db
      .prepare(
        `INSERT INTO player_sessions (
          id, player_id, token_hash, platform, app_version,
          expires_at, last_seen_at, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
      )
      .bind(
        sessionId,
        playerId,
        sessionTokenHash,
        platform,
        appVersion,
        expiresAt,
        now,
      ),
  ]);

  return json(
    {
      player: {
        id: playerId,
        public_handle: publicHandle,
        verification_level: "guest",
        eligibility_status: "guest",
        accepted_rules_version: null,
      },
      session: {
        token: sessionToken,
        token_type: "Bearer",
        expires_at: expiresAt,
      },
    },
    201,
  );
}

async function getMe(request: Request, env: ApiEnv): Promise<Response> {
  const player = await authenticate(request, database(env));
  return json({ player: playerPayload(player) });
}

function playOnCallUnavailable(): Response {
  return json(
    {
      error: {
        code: "play_on_call_unavailable",
        message: "Play on a Call is not configured for this environment yet.",
      },
    },
    503,
  );
}

function playOnCallIsConfigured(env: ApiEnv): env is ApiEnv & {
  PLAY_ON_CALL_ROOMS: DurableObjectNamespace;
  WBD_PLAY_ON_CALL_SIGNING_SECRET: string;
} {
  return Boolean(
    env.PLAY_ON_CALL_ROOMS
      && env.WBD_PLAY_ON_CALL_SIGNING_SECRET
      && env.WBD_PLAY_ON_CALL_SIGNING_SECRET.trim().length >= 32,
  );
}

function playOnCallMode(value: unknown): PlayOnCallMode {
  if (value === undefined || value === "hot_seat") return "hot_seat";
  if (value === "everybody_guess" || value === "team_battle") return value;
  throw new ApiError(
    400,
    "invalid_play_on_call_mode",
    "Mode must be hot_seat, everybody_guess, or team_battle.",
  );
}

function playOnCallRequestBody(value: Record<string, unknown>): {
  displayName: string | undefined;
  mode: PlayOnCallMode;
} {
  const permitted = new Set(["display_name", "mode"]);
  if (Object.keys(value).some((key) => !permitted.has(key))) {
    throw new ApiError(
      400,
      "invalid_play_on_call_request",
      "Only display_name and mode may be supplied.",
    );
  }
  if (value.display_name !== undefined && typeof value.display_name !== "string") {
    throw new ApiError(400, "invalid_display_name", "Display name must be text.");
  }
  return { displayName: value.display_name as string | undefined, mode: playOnCallMode(value.mode) };
}

function playOnCallRoomStub(env: ApiEnv & {
  PLAY_ON_CALL_ROOMS: DurableObjectNamespace;
}, roomCode: string): DurableObjectStub {
  return env.PLAY_ON_CALL_ROOMS.get(
    env.PLAY_ON_CALL_ROOMS.idFromName(`wetin-be-dis-play-on-call-v1:${roomCode}`),
  );
}

function playOnCallProxyHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({ "content-type": "application/json", "x-wbd-call-room-proxy": "1", ...extra });
}

async function playOnCallConnection(
  request: Request,
  env: ApiEnv & {
    PLAY_ON_CALL_ROOMS: DurableObjectNamespace;
    WBD_PLAY_ON_CALL_SIGNING_SECRET: string;
  },
  roomCode: string,
  player: AuthenticatedPlayer,
  displayName: string,
): Promise<{
  room_code: string;
  connection: { ticket: string; ticket_expires_at: number; socket_url: string; player_id: string };
}> {
  const ticketExpiresAt = Date.now() + PLAY_ON_CALL_TICKET_TTL_MS;
  const ticket = await signPlayOnCallTicket(
    { roomCode, playerID: player.id, displayName, expiresAt: ticketExpiresAt },
    env.WBD_PLAY_ON_CALL_SIGNING_SECRET,
  );
  const socketURL = new URL(
    `/api/v1/call-rooms/${roomCode}/socket`,
    request.url,
  );
  socketURL.protocol = socketURL.protocol === "https:" ? "wss:" : "ws:";
  socketURL.searchParams.set("ticket", ticket);
  return {
    room_code: roomCode,
    connection: {
      ticket,
      ticket_expires_at: ticketExpiresAt,
      socket_url: socketURL.href,
      player_id: player.id,
    },
  };
}

async function createPlayOnCallRoom(request: Request, env: ApiEnv): Promise<Response> {
  if (!playOnCallIsConfigured(env)) return playOnCallUnavailable();
  const player = await authenticate(request, database(env));
  const body = playOnCallRequestBody(await readJsonObject(request, { optional: true }));
  const displayName = normalizePlayOnCallDisplayName(body.displayName, player.publicHandle);

  // The four digits are only a friendly lookup code; the signed ticket is the
  // actual short-lived capability. Retry collisions because the human-sized
  // code space is intentionally small.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const roomCode = createPlayOnCallRoomCode();
    const stub = playOnCallRoomStub(env, roomCode);
    const response = await stub.fetch(
      new Request("https://play-on-call.internal/create", {
        method: "POST",
        headers: playOnCallProxyHeaders(),
        body: JSON.stringify({
          room_code: roomCode,
          host_player_id: player.id,
          host_display_name: displayName,
          mode: body.mode,
        }),
      }),
    );
    if (response.status === 409) continue;
    if (!response.ok) {
      throw new ApiError(503, "play_on_call_room_create_failed", "The room could not be created.");
    }
    const created = await response.json() as { room?: { expiresAt?: number } };
    const connection = await playOnCallConnection(request, env, roomCode, player, displayName);
    return json({
      ...connection,
      room: { mode: body.mode, expires_at: created.room?.expiresAt ?? null },
    }, 201);
  }
  throw new ApiError(503, "play_on_call_room_code_unavailable", "Try creating the room again.");
}

async function joinPlayOnCallRoom(
  request: Request,
  env: ApiEnv,
  rawRoomCode: string,
): Promise<Response> {
  if (!playOnCallIsConfigured(env)) return playOnCallUnavailable();
  const roomCode = normalizePlayOnCallRoomCode(rawRoomCode);
  if (!roomCode) throw new ApiError(404, "room_not_found", "That room code is not valid.");
  const player = await authenticate(request, database(env));
  const body = playOnCallRequestBody(await readJsonObject(request, { optional: true }));
  const displayName = normalizePlayOnCallDisplayName(body.displayName, player.publicHandle);
  const stub = playOnCallRoomStub(env, roomCode);
  const response = await stub.fetch(
    new Request("https://play-on-call.internal/join", {
      method: "POST",
      headers: playOnCallProxyHeaders(),
      body: JSON.stringify({ player_id: player.id, display_name: displayName }),
    }),
  );
  if (response.status === 410) throw new ApiError(410, "room_unavailable", "That room ended or expired.");
  if (response.status === 409) throw new ApiError(409, "room_full_or_closed", "That room is full or closed.");
  if (!response.ok) throw new ApiError(503, "play_on_call_room_join_failed", "Could not join that room.");
  const joined = await response.json() as { room?: { mode?: PlayOnCallMode; expiresAt?: number } };
  const connection = await playOnCallConnection(request, env, roomCode, player, displayName);
  return json({
    ...connection,
    room: {
      mode: joined.room?.mode ?? body.mode,
      expires_at: joined.room?.expiresAt ?? null,
    },
  });
}

async function connectPlayOnCallRoom(
  request: Request,
  env: ApiEnv,
  rawRoomCode: string,
): Promise<Response> {
  if (!playOnCallIsConfigured(env)) return playOnCallUnavailable();
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new ApiError(426, "websocket_upgrade_required", "Use a WebSocket connection for this room.");
  }
  const roomCode = normalizePlayOnCallRoomCode(rawRoomCode);
  if (!roomCode) throw new ApiError(404, "room_not_found", "That room code is not valid.");
  const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
  const verified = await verifyPlayOnCallTicket(ticket, env.WBD_PLAY_ON_CALL_SIGNING_SECRET);
  if (!verified || verified.roomCode !== roomCode) {
    throw new ApiError(401, "invalid_room_ticket", "That room connection expired. Join the room again.");
  }
  const headers = new Headers(request.headers);
  headers.set("x-wbd-call-room-proxy", "1");
  headers.set("x-wbd-call-room-player-id", verified.playerID);
  headers.set("x-wbd-call-room-display-name", verified.displayName);
  return playOnCallRoomStub(env, roomCode).fetch(new Request(request, { headers }));
}

function projectToTVStub(env: ApiEnv & { PLAY_ON_CALL_ROOMS: DurableObjectNamespace }, sessionID: string): DurableObjectStub {
  return env.PLAY_ON_CALL_ROOMS.get(
    env.PLAY_ON_CALL_ROOMS.idFromName(`wetin-be-dis-project-to-tv-v1:${sessionID}`),
  );
}

async function createProjectToTVSession(request: Request, env: ApiEnv): Promise<Response> {
  if (!playOnCallIsConfigured(env)) return playOnCallUnavailable();
  await authenticate(request, database(env));
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const ownerToken = createBase64UrlNonce(32);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const random = crypto.getRandomValues(new Uint8Array(4));
    const pairingCode = [...random].map((byte) => alphabet[byte & 31]).join("");
    const stub = projectToTVStub(env, pairingCode);
    const response = await stub.fetch(new Request("https://project-to-tv.internal/tv/create", {
      method: "POST",
      headers: playOnCallProxyHeaders(),
      body: JSON.stringify({ owner_token: ownerToken, viewer_token: pairingCode }),
    }));
    if (response.status === 409) continue;
    if (!response.ok) throw new ApiError(503, "tv_display_create_failed", "Could not start the big-screen display.");
    const created = await response.json() as { expires_at: number };
    const displayURL = "https://play.wetinbedis.com";
    return json({ session_id: pairingCode, pairing_code: pairingCode, owner_token: ownerToken, display_url: displayURL, expires_at: created.expires_at }, 201);
  }
  throw new ApiError(503, "tv_display_code_unavailable", "Could not reserve a display code. Try starting the projection again.");
}

async function projectToTVRequest(request: Request, env: ApiEnv, sessionID: string): Promise<Response> {
  if (!playOnCallIsConfigured(env)) return playOnCallUnavailable();
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(sessionID)) throw new ApiError(404, "tv_display_not_found", "That big-screen display is not available.");
  const headers = new Headers({ "x-wbd-call-room-proxy": "1" });
  if (request.method === "PUT" || request.method === "DELETE") {
    headers.set("x-wbd-tv-owner-token", request.headers.get("x-wbd-tv-owner-token") ?? "");
    if (request.method === "PUT") headers.set("content-type", "application/json");
  }
  const target = new URL("https://project-to-tv.internal/tv/state");
  if (request.method === "GET") target.searchParams.set("key", sessionID);
  const body = request.method === "PUT" ? await request.text() : undefined;
  const upstream = await projectToTVStub(env, sessionID).fetch(new Request(target, { method: request.method, headers, body }));
  if (request.method === "GET" && upstream.status === 410) {
    const clientAddress = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
    const addressHash = await sha256Hex(clientAddress);
    const limiter = env.PLAY_ON_CALL_ROOMS.get(
      env.PLAY_ON_CALL_ROOMS.idFromName(`wetin-be-dis-tv-pairing-rate-v1:${addressHash}`),
    );
    const limitResponse = await limiter.fetch(new Request("https://project-to-tv.internal/tv/rate-limit", {
      method: "POST",
      headers: playOnCallProxyHeaders(),
    }));
    if (!limitResponse.ok) throw new ApiError(503, "tv_pairing_rate_limit_unavailable", "The big-screen pairing check is temporarily unavailable.");
    const limit = await limitResponse.json() as { allowed: boolean; retry_after_seconds: number };
    if (!limit.allowed) {
      const retryAfter = Math.max(1, Math.min(60, Math.ceil(limit.retry_after_seconds)));
      return json(
        { error: { code: "tv_pairing_rate_limited", message: "Too many code attempts. Wait a minute, then try again." } },
        429,
        { "retry-after": String(retryAfter) },
      );
    }
  }
  return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
}

function notificationPreferencesFromPayload(
  value: unknown,
): NotificationPreferences {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ApiError(
      400,
      "invalid_notification_preferences",
      "Notification preferences must be an object of explicit true or false values.",
    );
  }
  const preferences = value as Record<string, unknown>;
  const allowed = new Set([
    "league_updates_enabled",
    "friend_invites_enabled",
    "offers_enabled",
  ]);
  if (Object.keys(preferences).some((key) => !allowed.has(key))) {
    throw new ApiError(
      400,
      "invalid_notification_preferences",
      "Notification preferences contain an unknown channel.",
    );
  }

  const field = (name: string): boolean => {
    const raw = preferences[name];
    if (typeof raw !== "boolean") {
      throw new ApiError(
        400,
        "invalid_notification_preferences",
        "Every notification preference must be true or false.",
      );
    }
    return raw;
  };

  return {
    leagueUpdatesEnabled: field("league_updates_enabled"),
    friendInvitesEnabled: field("friend_invites_enabled"),
    offersEnabled: field("offers_enabled"),
  };
}

function normalizedPushToken(platform: string, token: unknown): string {
  if (typeof token !== "string") {
    throw new ApiError(400, "invalid_push_token", "A device push token is required.");
  }
  const cleaned = token.trim();
  if (platform === "ios") {
    // APNs device-token length is intentionally not fixed by Apple. Keep the
    // value hex-only and bounded, but accept future valid token lengths.
    if (
      cleaned.length < 32
      || cleaned.length > 1024
      || cleaned.length % 2 !== 0
      || !/^[a-fA-F0-9]+$/.test(cleaned)
    ) {
      throw new ApiError(
        400,
        "invalid_push_token",
        "The iOS device token has an invalid format.",
      );
    }
    return cleaned.toLowerCase();
  }

  // FCM registration tokens are opaque. Keep them bounded and reject
  // whitespace/control characters before encryption and storage.
  if (cleaned.length < 20 || cleaned.length > 4096 || /\s/.test(cleaned)) {
    throw new ApiError(
      400,
      "invalid_push_token",
      "The Android device token has an invalid format.",
    );
  }
  return cleaned;
}

async function registerNotificationDevice(
  request: Request,
  env: ApiEnv,
): Promise<Response> {
  const player = await authenticate(request, database(env));
  const payload = await readJsonObject(request);
  const platform = typeof payload.platform === "string" ? payload.platform.toLowerCase() : "";
  if (platform !== "ios" && platform !== "android") {
    throw new ApiError(400, "invalid_push_platform", "Push platform must be ios or android.");
  }
  const preferences = notificationPreferencesFromPayload(payload.preferences);
  const token = normalizedPushToken(platform, payload.token);
  const now = Date.now();
  const tokenHash = await sha256Hex(`${platform}:${token}`);

  // An all-off settings state is opt-out, not a dormant marketing token. The
  // player may later opt back in and register afresh after an explicit choice.
  const hasAnyPreference = Object.values(preferences).some(Boolean);
  if (!hasAnyPreference) {
    await database(env)
      .prepare(
        `DELETE FROM notification_devices
         WHERE player_id = ?1 AND platform = ?2 AND token_hash = ?3`,
      )
      .bind(player.id, platform, tokenHash)
      .run();
    return json({
      registration: {
        status: "removed",
        delivery: "not_enrolled",
      },
    });
  }

  let tokenCiphertext: string;
  try {
    tokenCiphertext = await encryptPushToken(
      token,
      env.WBD_PUSH_TOKEN_ENCRYPTION_SECRET,
    );
  } catch {
    throw new ApiError(
      503,
      "push_registration_unavailable",
      "Notification registration is not configured yet. Your preference stays on this device.",
    );
  }

  await database(env)
    .prepare(
      `INSERT INTO notification_devices (
        id, player_id, platform, token_hash, token_ciphertext,
        league_updates_enabled, friend_invites_enabled, offers_enabled,
        consented_at, last_registered_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?9, ?9)
      ON CONFLICT(platform, token_hash) DO UPDATE SET
        player_id = excluded.player_id,
        token_ciphertext = excluded.token_ciphertext,
        league_updates_enabled = excluded.league_updates_enabled,
        friend_invites_enabled = excluded.friend_invites_enabled,
        offers_enabled = excluded.offers_enabled,
        consented_at = excluded.consented_at,
        last_registered_at = excluded.last_registered_at,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      player.id,
      platform,
      tokenHash,
      tokenCiphertext,
      preferences.leagueUpdatesEnabled ? 1 : 0,
      preferences.friendInvitesEnabled ? 1 : 0,
      preferences.offersEnabled ? 1 : 0,
      now,
    )
    .run();

  return json({
    registration: {
      status: "registered",
      // No sender is exposed by this API. This word keeps client copy and
      // operator expectations honest until the APNs/FCM delivery job exists.
      delivery: "registration_only",
    },
  });
}

function apnsBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToBytes(pem: string): ArrayBuffer {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

async function apnsProviderToken(env: ApiEnv): Promise<string> {
  const keyID = env.WBD_APNS_KEY_ID?.trim();
  const teamID = env.WBD_APNS_TEAM_ID?.trim();
  const privateKey = env.WBD_APNS_PRIVATE_KEY?.trim();
  if (!keyID || !teamID || !privateKey) {
    throw new ApiError(503, "apns_not_configured", "APNs delivery is not configured yet.");
  }
  const header = apnsBase64Url(JSON.stringify({ alg: "ES256", kid: keyID }));
  const claims = apnsBase64Url(JSON.stringify({ iss: teamID, iat: Math.floor(Date.now() / 1000) }));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${apnsBase64Url(new Uint8Array(signature))}`;
}

function apnsDeliveryConfiguration(env: ApiEnv): { bundleID: string; host: string } {
  const bundleID = env.WBD_APNS_BUNDLE_ID?.trim();
  const host = env.WBD_APNS_HOST?.trim();
  if (!bundleID || !host) {
    throw new ApiError(
      503,
      "apns_not_configured",
      "APNs bundle ID and host must be configured before League notifications can be sent.",
    );
  }
  if (host !== "https://api.push.apple.com" && host !== "https://api.sandbox.push.apple.com") {
    throw new ApiError(
      503,
      "apns_host_invalid",
      "APNs host must be Apple production or sandbox push service.",
    );
  }
  return { bundleID, host };
}

async function sendAPNsLeagueNotification(
  env: ApiEnv,
  token: string,
  event: LeagueNotificationEvent,
  competitionID: string | null,
  providerToken: string,
  mediaURL?: string,
  customCopy?: { title: string; body: string },
): Promise<Response> {
  const { bundleID, host } = apnsDeliveryConfiguration(env);
  const copy = leagueNotificationCopy(event);
  const notificationCopy = customCopy ?? copy;
  return fetch(`${host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${providerToken}`,
      "apns-topic": bundleID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: {
        alert: {
          title: notificationCopy.title,
          body: notificationCopy.body,
        },
        sound: "default",
        category: event === "general_announcement" ? "WBD_ANNOUNCEMENT" : "WBD_LEAGUE_UPDATE",
        ...(mediaURL ? { "mutable-content": 1 } : {}),
      },
      ...(event === "general_announcement" ? {} : { route: "league/odogwu" }),
      event,
      ...(competitionID ? { competition_id: competitionID } : {}),
      ...(mediaURL ? { media_url: mediaURL } : {}),
    }),
  });
}

function approvedNotificationMediaURL(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

async function activeLeagueNotificationMediaURL(db: D1Database): Promise<string | null> {
  const now = Date.now();
  const row = await db.prepare(
    `SELECT sponsor_logo_url
     FROM content_releases
     WHERE status = 'published'
       AND effective_from_ms <= ?1
       AND (expires_at_ms IS NULL OR expires_at_ms > ?1)
       AND sponsor_logo_url IS NOT NULL
     ORDER BY revision DESC
     LIMIT 1`,
  ).bind(now).first<{ sponsor_logo_url: string | null }>();
  return approvedNotificationMediaURL(row?.sponsor_logo_url);
}

async function leaguePushDelivery(env: ApiEnv) {
  const hasFCM = Boolean(env.WBD_FCM_SERVICE_ACCOUNT_JSON?.trim());
  if (hasFCM) {
    try { fcmConfiguration(env); }
    catch { throw new ApiError(503, "fcm_not_configured", "Android push delivery is not configured correctly."); }
  } else {
    // Preserve the iPhone-only deployment check until Android credentials are configured.
    apnsDeliveryConfiguration(env);
  }
  let appleToken: Promise<string> | undefined;
  let androidToken: Promise<string> | undefined;
  return async (platform: string, token: string, event: LeagueNotificationEvent, competitionID: string | null, mediaURL?: string, customCopy?: { title: string; body: string }) => {
    if (platform === "android") {
      androidToken ??= fcmAccessToken(env);
      return sendFCMLeagueNotification(env, token, event, competitionID, await androidToken, mediaURL, customCopy);
    }
    if (platform !== "ios") throw new Error("Unsupported push platform");
    appleToken ??= apnsProviderToken(env);
    return sendAPNsLeagueNotification(env, token, event, competitionID, await appleToken, mediaURL, customCopy);
  };
}

async function notifyPayoutDetailsRequired(
  env: ApiEnv,
  db: D1Database,
  playerID: string,
  event: "payout_details_required" | "payout_submitted" | "payout_approved" | "payout_sent" | "payout_failed" | "payout_cancelled" = "payout_details_required",
): Promise<{ eligible: number; sent: number; failed: number; removed: number }> {
  const deliver = await leaguePushDelivery(env);
  const mediaURL = await activeLeagueNotificationMediaURL(db);
  const rows = await db.prepare(
    `SELECT id, token_ciphertext, platform FROM notification_devices
     WHERE player_id = ?1 AND platform IN ('ios', 'android') AND league_updates_enabled = 1`,
  ).bind(playerID).all<{ id: string; token_ciphertext: string; platform: string }>();
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const row of rows.results ?? []) {
    try {
      const token = await decryptPushToken(row.token_ciphertext, env.WBD_PUSH_TOKEN_ENCRYPTION_SECRET);
      const response = await deliver(row.platform, token, event, null, mediaURL ?? undefined);
      if (response.ok) sent += 1;
      else {
        failed += 1;
        if (await shouldRemovePushToken(row.platform, response)) {
          await db.prepare("DELETE FROM notification_devices WHERE id = ?1").bind(row.id).run();
          removed += 1;
        }
      }
    } catch {
      failed += 1;
    }
  }
  return { eligible: rows.results?.length ?? 0, sent, failed, removed };
}

async function sendLeagueTestNotification(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request);
  const isGeneral = new URL(request.url).pathname === "/api/v1/admin/notifications/announcement-broadcast";
  const event = isGeneral ? "general_announcement" : payload.event === "starts_soon" || payload.event === "started"
    || payload.event === "closing_soon" || payload.event === "closed" || payload.event === "provisional_results" || payload.event === "results_ready"
    ? payload.event
    : null;
  if (!event) {
    throw new ApiError(
      400,
      "invalid_notification_event",
      "Event must be starts_soon, started, closing_soon, closed, provisional_results, or results_ready.",
    );
  }
  if (event === "starts_soon" || event === "started") {
    const league = (await publishedAppConfig(env)).events.odogwu_league;
    if (!league.enabled || league.home_placement !== "banner") {
      throw new ApiError(
        409,
        "odogwu_banner_required",
        "This announcement cannot be sent until the published Odogwu League banner is enabled.",
        { required: "events.odogwu_league.enabled=true", home_placement: "banner" },
      );
    }
  }
  const competitionID = !isGeneral && typeof payload.competition_id === "string"
    ? payload.competition_id.trim()
    : "";
  const customTitle = payload.title === undefined ? "" : String(payload.title).trim();
  const customBody = payload.body === undefined ? "" : String(payload.body).trim();
  if (customTitle.length > 80 || customBody.length > 240) {
    throw new ApiError(400, "notification_copy_too_long", "Notification title must be 80 characters or fewer and message 240 characters or fewer.");
  }
  if ((customTitle && !customBody) || (!customTitle && customBody)) {
    throw new ApiError(400, "notification_copy_incomplete", "Provide both a notification title and message, or leave both blank to use the default copy.");
  }
  if (isGeneral && (!customTitle || !customBody)) {
    throw new ApiError(400, "notification_copy_required", "A title and message are required for general announcements.");
  }
  const requestedMediaURL = payload.media_url === undefined
    ? null
    : approvedNotificationMediaURL(payload.media_url);
  if (payload.media_url !== undefined && !requestedMediaURL) {
    throw new ApiError(400, "invalid_notification_media_url", "media_url must be a valid HTTPS URL without credentials.");
  }
  if (competitionID.length > 160) {
    throw new ApiError(400, "invalid_competition_id", "Competition ID is too long.");
  }
  if (event === "closing_soon" && !competitionID) {
    throw new ApiError(
      400,
      "competition_id_required",
      "A competition ID is required for closing-soon notifications.",
    );
  }
  // Validate available platform deployment state before selecting recipients.
  // Per-device failures remain in the response below; this never sends a
  // player notification merely to probe configuration.
  // General announcements are iOS-only and must not depend on League or Android configuration.
  if (isGeneral) apnsDeliveryConfiguration(env);
  const generalProviderToken = isGeneral ? await apnsProviderToken(env) : null;
  const deliver = isGeneral
    ? async (_platform: string, token: string, event: LeagueNotificationEvent, competitionID: string | null, mediaURL?: string, copy?: { title: string; body: string }) =>
      sendAPNsLeagueNotification(env, token, event, competitionID, generalProviderToken!, mediaURL, copy)
    : await leaguePushDelivery(env);
  const db = database(env);
  const mediaURL = isGeneral ? null : requestedMediaURL ?? await activeLeagueNotificationMediaURL(db);
  const recipients = db.prepare(
    isGeneral
      ? `SELECT id, token_ciphertext, platform FROM notification_devices
         WHERE platform = 'ios' AND offers_enabled = 1`
      : event === "closing_soon"
      ? `SELECT d.id, d.token_ciphertext, d.platform FROM notification_devices d
         WHERE d.platform IN ('ios', 'android') AND d.league_updates_enabled = 1
           AND NOT EXISTS (
             SELECT 1 FROM attempts a
             JOIN competitions c ON c.id = a.competition_id
             WHERE a.player_id = d.player_id
               AND c.id = ?1
               AND a.status = 'submitted'
           )`
      : `SELECT id, token_ciphertext, platform FROM notification_devices
         WHERE platform IN ('ios', 'android') AND league_updates_enabled = 1`,
  );
  const rows = event === "closing_soon"
    ? await recipients.bind(competitionID).all<{ id: string; token_ciphertext: string; platform: string }>()
    : await recipients.all<{ id: string; token_ciphertext: string; platform: string }>();
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const row of rows.results ?? []) {
    try {
      const token = await decryptPushToken(row.token_ciphertext, env.WBD_PUSH_TOKEN_ENCRYPTION_SECRET);
      const response = await deliver(row.platform, token, event, competitionID || null, mediaURL ?? undefined, customTitle ? { title: customTitle, body: customBody } : undefined);
      if (response.ok) {
        sent += 1;
      } else {
        failed += 1;
        // APNs 410 means the app/device no longer accepts this token. Delete
        // it rather than retaining unreachable device data indefinitely.
        if (await shouldRemovePushToken(row.platform, response)) {
          await db.prepare("DELETE FROM notification_devices WHERE id = ?1")
            .bind(row.id)
            .run();
          removed += 1;
        }
      }
    } catch {
      failed += 1;
    }
  }
  await recordAdminAudit(
    db,
    authorization,
    "notification_broadcast",
    isGeneral ? "general_announcement" : "league_notification",
    competitionID || null,
    `Sent ${event} notification broadcast from the owner console.`,
    { event, competition_id: competitionID || null, title: customTitle || null, body: customBody || null, eligible: rows.results?.length ?? 0, sent, failed, removed },
  );
  return json({
    notification: {
      event,
      competition_id: competitionID || null,
      eligible: rows.results?.length ?? 0,
      sent,
      failed,
      removed,
    },
  });
}

async function getAdminNotificationStatus(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const db = database(env);
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS eligible_devices,
      COUNT(DISTINCT player_id) AS eligible_players
    FROM notification_devices
    WHERE platform IN ('ios', 'android') AND league_updates_enabled = 1
  `).first<{ eligible_devices: number; eligible_players: number }>();
  const announcements = await db.prepare(`
    SELECT COUNT(*) AS eligible_devices, COUNT(DISTINCT player_id) AS eligible_players
    FROM notification_devices WHERE platform = 'ios' AND offers_enabled = 1
  `).first<{ eligible_devices: number; eligible_players: number }>();
  return json({
    announcements: {
      eligible_devices: Number(announcements?.eligible_devices ?? 0),
      eligible_players: Number(announcements?.eligible_players ?? 0),
    },
    eligible_devices: Number(row?.eligible_devices ?? 0),
    eligible_players: Number(row?.eligible_players ?? 0),
  });
}

async function setServerRehearsalWindow(request: Request, env: ApiEnv): Promise<Response> {
  await authorizeContentAdmin(request, env);
  const payload = await readJsonObject(request);
  const enabled = payload.enabled === true;
  const startsAt = typeof payload.starts_at === "string" ? Date.parse(payload.starts_at) : NaN;
  const endsAt = typeof payload.ends_at === "string" ? Date.parse(payload.ends_at) : NaN;
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    throw new ApiError(400, "invalid_rehearsal_window", "A valid rehearsal window is required.");
  }
  const db = database(env);
  let competition = await db.prepare(
    `SELECT id FROM competitions WHERE slug = ?1 LIMIT 1`,
  ).bind(SERVER_REHEARSAL_SLUG).first<{ id: string }>();
  if (!competition) {
    const existingPractice = await db.prepare(
      `SELECT id FROM competitions WHERE slug = 'gist-league-test-week-1' LIMIT 1`,
    ).first<{ id: string }>();
    if (!existingPractice) {
      throw new ApiError(404, "rehearsal_not_found", "The server rehearsal competition is not provisioned.");
    }
    await db.prepare(
      `UPDATE competitions
       SET slug = ?1, title = 'Odogwu League — Internal Rehearsal', entry_mode = 'guest', updated_at = ?2
       WHERE id = ?3`,
    ).bind(SERVER_REHEARSAL_SLUG, Date.now(), existingPractice.id).run();
    competition = existingPractice;
  }
  const now = Date.now();
  const opensAt = enabled ? startsAt : endsAt;
  const closesAt = enabled ? endsAt : endsAt + 24 * 60 * 60 * 1000;
  await db.prepare(
    `UPDATE competitions
     SET status = 'open', per_card_limit_ms = ?7, opens_at = ?1, closes_at = ?2,
         score_review_closes_at = ?3, eligible_countries_json = ?4, updated_at = ?5
     WHERE id = ?6`,
  ).bind(
    opensAt,
    closesAt,
    closesAt + 60 * 60 * 1000,
    JSON.stringify(ODOGWU_ELIGIBLE_COUNTRIES),
    now,
    competition.id,
    LEAGUE_PER_CARD_LIMIT_MS,
  ).run();
  return json({ competition: { id: competition.id, enabled, opens_at: opensAt, closes_at: closesAt } });
}

/**
 * Creates a one-off, server-owned League round from the private rehearsal
 * pack.  This is deliberately not a copy of Today’s 5: public cards would
 * disclose answers before a prize round opens.  Every clone gets new card
 * identifiers and a shuffled order, while retaining the reviewed private
 * cards/options and the fixed NGN prize ladder.
 */
async function provisionOneDayLeagueRound(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: 16_000, requireApplicationJSON: true });
  const reason = adminReason(payload);
  const slug = typeof payload.slug === "string" ? payload.slug.trim() : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const startsAt = typeof payload.starts_at === "string" ? Date.parse(payload.starts_at) : NaN;
  const endsAt = typeof payload.ends_at === "string" ? Date.parse(payload.ends_at) : NaN;
  if (!/^[a-z0-9][a-z0-9-]{2,95}$/.test(slug) || !title || title.length > 140) {
    throw new ApiError(400, "invalid_simulation_round", "A lowercase round slug and title are required.");
  }
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    throw new ApiError(400, "invalid_simulation_round", "A valid opening and closing time are required.");
  }
  const db = database(env);
  const existing = await db.prepare("SELECT id FROM competitions WHERE slug = ?1 LIMIT 1")
    .bind(slug).first<{ id: string }>();
  if (existing) return json({ competition: { id: existing.id, slug, existing: true } });

  // Production cash rounds must use the reviewed private test pack, never
  // Today’s 5 or the internal rehearsal pack (which is intentionally public
  // and therefore fails the isolation check).
  const source = await db.prepare("SELECT * FROM competitions WHERE slug = 'gist-league-test-week-1' LIMIT 1")
    .first<CompetitionRow>();
  if (!source) {
    throw new ApiError(409, "private_round_source_unavailable", "The reviewed private League pack is not available yet.");
  }
  const sourceCards = await loadCompetitionPack(db, source.id);
  const packIssues = validateCompetitionPack(sourceCards, source.question_count);
  if (packIssues.length > 0) {
    throw new ApiError(409, "private_round_source_invalid", "The reviewed private League pack is not ready.", { issues: packIssues.slice(0, 20) });
  }
  const now = Date.now();
  const competitionID = crypto.randomUUID();
  const shuffled = [...sourceCards].sort(() => crypto.getRandomValues(new Uint32Array(1))[0] - 0x80000000);
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO competitions (
      id, slug, title, status, content_status, rules_version, pack_version,
      scoring_version, question_count, per_card_limit_ms, upload_grace_ms,
      entry_mode, country_code, minimum_age, currency, opens_at, closes_at,
      score_review_closes_at, eligible_countries_json, created_at, updated_at
    ) VALUES (?1, ?2, ?3, 'open', 'published', ?4, ?5, ?6, ?7, ?8, ?9,
      'phone_verified', 'NG', 18, 'NGN', ?10, ?11, ?12, ?13, ?14, ?14)`)
      .bind(
        competitionID, slug, title, source.rules_version, `${source.pack_version}-${slug}`,
        source.scoring_version, source.question_count, LEAGUE_PER_CARD_LIMIT_MS,
        source.upload_grace_ms, startsAt, endsAt, endsAt + 60 * 60 * 1000,
        JSON.stringify(ODOGWU_ELIGIBLE_COUNTRIES), now,
      ),
    db.prepare("INSERT INTO competition_prizes (competition_id, place, amount_minor) VALUES (?1, 1, 5000000)")
      .bind(competitionID),
    db.prepare("INSERT INTO competition_prizes (competition_id, place, amount_minor) VALUES (?1, 2, 3000000)")
      .bind(competitionID),
    db.prepare("INSERT INTO competition_prizes (competition_id, place, amount_minor) VALUES (?1, 3, 2000000)")
      .bind(competitionID),
  ];
  for (const [index, card] of shuffled.entries()) {
    const cardID = crypto.randomUUID();
    statements.push(db.prepare(`INSERT INTO competition_cards (
      id, competition_id, source_card_id, position, content_version, category,
      answer_family, clues_json, correct_option_id, difficulty, editorial_status,
      verification_note, source_urls_json, reviewed_by, reviewed_at, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'approved',
      'Cloned from the reviewed private League pack for a one-day simulation.', '[]', ?11, ?12, ?13, ?13)`)
      .bind(cardID, competitionID, card.sourceCardId, index + 1, card.contentVersion,
        card.category, card.answerFamily, JSON.stringify(card.clues), card.correctOptionId,
        card.difficulty, authorization.publishedBy, now, now));
    for (const option of card.options) {
      statements.push(db.prepare(`INSERT INTO competition_card_options (
        card_id, option_id, position, label, category, answer_family
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(cardID, option.id, option.position, option.label, option.category, option.answerFamily));
    }
  }
  await db.batch(statements);
  await recordAdminAudit(
    db,
    authorization,
    "competition_created",
    "competition",
    competitionID,
    reason,
    { title, slug, status: "open", content_status: "published", source: "reviewed_private_pack", start_at: startsAt, end_at: endsAt },
  );
  return json({
    competition: {
      id: competitionID, slug, title, opens_at: startsAt, closes_at: endsAt,
      prizes: [{ place: 1, amount_minor: 5000000 }, { place: 2, amount_minor: 3000000 }, { place: 3, amount_minor: 2000000 }],
    },
  }, 201);
}

async function getActiveCompetition(
  db: D1Database,
  competitionId?: string,
): Promise<CompetitionRow | null> {
  const now = Date.now();
  const whereId = competitionId ? "AND id = ?3" : "";
  const statement = db.prepare(
    `SELECT * FROM competitions
     WHERE status = 'open'
       AND content_status = 'published'
       AND opens_at <= ?1
       AND closes_at > ?2
       ${whereId}
     ORDER BY closes_at ASC
     LIMIT 1`,
  );
  return competitionId
    ? statement.bind(now, now, competitionId).first<CompetitionRow>()
    : statement.bind(now, now).first<CompetitionRow>();
}

/**
 * Keep the competition lifecycle moving even when no cron invocation is
 * available. Every public/admin read that depends on the lifecycle calls this
 * small reconciliation pass, so the UI and the player API cannot drift apart.
 */
export async function reconcileCompetitionLifecycle(db: D1Database): Promise<void> {
  const now = Date.now();
  const systemAuthorization: ContentAdminAuthorization = {
    publishedBy: "system:competition-lifecycle",
    method: "bearer",
  };

  const expired = await db.prepare(`
    SELECT id, title
    FROM competitions
    WHERE status = 'open' AND closes_at <= ?1
    ORDER BY closes_at ASC
  `).bind(now).all<{ id: string; title: string }>();
  for (const competition of expired.results ?? []) {
    const result = await db.prepare(`
      UPDATE competitions
      SET status = 'locked', updated_at = ?1
      WHERE id = ?2 AND status = 'open' AND closes_at <= ?1
    `).bind(now, competition.id).run();
    if (Number(result.meta?.changes ?? 0) > 0) {
      await recordAdminAudit(
        db,
        systemAuthorization,
        "competition_auto_locked",
        "competition",
        competition.id,
        "Competition automatically closed when its scheduled end time passed.",
        { title: competition.title, closed_at: now },
      );
    }
  }

  // Never leave an invalid scheduled round sitting in the operating queue.
  // Older launch flows could create a scheduled row before its cards were
  // published; cancelling it prevents a local countdown/notification from
  // promising a round that the player API must refuse.
  const invalidScheduled = await db.prepare(`
    SELECT c.id, c.title, c.content_status, c.question_count,
      (SELECT COUNT(*) FROM competition_cards cc WHERE cc.competition_id = c.id) AS card_count
    FROM competitions c
    WHERE c.status = 'scheduled'
      AND (c.content_status <> 'published'
        OR (SELECT COUNT(*) FROM competition_cards cc WHERE cc.competition_id = c.id) < c.question_count)
  `).all<{ id: string; title: string; content_status: string; question_count: number; card_count: number }>();
  for (const competition of invalidScheduled.results ?? []) {
    const result = await db.prepare(`
      UPDATE competitions
      SET status = 'cancelled', updated_at = ?1
      WHERE id = ?2 AND status = 'scheduled'
    `).bind(now, competition.id).run();
    if (Number(result.meta?.changes ?? 0) > 0) {
      await recordAdminAudit(
        db,
        systemAuthorization,
        "competition_auto_cancelled_invalid_content",
        "competition",
        competition.id,
        "Scheduled competition automatically cancelled because its published question-card set was incomplete.",
        { title: competition.title, content_status: competition.content_status, question_count: competition.question_count, card_count: competition.card_count, cancelled_at: now },
      );
    }
  }

  // Re-check the player-facing banner at the moment a scheduled round would
  // auto-open. Operators may have disabled it, or its explicit hide time may
  // have passed since the round was scheduled.
  const publishedConfigRow = await db.prepare(`
    SELECT config_json FROM app_config_revisions
    WHERE status = 'published'
    ORDER BY revision DESC LIMIT 1
  `).first<{ config_json: string }>();
  let odogwuBannerAvailable: boolean | null = null;
  if (publishedConfigRow) {
    let bannerAvailable = false;
    try {
      const league = JSON.parse(publishedConfigRow.config_json)?.events?.odogwu_league;
      const bannerEndsAt = league?.banner_ends_at ? Date.parse(String(league.banner_ends_at)) : NaN;
      bannerAvailable = league?.enabled === true
        && league?.home_placement === "banner"
        && (!Number.isFinite(bannerEndsAt) || now < bannerEndsAt);
    } catch {
      bannerAvailable = false;
    }
    odogwuBannerAvailable = bannerAvailable;
  }

  // A scheduled round may only become live when no other round is live. This
  // preserves the one-session rule even if old data contains overlapping
  // schedules or several requests arrive at the same time.
  const live = await db.prepare(`
    SELECT id FROM competitions
    WHERE status = 'open' AND opens_at <= ?1 AND closes_at > ?1
    LIMIT 1
  `).bind(now).first<{ id: string }>();
  if (live) return;

  const next = await db.prepare(`
    SELECT id, title
    FROM competitions
    WHERE status = 'scheduled'
      AND content_status = 'published'
      AND opens_at <= ?1 AND closes_at > ?1
    ORDER BY opens_at ASC, id ASC
    LIMIT 1
  `).bind(now).first<{ id: string; title: string }>();
  if (!next) return;

  // The banner invariant applies to Odogwu sessions only. Other competition
  // types must keep their own independent lifecycle and must not be cancelled
  // merely because the Odogwu banner is unavailable.
  if (odogwuBannerAvailable === false && /odogwu/i.test(next.title)) {
    const result = await db.prepare(`
      UPDATE competitions SET status = 'cancelled', updated_at = ?1
      WHERE id = ?2 AND status = 'scheduled'
    `).bind(now, next.id).run();
    if (Number(result.meta?.changes ?? 0) > 0) {
      await recordAdminAudit(
        db,
        systemAuthorization,
        "competition_auto_cancelled_banner_unavailable",
        "competition",
        next.id,
        "Scheduled Odogwu competition automatically cancelled because its player-facing banner was disabled or explicitly scheduled off before start.",
        { title: next.title, cancelled_at: now },
      );
    }
    return;
  }

  const result = await db.prepare(`
    UPDATE competitions
    SET status = 'open', updated_at = ?1
    WHERE id = ?2 AND status = 'scheduled'
      AND content_status = 'published'
      AND opens_at <= ?1 AND closes_at > ?1
      AND NOT EXISTS (
        SELECT 1 FROM competitions live
        WHERE live.status = 'open'
          AND live.opens_at <= ?1 AND live.closes_at > ?1
      )
  `).bind(now, next.id).run();
  if (Number(result.meta?.changes ?? 0) > 0) {
    await recordAdminAudit(
      db,
      systemAuthorization,
      "competition_auto_opened",
      "competition",
      next.id,
      "Scheduled competition automatically opened at its scheduled start time.",
      { title: next.title, opened_at: now },
    );
  }
}

async function prizePayload(db: D1Database, competitionId: string) {
  const result = await db
    .prepare(
      `SELECT place, amount_minor
       FROM competition_prizes
       WHERE competition_id = ?1
       ORDER BY place ASC`,
    )
    .bind(competitionId)
    .all<{ place: number; amount_minor: number }>();
  const configured = (result.results ?? []).map((prize) => ({
    place: prize.place,
    amount_minor: prize.amount_minor,
  }));
  // The internal rehearsal can display the approved-looking prize ladder
  // before prize rows are seeded, but it remains explicitly non-payable.
  if (configured.length === 0) {
    const rehearsal = await db
      .prepare("SELECT slug FROM competitions WHERE id = ?1 LIMIT 1")
      .bind(competitionId)
      .first<{ slug: string }>();
    if (rehearsal?.slug === SERVER_REHEARSAL_SLUG) {
      return [
        { place: 1, amount_minor: 10_000_000 },
        { place: 2, amount_minor: 6_000_000 },
        { place: 3, amount_minor: 4_000_000 },
      ];
    }
  }
  return configured;
}

function isServerRehearsal(competition: CompetitionRow): boolean {
  return competition.slug === SERVER_REHEARSAL_SLUG;
}

type PublicSoloQuestion = {
  id: string;
  category: string;
  answer_family: string;
  clues: string[];
  options: Array<{
    id: string;
    label: string;
    category: string;
    answer_family: string;
  }>;
  correct_option_id: string;
};

type PublicSoloPack = {
  content_version: string;
  effective_week_wat: string;
  questions: PublicSoloQuestion[];
  daily_packs: Array<{ date_wat: string; question_ids: string[] }>;
};

function isPublicSoloQuestion(value: unknown): value is PublicSoloQuestion {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const question = value as Record<string, unknown>;
  if (
    typeof question.id !== "string" || !question.id.trim()
    || typeof question.category !== "string" || !question.category.trim()
    || typeof question.answer_family !== "string" || !question.answer_family.trim()
    || typeof question.correct_option_id !== "string" || !question.correct_option_id.trim()
    || !Array.isArray(question.clues) || question.clues.length !== 3
    || !question.clues.every((clue) => typeof clue === "string" && clue.trim())
    || !Array.isArray(question.options) || question.options.length !== 7
  ) return false;
  const options = question.options as Array<Record<string, unknown>>;
  return options.every((option) =>
    typeof option?.id === "string" && option.id.trim()
    && typeof option.label === "string" && option.label.trim()
    && typeof option.category === "string" && option.category.trim()
    && typeof option.answer_family === "string" && option.answer_family.trim(),
  ) && options.some((option) => option.id === question.correct_option_id);
}

function publicSoloPackFrom(value: unknown): PublicSoloPack | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const questions = Array.isArray(source.questions)
    ? source.questions.filter(isPublicSoloQuestion)
    : [];
  const contentVersion = typeof source.content_version === "string"
    ? source.content_version.trim()
    : "";
  const effectiveWeek = typeof source.effective_week_wat === "string"
    ? source.effective_week_wat.trim()
    : "";
  const dailyPacks = Array.isArray(source.daily_packs)
    ? source.daily_packs.flatMap((candidate) => {
        if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") return [];
        const pack = candidate as Record<string, unknown>;
        const date = typeof pack.date_wat === "string" ? pack.date_wat.trim() : "";
        const ids = Array.isArray(pack.question_ids)
          ? pack.question_ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim())
          : [];
        return Boolean(date) && ids.length === 5 ? [{ date_wat: date, question_ids: ids }] : [];
      })
    : [];
  return contentVersion && questions.length >= 12
    ? { content_version: contentVersion, effective_week_wat: effectiveWeek, questions, daily_packs: dailyPacks }
    : null;
}

function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const swapIndex = random[0] % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

async function activePublicSoloPack(db: D1Database): Promise<PublicSoloPack> {
  const published = await db.prepare(
    `SELECT a.payload_json
     FROM content_assets a
     JOIN content_releases r ON r.id = a.release_id
     WHERE a.kind = 'solo_gist' AND r.status = 'published'
     ORDER BY r.published_at DESC
     LIMIT 1`,
  ).first<{ payload_json: string }>();
  if (published) {
    try {
      const pack = publicSoloPackFrom(JSON.parse(published.payload_json));
      if (pack) return pack;
    } catch {
      // The immutable bundled release remains a safe internal-test fallback.
    }
  }
  const fallback = publicSoloPackFrom(bundledPublicRelease.solo_gist);
  if (!fallback) {
    throw new ApiError(503, "public_practice_content_unavailable", "Today’s 5 questions are not available for this internal test.");
  }
  return fallback;
}

function currentWATDate(): string {
  return new Date(Date.now() + 60 * 60 * 1_000).toISOString().slice(0, 10);
}

async function ownerContentCatalog(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const db = database(env);
  const [solo, partyResponse] = await Promise.all([
    activePublicSoloPack(db),
    getPartyDeckEditorState(request, env),
  ]);
  const partyPayload = await partyResponse.json() as { cards?: PartyDeckEditorCard[]; source?: string; updated_at?: number | null };
  const partyCards = Array.isArray(partyPayload.cards) ? partyPayload.cards : [];
  const today = currentWATDate();
  const dailyPack = solo.daily_packs.find((pack) => pack.date_wat === today) ?? solo.daily_packs[0] ?? null;
  const byID = new Map(solo.questions.map((question) => [question.id, question]));
  const todaysQuestions = (dailyPack?.question_ids ?? [])
    .map((id) => byID.get(id))
    .filter((question): question is PublicSoloQuestion => Boolean(question));
  const categoryCounts = new Map<string, number>();
  for (const card of partyCards) categoryCounts.set(card.Category, (categoryCounts.get(card.Category) ?? 0) + 1);
  for (const question of solo.questions) categoryCounts.set(question.category, (categoryCounts.get(question.category) ?? 0) + 1);
  await recordAdminAudit(
    db,
    authorization,
    "content_catalog_viewed",
    "content_catalog",
    null,
    "Owner viewed the active Today’s 5 and regular category catalog.",
    { today_wat: today, todays_five_count: todaysQuestions.length, party_card_count: partyCards.length },
  );
  return json({
    generated_at: Date.now(),
    today_wat: today,
    solo: {
      content_version: solo.content_version,
      effective_week_wat: solo.effective_week_wat,
      daily_pack_date_wat: dailyPack?.date_wat ?? null,
      questions: todaysQuestions,
    },
    party_deck: {
      source: partyPayload.source ?? "unknown",
      updated_at: partyPayload.updated_at ?? null,
      cards: partyCards,
    },
    categories: [...categoryCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count })),
  });
}

/**
 * Spins up an internal-only rehearsal from public Today’s 5 source cards.
 * It deliberately retains the cash-shaped sequential clock and standings so
 * device QA can exercise the complete League journey, while remaining a
 * non-payable test: guest entry, no payout rows, and test_only in its public
 * payload. Public content is allowed only in this exact rehearsal lane.
 */
async function provisionInternalPublicRehearsal(
  request: Request,
  env: ApiEnv,
): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, {
    maximumBytes: 16_000,
    requireApplicationJSON: true,
  });
  const startsAt = typeof payload.starts_at === "string" ? Date.parse(payload.starts_at) : NaN;
  const endsAt = typeof payload.ends_at === "string" ? Date.parse(payload.ends_at) : NaN;
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    throw new ApiError(400, "invalid_rehearsal_window", "A valid internal-test window is required.");
  }

  const db = database(env);
  const source = await activePublicSoloPack(db);
  const selected = shuffled(source.questions).slice(0, 12);
  if (selected.length !== 12) {
    throw new ApiError(503, "public_practice_content_unavailable", "Twelve reviewed Today’s 5 questions are required for this internal test.");
  }

  const now = Date.now();
  const prior = await db.prepare(
    "SELECT id FROM competitions WHERE slug = ?1 LIMIT 1",
  ).bind(SERVER_REHEARSAL_SLUG).first<{ id: string }>();
  const competitionID = crypto.randomUUID();
  const archiveSlug = `${SERVER_REHEARSAL_SLUG}-archived-${now}`;
  const statements: D1PreparedStatement[] = [];
  if (prior) {
    // Keep earlier attempts intact for test evidence rather than rewriting a
    // pack beneath them. The exact rehearsal slug is then free for this run.
    statements.push(
      db.prepare(
        `UPDATE competitions
         SET status = 'locked', slug = ?1, updated_at = ?2
         WHERE id = ?3`,
      ).bind(archiveSlug, now, prior.id),
    );
  }
  statements.push(
    db.prepare(`INSERT INTO competitions (
      id, slug, title, status, content_status, rules_version, pack_version,
      scoring_version, question_count, per_card_limit_ms, upload_grace_ms,
      entry_mode, country_code, minimum_age, currency, opens_at, closes_at,
      score_review_closes_at, eligible_countries_json, created_at, updated_at
    ) VALUES (?1, ?2, 'Odogwu League — ₦100K Test Pool', 'open', 'published',
      'internal-rehearsal-v2', ?3, 'accuracy-time-v1', 12, 8000, 15000,
      'guest', 'NG', 18, 'NGN', ?4, ?5, ?6, ?7, ?8, ?8)`)
      .bind(
        competitionID,
        SERVER_REHEARSAL_SLUG,
        `today-five-random-12-${now}`,
        startsAt,
        endsAt,
        endsAt + 60 * 60 * 1000,
        JSON.stringify(ODOGWU_ELIGIBLE_COUNTRIES),
        now,
      ),
  );

  for (const [index, question] of selected.entries()) {
    const cardID = crypto.randomUUID();
    statements.push(
      db.prepare(`INSERT INTO competition_cards (
        id, competition_id, source_card_id, position, content_version, category,
        answer_family, clues_json, correct_option_id, difficulty, editorial_status,
        verification_note, source_urls_json, reviewed_by, reviewed_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'standard', 'approved',
        'Internal rehearsal from public Today’s 5 source. Never prize eligible.', '[]', ?10, ?11, ?11, ?11)`)
        .bind(
          cardID,
          competitionID,
          question.id,
          index + 1,
          source.content_version,
          question.category,
          question.answer_family,
          JSON.stringify(question.clues),
          question.correct_option_id,
          authorization.publishedBy,
          now,
        ),
    );
    for (const [optionIndex, option] of question.options.entries()) {
      statements.push(
        db.prepare(`INSERT INTO competition_card_options (
          card_id, option_id, position, label, category, answer_family
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
          .bind(
            cardID,
            option.id,
            optionIndex + 1,
            option.label,
            option.category,
            option.answer_family,
          ),
      );
    }
  }
  await db.batch(statements);
  return json({
    competition: {
      id: competitionID,
      title: "Odogwu League — ₦100K Test Pool",
      opens_at: startsAt,
      closes_at: endsAt,
      question_count: selected.length,
      source: "random_today_five",
      test_only: true,
      payout_eligible: false,
    },
  }, 201);
}

function normalizedCountryCode(value: string | null | undefined): string {
  const country = value?.trim().toUpperCase() ?? "";
  return country === "UK" ? "GB" : country;
}

function competitionEligibleCountries(competition: CompetitionRow): string[] {
  try {
    const parsed = JSON.parse(competition.eligible_countries_json ?? "") as unknown;
    if (Array.isArray(parsed)) {
      const normalized = [...new Set(parsed
        .filter((value): value is string => typeof value === "string")
        .map(normalizedCountryCode)
        .filter((value) => /^[A-Z]{2}$/.test(value)))];
      if (normalized.length > 0) return normalized;
    }
  } catch {
    // Older rows use the single-country field below until migrated.
  }
  const legacyCountry = normalizedCountryCode(competition.country_code);
  return /^[A-Z]{2}$/.test(legacyCountry) ? [legacyCountry] : [];
}

function isCashLaunchGateKey(value: string): value is CashLaunchGateKey {
  return (REQUIRED_CASH_LAUNCH_GATES as readonly string[]).includes(value);
}

async function cashLaunchReadiness(db: D1Database): Promise<{
  available: boolean;
  blockers: CashLaunchGateKey[];
}> {
  const result = await db
    .prepare(
      `SELECT gate_key, status, evidence_reference
       FROM cash_launch_gates`,
    )
    .all<{ gate_key: string; status: string; evidence_reference: string | null }>();
  const byKey = new Map((result.results ?? []).map((row) => [row.gate_key, row]));
  const blockers = REQUIRED_CASH_LAUNCH_GATES.filter((gate) => {
    const row = byKey.get(gate);
    return row?.status !== "passed" || !row.evidence_reference?.trim();
  });
  return { available: blockers.length === 0, blockers };
}

function competitionPayload(
  competition: CompetitionRow,
  prizes: Array<{ place: number; amount_minor: number }>,
  cashLaunchAvailable: boolean,
  cashEnabled: boolean,
  allowPublicCash = true,
) {
  const rehearsal = isServerRehearsal(competition);
  const publicCash = !rehearsal
    && cashLaunchAvailable
    && cashEnabled
    && allowPublicCash
    && competition.currency === "NGN"
    && prizes.length > 0
    && competition.entry_mode !== "guest";
  return {
    id: competition.id,
    slug: competition.slug,
    title: competition.title,
    status: rehearsal || publicCash ? "active" : "preview",
    rules_version: competition.rules_version,
    pack_version: competition.pack_version,
    scoring_version: competition.scoring_version,
    mode: rehearsal || publicCash ? "cash" : "practice",
    // The installed internal-test build deliberately gates the cash-shaped
    // presentation on this flag. The exact rehearsal remains marked test_only
    // and has payouts disabled below, so this enables the full UI flow without
    // creating a payable prize commitment.
    prize_eligible: rehearsal || publicCash,
    timing_trust: rehearsal || publicCash ? "server_authoritative" : "client_reported_untrusted",
    // Keep the internal rehearsal non-payable on the server, but route the
    // installed TestFlight build through its normal name → Firebase SMS →
    // eligibility confirmation wall. That build uses `test_only` to bypass
    // the entire verification journey, so exposing the rehearsal marker here
    // would prevent exercising the actual phone-verification flow.
    test_only: false,
    payouts_enabled: publicCash,
    attempt_availability: {
      available: rehearsal || publicCash || (competition.entry_mode === "guest" && prizes.length === 0),
      reason: rehearsal ? "server_rehearsal" : publicCash ? "cash_launch_ready" : !allowPublicCash && prizes.length > 0 ? "android_cash_scope_not_approved" : "practice_only",
    },
    question_count: competition.question_count,
    per_card_limit_ms: competition.per_card_limit_ms,
    entry: {
      mode: rehearsal ? "guest_rehearsal" : publicCash ? competition.entry_mode : "practice_preview",
      country_code: competition.country_code,
      eligible_countries: competitionEligibleCountries(competition),
      minimum_age: competition.minimum_age,
    },
    schedule: {
      opens_at: competition.opens_at,
      closes_at: competition.closes_at,
      score_review_closes_at: competition.score_review_closes_at,
    },
    prize: {
      currency: competition.currency,
      unit: "minor",
      places: rehearsal || publicCash ? prizes : [],
      configured_place_count: prizes.length,
      status: rehearsal ? "display_only_rehearsal" : publicCash ? "cash_enabled" : "not_prize_eligible",
      exact_ties: "share_affected_place_pool",
    },
    leaderboard_order: [
      "correct_count_desc",
      "adjusted_total_ms_asc",
      "hard_card_ms_asc",
    ],
  };
}

async function currentCompetition(request: Request, env: ApiEnv): Promise<Response> {
  const controls = (await publishedAppConfig(env)).events.odogwu_league;
  if (!controls.enabled) {
    throw new ApiError(404, "league_disabled", "Odogwu League is unavailable.");
  }
  if (!controls.entry_enabled) {
    throw new ApiError(404, "league_entries_closed", "Odogwu League entries are closed right now.");
  }
  const db = database(env);
  await reconcileCompetitionLifecycle(db);
  const competition = await getActiveCompetition(db);
  if (!competition) {
    throw new ApiError(404, "no_active_competition", "There is no open competition right now.");
  }
  const prizes = await prizePayload(db, competition.id);
  const cashReadiness = await cashLaunchReadiness(db);
  if (
    !isServerRehearsal(competition)
    && (prizes.length > 0 || competition.entry_mode !== "guest")
    && competition.currency !== "NGN"
  ) {
    throw new ApiError(
      503,
      "cash_currency_not_supported",
      "Cash League prizes must be configured in NGN before the competition can open.",
    );
  }
  if (
    !isServerRehearsal(competition)
    && (prizes.length > 0 || competition.entry_mode !== "guest")
    && (!cashReadiness.available || !controls.cash_enabled)
  ) {
    throw new ApiError(
      503,
      "cash_launch_gated",
      "Prize competition is unavailable until every launch gate is evidenced and cash is explicitly enabled.",
      { mode: "practice", prize_eligible: false, blockers: cashReadiness.blockers },
    );
  }
  await validatedCompetitionPack(db, competition);
  return json({
    competition: competitionPayload(
      competition,
      prizes,
      cashReadiness.available,
      controls.cash_enabled,
      !isAndroidLeagueClient(request) || androidCashEntryEnabled(env),
    ),
  });
}

async function loadCompetitionPack(
  db: D1Database,
  competitionId: string,
): Promise<CompetitionCard[]> {
  const [cardResult, optionResult] = await Promise.all([
    db
      .prepare(
        `SELECT
          id, source_card_id, position, content_version, category, answer_family, clues_json,
          correct_option_id, difficulty, editorial_status, voided_at
        FROM competition_cards
        WHERE competition_id = ?1
        ORDER BY position ASC`,
      )
      .bind(competitionId)
      .all<CardRow>(),
    db
      .prepare(
        `SELECT
          o.card_id, o.option_id, o.position, o.label, o.category, o.answer_family
        FROM competition_card_options o
        JOIN competition_cards c ON c.id = o.card_id
        WHERE c.competition_id = ?1
        ORDER BY c.position ASC, o.position ASC`,
      )
      .bind(competitionId)
      .all<OptionRow>(),
  ]);

  const optionsByCard = new Map<string, OptionRow[]>();
  for (const option of optionResult.results ?? []) {
    const options = optionsByCard.get(option.card_id) ?? [];
    options.push(option);
    optionsByCard.set(option.card_id, options);
  }

  return (cardResult.results ?? []).map((card) => {
    let clues: string[] = [];
    try {
      const parsed = JSON.parse(card.clues_json) as unknown;
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
        clues = parsed;
      }
    } catch {
      clues = [];
    }

    return {
      id: card.id,
      sourceCardId: card.source_card_id,
      position: card.position,
      contentVersion: card.content_version,
      category: card.category,
      answerFamily: card.answer_family,
      clues,
      correctOptionId: card.correct_option_id,
      difficulty: card.difficulty,
      editorialStatus: card.editorial_status,
      voidedAt: card.voided_at,
      options: (optionsByCard.get(card.id) ?? []).map((option) => ({
        id: option.option_id,
        label: option.label,
        position: option.position,
        category: option.category,
        answerFamily: option.answer_family,
      })),
    };
  });
}

async function ownerCompetitionCardPreview(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeCardPreview(request, env);
  const db = database(env);
  await reconcileCompetitionLifecycle(db);
  const competitionID = new URL(request.url).searchParams.get("competition_id")?.trim() || undefined;
  const competition = competitionID
    ? await db.prepare(`SELECT * FROM competitions WHERE id = ?1 AND content_status = 'published' LIMIT 1`).bind(competitionID).first<CompetitionRow>()
    : await db.prepare(`SELECT * FROM competitions
        WHERE content_status = 'published' AND status IN ('open', 'scheduled', 'locked')
        ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, opens_at DESC LIMIT 1`).first<CompetitionRow>();
  if (!competition) {
    throw new ApiError(404, "card_preview_competition_not_found", "No open published League round is available for preview.");
  }
  const cards = await loadCompetitionPack(db, competition.id);
  const issues = validateCompetitionPack(cards, competition.question_count);
  if (issues.length > 0) {
    throw new ApiError(409, "card_preview_pack_invalid", "The published League card pack is not ready for preview.", { issues });
  }
  await recordAdminAudit(
    db,
    authorization,
    "card_preview_opened",
    "competition",
    competition.id,
    "Owner opened the read-only in-app silent card preview.",
    { card_count: cards.length },
  );
  return json({
    preview: {
      competition_id: competition.id,
      title: competition.title,
      slug: competition.slug,
      pack_version: competition.pack_version,
      updated_at: Date.now(),
      cards: cards.map((card) => ({
        id: card.id,
        position: card.position,
        content_version: card.contentVersion,
        category: card.category,
        answer_family: card.answerFamily,
        clues: card.clues,
        correct_option_id: card.correctOptionId,
        difficulty: card.difficulty,
        options: card.options.map((option) => ({
          id: option.id,
          label: option.label,
          position: option.position,
          category: option.category,
          answer_family: option.answerFamily,
        })),
      })),
    },
  });
}

async function getOwnerCardPreviewTokenStatus(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const row = await database(env).prepare(`SELECT created_at FROM owner_card_preview_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`).first<{ created_at: number }>();
  return json({ active: Boolean(row), created_at: row?.created_at ?? null });
}

async function issueOwnerCardPreviewToken(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const token = createOpaqueToken("wbd_preview");
  const now = Date.now();
  const db = database(env);
  await db.batch([
    db.prepare(`UPDATE owner_card_preview_tokens SET revoked_at = ?1 WHERE revoked_at IS NULL`).bind(now),
    db.prepare(`INSERT INTO owner_card_preview_tokens (id, token_hash, created_by, created_at) VALUES (?1, ?2, ?3, ?4)`).bind(crypto.randomUUID(), await sha256Hex(token), authorization.publishedBy, now),
  ]);
  await recordAdminAudit(db, authorization, "card_preview_token_issued", "owner_card_preview_token", null, "Issued a new read-only phone card-preview token.");
  return json({ issued: true, token, created_at: now, warning: "Copy this token now. It will not be shown again." }, 201);
}

async function loadPublicContentSources(
  db: D1Database,
): Promise<PublicContentDocuments[]> {
  const sources: PublicContentDocuments[] = [
    {
      partyDeck: bundledPublicRelease.party_deck,
      soloGist: bundledPublicRelease.solo_gist,
    },
    { practiceCompetition: bundledCompetitionPractice },
  ];
  const result = await db
    .prepare(
      `SELECT a.kind, a.payload_json
       FROM content_assets a
       JOIN content_releases r ON r.id = a.release_id
       WHERE r.status IN ('published', 'superseded', 'revoked')`,
    )
    .all<{ kind: string; payload_json: string }>();
  for (const row of result.results ?? []) {
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload_json) as unknown;
    } catch {
      throw new ApiError(
        503,
        "public_content_fingerprint_unavailable",
        "Competition isolation could not be verified.",
      );
    }
    if (row.kind === PARTY_DECK_KIND) sources.push({ partyDeck: payload });
    if (row.kind === SOLO_GIST_KIND) sources.push({ soloGist: payload });
  }
  return sources;
}

async function validatedCompetitionPack(
  db: D1Database,
  competition: CompetitionRow,
): Promise<CompetitionCard[]> {
  const cards = await loadCompetitionPack(db, competition.id);
  const packIssues = validateCompetitionPack(cards, competition.question_count);
  if (packIssues.length > 0) {
    throw new ApiError(
      409,
      "competition_pack_not_ready",
      "The competition pack did not pass editorial validation.",
      { issues: packIssues.slice(0, 25) },
    );
  }

  // The one explicitly labelled internal rehearsal is intentionally built
  // from Today’s 5 to test the complete protected League interaction with
  // friends. Every other competition remains isolated from public content.
  const isolationIssues = isServerRehearsal(competition)
    ? []
    : validateCompetitionIsolation(cards, await loadPublicContentSources(db));
  if (isolationIssues.length > 0) {
    throw new ApiError(
      409,
      "competition_pack_not_isolated",
      "This competition is unavailable because its private pack overlaps public content.",
      { issues: isolationIssues.slice(0, 25) },
    );
  }
  return cards;
}

function packConfiguration(competition: CompetitionRow) {
  return {
    rulesVersion: competition.rules_version,
    packVersion: competition.pack_version,
    scoringVersion: competition.scoring_version,
    questionCount: competition.question_count,
    perCardLimitMs: competition.per_card_limit_ms,
    uploadGraceMs: competition.upload_grace_ms,
  };
}

async function competitionPackHash(
  competition: CompetitionRow,
  cards: CompetitionCard[],
): Promise<string> {
  return sha256Hex(canonicalCompetitionPack(packConfiguration(competition), cards));
}

async function startAttempt(
  request: Request,
  env: ApiEnv,
  competitionId: string,
): Promise<Response> {
  const controls = (await publishedAppConfig(env)).events.odogwu_league;
  if (!controls.enabled) {
    throw new ApiError(404, "league_disabled", "Odogwu League is unavailable.");
  }
  if (!controls.entry_enabled) {
    throw new ApiError(409, "league_entries_closed", "Odogwu League entries are closed right now.");
  }
  const db = database(env);
  const player = await authenticate(request, db);
  const competition = await getActiveCompetition(db, competitionId);
  if (!competition) {
    throw new ApiError(404, "competition_not_open", "This competition is not open.");
  }

  const configuredPrizes = await prizePayload(db, competition.id);
  const isCashAttempt =
    configuredPrizes.length > 0 || competition.entry_mode !== "guest";
  if (!isServerRehearsal(competition) && isCashAttempt
    && isAndroidLeagueClient(request) && !androidCashEntryEnabled(env)) {
    throw new ApiError(403, "android_cash_entry_not_approved", "Android prize entry is not enabled for this League scope.");
  }
  if (!isServerRehearsal(competition) && isCashAttempt && competition.currency !== "NGN") {
    throw new ApiError(
      503,
      "cash_currency_not_supported",
      "Cash League prizes must be configured in NGN before an attempt can start.",
    );
  }
  const cashReadiness = await cashLaunchReadiness(db);
  if (
    !isServerRehearsal(competition)
    && isCashAttempt
    && (!cashReadiness.available || !controls.cash_enabled)
  ) {
    throw new ApiError(
      503,
      "cash_launch_gated",
      "Prize attempts remain unavailable until every launch gate is evidenced and cash is explicitly enabled.",
      {
        mode: "practice",
        phone_verification_required: true,
        device_attestation_required: true,
        trusted_timing_required: true,
        blockers: cashReadiness.blockers,
      },
    );
  }

  if (
    competition.entry_mode === "phone_verified" &&
    player.phoneVerifiedAt === null
  ) {
    throw new ApiError(
      403,
      "phone_verification_required",
      "Phone verification is required for a prize-eligible attempt.",
    );
  }
  if (
    competition.entry_mode !== "guest" &&
    (player.eligibilityStatus !== "eligible" ||
      player.acceptedRulesVersion !== competition.rules_version)
  ) {
    throw new ApiError(
      403,
      "competition_eligibility_required",
      "Competition eligibility and official-rules acceptance are required.",
      {
        rules_version: competition.rules_version,
        minimum_age: competition.minimum_age,
        country_code: competition.country_code,
      },
    );
  }
  if (
    competition.entry_mode !== "guest" &&
    !competitionEligibleCountries(competition).includes(normalizedCountryCode(player.countryCode))
  ) {
    throw new ApiError(
      403,
      "competition_country_ineligible",
      "This League round is not available in your verified eligibility country.",
      { eligible_countries: competitionEligibleCountries(competition) },
    );
  }

  const existing = await db
    .prepare(
      `SELECT id, status
       FROM attempts
       WHERE competition_id = ?1 AND player_id = ?2
       LIMIT 1`,
    )
    .bind(competition.id, player.id)
    .first<{ id: string; status: string }>();
  if (existing) {
    throw new ApiError(
      409,
      "attempt_already_used",
      "Only one prize-eligible attempt is allowed for this competition.",
      { attempt_id: existing.id, status: existing.status },
    );
  }

  if (isCashAttempt && isAndroidLeagueClient(request)) playIntegrityConfiguration(env);
  const cards = await validatedCompetitionPack(db, competition);
  const packHash = await competitionPackHash(competition, cards);

  const attemptId = crypto.randomUUID();
  const attemptToken = createOpaqueToken("wbd_a");
  const attemptTokenHash = await sha256Hex(attemptToken);
  const deliveryProtocol = isCashAttempt
    ? "cash_sequential_v1"
    : "practice_batch_v1";
  const startedAt = Date.now();
  const playDeadlineAt =
    startedAt + competition.question_count * competition.per_card_limit_ms;
  const submitDeadlineAt = playDeadlineAt + competition.upload_grace_ms;

  const creationStatements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO attempts (
          id, competition_id, player_id, attempt_token_hash, status,
          rules_version, pack_version, pack_hash, scoring_version, delivery_protocol,
          started_at, play_deadline_at, submit_deadline_at,
          integrity_status, score_status, created_at, updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, 'started',
          ?5, ?6, ?7, ?8, ?9,
          ?10, ?11, ?12,
          'pending', 'unscored', ?10, ?10
        )`,
      )
      .bind(
        attemptId,
        competition.id,
        player.id,
        attemptTokenHash,
        competition.rules_version,
        competition.pack_version,
        packHash,
        competition.scoring_version,
        deliveryProtocol,
        startedAt,
        playDeadlineAt,
        submitDeadlineAt,
      ),
  ];
  if (isCashAttempt) {
    // The attempt record and its first server-issued card are one transaction.
    // A retry must never find a started cash attempt with no active card.
    creationStatements.push(
      db
        .prepare(
          `INSERT INTO attempt_card_issues (
            attempt_id, ordinal, card_id, issued_at
          ) VALUES (?1, 1, ?2, ?3)`,
        )
        .bind(attemptId, cards[0].id, startedAt),
    );
  }
  try {
    await db.batch(creationStatements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("unique")) {
      throw new ApiError(
        409,
        "attempt_already_used",
        "Only one prize-eligible attempt is allowed for this competition.",
      );
    }
    throw error;
  }

  return json(
    {
      attempt: {
        id: attemptId,
        token: attemptToken,
        competition_id: competition.id,
        rules_version: competition.rules_version,
        pack_version: competition.pack_version,
        scoring_version: competition.scoring_version,
        delivery_protocol: deliveryProtocol,
        integrity_protocol: isCashAttempt && isAndroidLeagueClient(request) ? "play_integrity_standard_v1" : undefined,
        device_verification_required: isCashAttempt && isAndroidLeagueClient(request) ? true : undefined,
        started_at: startedAt,
        play_deadline_at: playDeadlineAt,
        submit_deadline_at: submitDeadlineAt,
        // Practice intentionally keeps its existing batch flow. Cash does not
        // release card one until the iOS App Attest key is registered.
        cards: isCashAttempt
          ? []
          : cards.map((card) =>
              publicCompetitionCard(card, competition.per_card_limit_ms),
            ),
        card: undefined,
        card_deadline_at: undefined,
      },
    },
    201,
  );
}

function isAndroidLeagueClient(request: Request): boolean {
  return request.headers.get("x-wbd-client") === "WetinBeDis-Android";
}
function androidCashEntryEnabled(env: ApiEnv): boolean {
  return env.WBD_ANDROID_CASH_ENTRY_ENABLED?.trim().toLowerCase() === "true";
}
type AndroidChallenge = {
  id: string; nonce: string; request_hash: string; purpose: "registration" | "cash_answer";
  card_ordinal: number | null; selected_option_id: string | null; issued_at: number; expires_at: number;
};
async function androidAttemptContext(request: Request, env: ApiEnv, attemptId: string) {
  const db = database(env);
  const player = await authenticate(request, db);
  const token = request.headers.get("x-wbd-attempt-token") ?? "";
  if (!/^wbd_a_[A-Za-z0-9_-]{40,80}$/.test(token)) throw new ApiError(401, "attempt_token_required", "The signed attempt token is required.");
  const attempt = await db.prepare(`SELECT a.id, a.competition_id, a.status, a.delivery_protocol, a.play_deadline_at,
      c.question_count, c.per_card_limit_ms, c.upload_grace_ms
    FROM attempts a JOIN competitions c ON c.id = a.competition_id
    WHERE a.id = ?1 AND a.player_id = ?2 AND a.attempt_token_hash = ?3 LIMIT 1`)
    .bind(attemptId, player.id, await sha256Hex(token)).first<{
      id: string; competition_id: string; status: string; delivery_protocol: string; play_deadline_at: number;
      question_count: number; per_card_limit_ms: number; upload_grace_ms: number;
    }>();
  if (!attempt) throw new ApiError(404, "attempt_not_found", "The attempt could not be found.");
  if (attempt.status !== "started" || attempt.delivery_protocol !== "cash_sequential_v1") throw new ApiError(409, "cash_attempt_required", "This cash attempt is not active.");
  if (Date.now() >= attempt.play_deadline_at) throw new ApiError(410, "attempt_expired", "The attempt play window has closed.");
  const binding = await db.prepare("SELECT platform FROM attempt_device_bindings WHERE attempt_id = ?1").bind(attemptId).first<{ platform: string }>();
  if (binding && binding.platform !== "android-play-integrity") throw new ApiError(409, "attempt_device_platform_mismatch", "This attempt belongs to another verified platform.");
  return { db, player, attempt };
}
function androidChallengePayload(row: AndroidChallenge, env: ApiEnv) {
  return { challenge_id: row.id, request_hash: row.request_hash, cloud_project_number: playIntegrityConfiguration(env).cloudProjectNumber,
    purpose: row.purpose, expires_at: row.expires_at };
}
async function issueAndroidIntegrityChallenge(request: Request, env: ApiEnv, attemptId: string, purpose: "registration" | "cash_answer"): Promise<Response> {
  playIntegrityConfiguration(env);
  const { db, player, attempt } = await androidAttemptContext(request, env, attemptId);
  const registered = await db.prepare("SELECT attempt_id FROM android_integrity_verifications WHERE attempt_id = ?1 AND player_id = ?2")
    .bind(attemptId, player.id).first<{ attempt_id: string }>();
  if (purpose === "registration" && registered) throw new ApiError(409, "android_device_already_verified", "This attempt is already verified. Resume the saved round.");
  if (purpose === "cash_answer" && !registered) throw new ApiError(403, "play_integrity_registration_required", "Verify this Android installation before answering.");
  let ordinal: number | null = null;
  let selection: string | null = null;
  if (purpose === "cash_answer") {
    selection = cashSelectedOption(await readJsonObject(request));
    const issued = await db.prepare("SELECT ordinal, card_id FROM attempt_card_issues WHERE attempt_id = ?1 AND answered_at IS NULL ORDER BY ordinal ASC LIMIT 1")
      .bind(attemptId).first<{ ordinal: number; card_id: string }>();
    if (!issued) throw new ApiError(409, "cash_attempt_issue_missing", "There is no active card to answer.");
    const cards = await loadCompetitionPack(db, attempt.competition_id);
    const card = cards.find((value) => value.id === issued.card_id && value.position === issued.ordinal);
    if (!card) throw new ApiError(409, "competition_under_review", "The active competition card is unavailable.");
    if (selection !== null && !card.options.some((option) => option.id === selection)) throw new ApiError(400, "unknown_option", "The selected option is not part of this card.");
    ordinal = issued.ordinal;
  }
  const now = Date.now();
  const existing = await db.prepare(`SELECT id, nonce, request_hash, purpose, card_ordinal, selected_option_id, issued_at, expires_at
    FROM android_integrity_challenges WHERE attempt_id = ?1 AND player_id = ?2 AND purpose = ?3
      AND card_ordinal IS ?4 AND selected_option_id IS ?5 AND consumed_at IS NULL AND expires_at > ?6 LIMIT 1`)
    .bind(attemptId, player.id, purpose, ordinal, selection, now).first<AndroidChallenge>();
  if (existing) return json({ challenge: androidChallengePayload(existing, env) });
  const id = crypto.randomUUID();
  const nonce = createBase64UrlNonce(32);
  const expiresAt = Math.min(now + 90000, attempt.play_deadline_at);
  if (expiresAt <= now) throw new ApiError(410, "attempt_expired", "The attempt play window has closed.");
  const requestHash = await playIntegrityRequestHash({ purpose, challengeId: id, nonce, playerId: player.id, attemptId, ordinal, selectedOptionId: selection });
  await db.prepare(`INSERT INTO android_integrity_challenges (id, player_id, attempt_id, purpose, nonce, request_hash, card_ordinal, selected_option_id, issued_at, expires_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
    .bind(id, player.id, attemptId, purpose, nonce, requestHash, ordinal, selection, now, expiresAt).run();
  return json({ challenge: androidChallengePayload({ id, nonce, request_hash: requestHash, purpose, card_ordinal: ordinal, selected_option_id: selection, issued_at: now, expires_at: expiresAt }, env) }, 201);
}
function requiredAndroidProof(payload: Record<string, unknown>): { challengeId: string; requestHash: string; token: string } {
  const proof = payload.integrity_proof;
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) throw new ApiError(403, "play_integrity_required", "A verified Android device proof is required.");
  const value = proof as Record<string, unknown>;
  if (value.platform !== "android-play-integrity" || typeof value.challenge_id !== "string" || !value.challenge_id || value.challenge_id.length > 128
    || typeof value.request_hash !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.request_hash) || typeof value.token !== "string") {
    throw new ApiError(403, "play_integrity_required", "A verified Android device proof is required.");
  }
  return { challengeId: value.challenge_id, requestHash: value.request_hash, token: value.token };
}
async function verifyAndConsumeAndroidProof(db: D1Database, playerId: string, attemptId: string,
  purpose: "registration" | "cash_answer", ordinal: number | null, selectedOptionId: string | null, payload: Record<string, unknown>, env: ApiEnv) {
  const proof = requiredAndroidProof(payload);
  const row = await db.prepare(`SELECT id, nonce, request_hash, purpose, card_ordinal, selected_option_id, issued_at, expires_at
    FROM android_integrity_challenges WHERE id = ?1 AND player_id = ?2 AND attempt_id = ?3 AND purpose = ?4
      AND card_ordinal IS ?5 AND consumed_at IS NULL AND expires_at > ?6 LIMIT 1`)
    .bind(proof.challengeId, playerId, attemptId, purpose, ordinal, Date.now()).first<AndroidChallenge>();
  if (!row) throw new ApiError(409, "play_integrity_challenge_invalid", "This secured request expired or was already used. Try again.");
  const expectedHash = await playIntegrityRequestHash({ purpose, challengeId: row.id, nonce: row.nonce, playerId, attemptId, ordinal, selectedOptionId });
  if (row.selected_option_id !== selectedOptionId || expectedHash !== row.request_hash || proof.requestHash !== expectedHash) {
    throw new ApiError(403, "play_integrity_binding_invalid", "This secured request does not match the active card and choice.");
  }
  const verified = await verifyPlayIntegrityToken({ config: playIntegrityConfiguration(env), token: proof.token, requestHash: expectedHash, issuedAt: row.issued_at, expiresAt: row.expires_at });
  const now = Date.now();
  let consumed: { id: string } | null;
  try {
    consumed = await db.prepare(`UPDATE android_integrity_challenges SET consumed_at = ?2, token_hash = ?3
      WHERE id = ?1 AND consumed_at IS NULL AND expires_at > ?2 RETURNING id`)
      .bind(row.id, now, await sha256Hex(proof.token)).first<{ id: string }>();
  } catch { throw new ApiError(409, "play_integrity_token_replayed", "This Android proof was already used."); }
  if (!consumed) throw new ApiError(409, "play_integrity_challenge_replayed", "This secured request was already used.");
  return verified;
}
async function registerAndroidIntegrity(request: Request, env: ApiEnv, attemptId: string): Promise<Response> {
  const { db, player, attempt } = await androidAttemptContext(request, env, attemptId);
  const existing = await db.prepare("SELECT attempt_id FROM android_integrity_verifications WHERE attempt_id = ?1").bind(attemptId).first();
  if (existing) throw new ApiError(409, "android_device_already_verified", "This attempt is already verified. Resume the saved round.");
  const answered = await db.prepare("SELECT ordinal FROM attempt_card_issues WHERE attempt_id = ?1 AND answered_at IS NOT NULL LIMIT 1").bind(attemptId).first();
  if (answered) throw new ApiError(409, "attempt_already_started", "An active round cannot switch verification platforms.");
  const verified = await verifyAndConsumeAndroidProof(db, player.id, attemptId, "registration", null, null, await readJsonObject(request), env);
  const now = Date.now();
  const origin = await claimAttemptDeviceBinding(db, attemptId, player.id, "android-play-integrity", now);
  const playDeadline = origin + attempt.question_count * attempt.per_card_limit_ms;
  await db.batch([
    db.prepare(`INSERT INTO android_integrity_verifications (attempt_id, player_id, package_name, version_code, certificates_json, registered_at, last_verified_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`).bind(attemptId, player.id, verified.packageName, verified.versionCode, JSON.stringify(verified.certificates), origin, now),
    db.prepare("UPDATE attempts SET started_at = ?2, play_deadline_at = ?3, submit_deadline_at = ?4, updated_at = ?5 WHERE id = ?1 AND status = 'started'")
      .bind(attemptId, origin, playDeadline, playDeadline + attempt.upload_grace_ms, now),
    db.prepare("UPDATE attempt_card_issues SET issued_at = ?2 WHERE attempt_id = ?1 AND ordinal = 1 AND answered_at IS NULL").bind(attemptId, origin),
  ]);
  return json({ device: { status: "verified", platform: "android-play-integrity", verified_at: now } }, 201);
}
async function verifyAndroidCashAnswer(db: D1Database, playerId: string, attemptId: string, ordinal: number,
  selection: string | null, payload: Record<string, unknown>, env: ApiEnv): Promise<void> {
  const registered = await db.prepare("SELECT attempt_id FROM android_integrity_verifications WHERE attempt_id = ?1 AND player_id = ?2")
    .bind(attemptId, playerId).first();
  if (!registered) throw new ApiError(403, "play_integrity_registration_required", "Verify this Android installation before answering.");
  await verifyAndConsumeAndroidProof(db, playerId, attemptId, "cash_answer", ordinal, selection, payload, env);
  await db.prepare("UPDATE android_integrity_verifications SET last_verified_at = ?2 WHERE attempt_id = ?1").bind(attemptId, Date.now()).run();
}

async function resumeActiveAttempt(request: Request, env: ApiEnv, competitionId: string): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const attemptToken = request.headers.get("x-wbd-attempt-token") ?? "";
  const attempt = await db.prepare(`SELECT a.id, a.competition_id, a.attempt_token_hash, a.status, a.rules_version, a.pack_version, a.scoring_version, a.delivery_protocol, a.started_at, a.play_deadline_at, a.submit_deadline_at, c.question_count, c.per_card_limit_ms FROM attempts a JOIN competitions c ON c.id = a.competition_id WHERE a.competition_id = ?1 AND a.player_id = ?2 ORDER BY a.created_at DESC LIMIT 1`).bind(competitionId, player.id).first<{ id: string; competition_id: string; attempt_token_hash: string; status: string; rules_version: string; pack_version: string; scoring_version: string; delivery_protocol: string; started_at: number; play_deadline_at: number; submit_deadline_at: number; question_count: number; per_card_limit_ms: number }>();
  if (!attempt) throw new ApiError(404, "active_attempt_not_found", "No League attempt is in progress.");
  if (!/^wbd_a_[A-Za-z0-9_-]{40,80}$/.test(attemptToken) || await sha256Hex(attemptToken) !== attempt.attempt_token_hash) throw new ApiError(401, "attempt_token_required", "The signed attempt token is required to resume this attempt.");
  const now = Date.now();
  if (attempt.status !== "started" || now >= attempt.submit_deadline_at) throw new ApiError(410, "attempt_finished", "This League attempt has finished.");
  const issued = await db.prepare(`SELECT ordinal, card_id, issued_at, answered_at FROM attempt_card_issues WHERE attempt_id = ?1 ORDER BY ordinal DESC LIMIT 1`).bind(attempt.id).first<{ ordinal: number; card_id: string; issued_at: number; answered_at: number | null }>();
  if (!issued || issued.answered_at !== null) throw new ApiError(409, "attempt_state_unavailable", "The current League question is not available to resume.");
  const attemptCompetition = await db.prepare(
    "SELECT slug FROM competitions WHERE id = ?1 LIMIT 1",
  ).bind(attempt.competition_id).first<{ slug: string }>();
  const requiresDeviceVerification = attempt.delivery_protocol === "cash_sequential_v1"
    && (isAndroidLeagueClient(request) || !hasInternalRehearsalSimulatorBypass(request, attemptCompetition?.slug ?? ""));
  let registeredKey: { key_id: string } | null;
  if (requiresDeviceVerification && isAndroidLeagueClient(request)) {
    const verified = await db.prepare("SELECT attempt_id FROM android_integrity_verifications WHERE attempt_id = ?1 AND player_id = ?2")
      .bind(attempt.id, player.id).first<{ attempt_id: string }>();
    registeredKey = verified ? { key_id: "android-play-integrity" } : null;
  } else if (requiresDeviceVerification) {
    const { appID, environment } = appAttestConfiguration(env);
    const localKeyID = request.headers.get("x-wbd-app-attest-key-id")?.trim() ?? "";
    registeredKey = await db.prepare(
      `SELECT key_id FROM app_attest_keys
       WHERE player_id = ?1 AND app_id = ?2 AND environment = ?3
         AND key_id = ?4 AND revoked_at IS NULL
       LIMIT 1`,
    ).bind(player.id, appID, environment, localKeyID).first<{ key_id: string }>();
  } else {
    registeredKey = { key_id: "practice" };
  }
  if (!registeredKey) {
    return json({
      attempt: {
        id: attempt.id,
        competition_id: attempt.competition_id,
        token: attemptToken,
        rules_version: attempt.rules_version,
        pack_version: attempt.pack_version,
        scoring_version: attempt.scoring_version,
        delivery_protocol: attempt.delivery_protocol,
        started_at: attempt.started_at,
        play_deadline_at: attempt.play_deadline_at,
        submit_deadline_at: attempt.submit_deadline_at,
        answered_count: issued.ordinal - 1,
        cards: [],
        card: undefined,
        card_deadline_at: undefined,
        device_verification_required: true,
        integrity_protocol: isAndroidLeagueClient(request) ? "play_integrity_standard_v1" : undefined,
      },
    });
  }
  const cards = await loadCompetitionPack(db, attempt.competition_id);
  const card = cards.find((value) => value.id === issued.card_id);
  if (!card) throw new ApiError(409, "competition_under_review", "The League content is unavailable.");
  return json({ attempt: { id: attempt.id, competition_id: attempt.competition_id, token: attemptToken, integrity_protocol: isAndroidLeagueClient(request) ? "play_integrity_standard_v1" : undefined, device_verification_required: isAndroidLeagueClient(request) ? false : undefined, rules_version: attempt.rules_version, pack_version: attempt.pack_version, scoring_version: attempt.scoring_version, delivery_protocol: attempt.delivery_protocol, started_at: attempt.started_at, play_deadline_at: attempt.play_deadline_at, submit_deadline_at: attempt.submit_deadline_at, answered_count: issued.ordinal - 1, cards: [], card: publicCompetitionCard(card, attempt.per_card_limit_ms), card_deadline_at: issued.issued_at + attempt.per_card_limit_ms } });
}

function submittedAnswers(payload: Record<string, unknown>): SubmittedAnswer[] {
  if (!Array.isArray(payload.answers)) {
    throw new ApiError(400, "answers_required", "An answers array is required.");
  }

  return payload.answers.map((value, index) => {
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new ApiError(400, "invalid_answer", "Every answer must be an object.", {
        index,
      });
    }
    const answer = value as Record<string, unknown>;
    if (
      typeof answer.card_id !== "string" ||
      !Number.isInteger(answer.position) ||
      !Number.isInteger(answer.response_ms) ||
      !(
        typeof answer.selected_option_id === "string" ||
        answer.selected_option_id === null
      )
    ) {
      throw new ApiError(
        400,
        "invalid_answer",
        "Each answer requires card_id, position, selected_option_id, and response_ms.",
        { index },
      );
    }
    return {
      cardId: answer.card_id,
      position: answer.position as number,
      selectedOptionId: answer.selected_option_id as string | null,
      responseMs: answer.response_ms as number,
    };
  });
}

async function submitAttempt(
  request: Request,
  env: ApiEnv,
  attemptId: string,
): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const attemptToken = request.headers.get("x-wbd-attempt-token") ?? "";
  if (!/^wbd_a_[A-Za-z0-9_-]{40,80}$/.test(attemptToken)) {
    throw new ApiError(
      401,
      "attempt_token_required",
      "The signed attempt token is required.",
    );
  }
  const attemptTokenHash = await sha256Hex(attemptToken);
  const attempt = await db
    .prepare(
      `SELECT
        a.id, a.competition_id, a.status, a.rules_version, a.pack_version,
        a.pack_hash, a.scoring_version, a.delivery_protocol,
        c.rules_version AS current_rules_version,
        c.pack_version AS current_pack_version,
        c.scoring_version AS current_scoring_version,
        a.started_at, a.play_deadline_at, a.submit_deadline_at,
        a.submitted_at, a.correct_count, a.adjusted_total_ms, a.hard_card_ms,
        a.score_status, c.question_count, c.per_card_limit_ms, c.upload_grace_ms
      FROM attempts a
      JOIN competitions c ON c.id = a.competition_id
      WHERE a.id = ?1
        AND a.player_id = ?2
        AND a.attempt_token_hash = ?3
      LIMIT 1`,
    )
    .bind(attemptId, player.id, attemptTokenHash)
    .first<AttemptRow>();

  if (!attempt) {
    throw new ApiError(404, "attempt_not_found", "The attempt could not be found.");
  }
  if (attempt.status === "submitted") {
    throw new ApiError(409, "attempt_already_submitted", "This attempt is already submitted.", {
      correct_count: attempt.correct_count,
      adjusted_total_ms: attempt.adjusted_total_ms,
      hard_card_ms: attempt.hard_card_ms,
      score_status: attempt.score_status,
    });
  }
  if (attempt.status !== "started") {
    throw new ApiError(409, "attempt_not_active", "This attempt is no longer active.");
  }
  if (attempt.delivery_protocol !== "practice_batch_v1") {
    throw new ApiError(
      409,
      "cash_sequential_answer_required",
      "Cash attempts must be answered one server-issued card at a time.",
    );
  }

  const now = Date.now();
  if (now > attempt.submit_deadline_at) {
    await db
      .prepare(
        `UPDATE attempts
         SET status = 'expired', updated_at = ?2
         WHERE id = ?1 AND status = 'started'`,
      )
      .bind(attempt.id, now)
      .run();
    throw new ApiError(410, "attempt_expired", "The attempt submission window has closed.");
  }

  const payload = await readJsonObject(request);
  const answers = submittedAnswers(payload);
  const cards = await loadCompetitionPack(db, attempt.competition_id);
  const packIssues = validateCompetitionPack(cards, attempt.question_count);
  if (packIssues.length > 0) {
    throw new ApiError(
      409,
      "competition_under_review",
      "Scoring is paused while the competition pack is reviewed.",
      { issues: packIssues.slice(0, 25) },
    );
  }
  const isolationIssues = validateCompetitionIsolation(
    cards,
    await loadPublicContentSources(db),
  );
  if (isolationIssues.length > 0) {
    throw new ApiError(
      409,
      "competition_under_review",
      "Scoring is paused while the competition pack is reviewed.",
      { issues: isolationIssues.slice(0, 25) },
    );
  }
  const currentCompetition: CompetitionRow = {
    id: attempt.competition_id,
    slug: "",
    title: "",
    status: "",
    content_status: "",
    rules_version: attempt.current_rules_version,
    pack_version: attempt.current_pack_version,
    scoring_version: attempt.current_scoring_version,
    question_count: attempt.question_count,
    per_card_limit_ms: attempt.per_card_limit_ms,
    upload_grace_ms: attempt.upload_grace_ms,
    entry_mode: "guest",
    country_code: "",
    minimum_age: 0,
    currency: "",
    opens_at: 0,
    closes_at: 0,
    score_review_closes_at: 0,
  };
  const currentPackHash = await competitionPackHash(currentCompetition, cards);
  if (
    attempt.pack_hash === null
    || attempt.rules_version !== attempt.current_rules_version
    || attempt.pack_version !== attempt.current_pack_version
    || attempt.scoring_version !== attempt.current_scoring_version
    || attempt.pack_hash !== currentPackHash
  ) {
    throw new ApiError(
      409,
      "competition_under_review",
      "Scoring is paused because this attempt's pinned pack no longer matches the competition.",
    );
  }

  const serverElapsedMs = now - attempt.started_at;
  const score = scoreSubmission({
    cards,
    answers,
    perCardLimitMs: attempt.per_card_limit_ms,
    serverElapsedMs,
    uploadGraceMs: attempt.upload_grace_ms,
  });
  const submissionHash = await sha256Hex(canonicalSubmission(attempt.id, answers));
  const integrityFlags = [...new Set([...score.integrityFlags, "client_timing_untrusted"])];
  const integrityStatus = "review";

  const statements: D1PreparedStatement[] = score.answers.map((answer) =>
    db
      .prepare(
        `INSERT INTO attempt_answers (
          attempt_id, card_id, ordinal, selected_option_id,
          client_response_ms, is_correct, answer_version, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        attempt.id,
        answer.cardId,
        answer.position,
        answer.selectedOptionId ?? "__timeout__",
        answer.responseMs,
        answer.isCorrect ? 1 : 0,
        answer.answerVersion,
        now,
      ),
  );
  statements.push(
    db
      .prepare(
        `UPDATE attempts SET
          status = 'submitted',
          submitted_at = ?2,
          client_active_ms = ?3,
          server_elapsed_ms = ?4,
          adjusted_total_ms = ?5,
          correct_count = ?6,
          hard_card_ms = ?7,
          integrity_status = ?8,
          integrity_flags_json = ?9,
          submission_hash = ?10,
          score_status = 'provisional',
          updated_at = ?2
        WHERE id = ?1 AND status = 'started'`,
      )
      .bind(
        attempt.id,
        now,
        score.clientActiveMs,
        serverElapsedMs,
        score.adjustedTotalMs,
        score.correctCount,
        score.hardCardMs,
        integrityStatus,
        JSON.stringify(integrityFlags),
        submissionHash,
      ),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("unique")) {
      throw new ApiError(409, "attempt_already_submitted", "This attempt is already submitted.");
    }
    throw error;
  }

  return json({
    attempt_id: attempt.id,
    status: "finished",
    answered_count: attempt.question_count,
    question_count: attempt.question_count,
    score: {
      attempt_id: attempt.id,
      correct_count: score.correctCount,
      question_count: attempt.question_count,
      adjusted_total_ms: score.adjustedTotalMs,
      hard_card_ms: score.hardCardMs,
      status: "provisional",
      integrity_status: integrityStatus,
      integrity_flags: integrityFlags,
      prize_eligible: false,
      timing_trust: "client_reported_untrusted",
      ranking_order: [
        "correct_count_desc",
        "adjusted_total_ms_asc",
        "hard_card_ms_asc",
      ],
    },
  });
}

function cashSelectedOption(payload: Record<string, unknown>): string | null {
  // Earlier iOS builds encoded an Optional nil by omitting this key entirely.
  // Treat that legacy shape as an explicit skip so an already-released client
  // can finish a timed-out card instead of being stranded mid-round. Newer
  // clients always send the unambiguous JSON null.
  if (!Object.prototype.hasOwnProperty.call(payload, "selected_option_id")) {
    return null;
  }
  const selectedOptionID = payload.selected_option_id;
  if (!(typeof selectedOptionID === "string" || selectedOptionID === null)) {
    throw new ApiError(
      400,
      "invalid_cash_selection",
      "A cash answer requires selected_option_id or null for a skip.",
    );
  }
  return selectedOptionID;
}

function appAttestConfiguration(env: ApiEnv): {
  appID: string;
  environment: AppAttestEnvironment;
} {
  const appID = env.WBD_APP_ATTEST_APP_ID?.trim();
  const configuredEnvironment = env.WBD_APP_ATTEST_ENVIRONMENT?.trim();
  if (!appID || (configuredEnvironment !== "development" && configuredEnvironment !== "production")) {
    throw new ApiError(
      503,
      "app_attest_unconfigured",
      "Device integrity verification is not configured for this environment.",
    );
  }
  return { appID, environment: configuredEnvironment };
}

// Simulator builds cannot produce an App Attest assertion. This header is
// accepted only for the explicitly named, non-payable rehearsal round, so QA
// can exercise the actual one-card-at-a-time API without weakening any cash
// competition or exposing a bypass in a shipping app.
function hasInternalRehearsalSimulatorBypass(request: Request, competitionSlug: string): boolean {
  return competitionSlug === SERVER_REHEARSAL_SLUG
    && request.headers.get("x-wbd-internal-rehearsal-simulator") === "1";
}

function requiredAppAttestation(payload: Record<string, unknown>): {
  challengeID: string;
  keyID: string;
  attestationObject: string;
} {
  const proof = payload.integrity_proof;
  if (!proof || Array.isArray(proof) || typeof proof !== "object") {
    throw new ApiError(403, "app_attest_required", "A verified device attestation is required.");
  }
  const value = proof as Record<string, unknown>;
  if (
    value.platform !== "ios-app-attest"
    || typeof value.challenge_id !== "string"
    || typeof value.key_id !== "string"
    || typeof value.attestation_object !== "string"
  ) {
    throw new ApiError(400, "app_attest_payload_invalid", "The device attestation payload is invalid.");
  }
  return {
    challengeID: value.challenge_id,
    keyID: value.key_id,
    attestationObject: value.attestation_object,
  };
}

/**
 * Issues the nonce used only for initial App Attest registration. The nonce is
 * tied to the authenticated player and started sequential attempt, then
 * persisted as single-use state before it is ever returned to an iPhone.
 *
 * This route intentionally does not mark a device verified: the verifier must
 * validate Apple's certificate chain and attestation object before inserting a
 * key record or consuming this challenge.
 */
async function issueAppAttestRegistrationChallenge(
  request: Request,
  env: ApiEnv,
  attemptId: string,
): Promise<Response> {
  const { appID, environment } = appAttestConfiguration(env);

  const db = database(env);
  const player = await authenticate(request, db);
  const attemptToken = request.headers.get("x-wbd-attempt-token") ?? "";
  if (!/^wbd_a_[A-Za-z0-9_-]{40,80}$/.test(attemptToken)) {
    throw new ApiError(401, "attempt_token_required", "The signed attempt token is required.");
  }
  const attempt = await db
    .prepare(
      `SELECT id, status, delivery_protocol, play_deadline_at
       FROM attempts
       WHERE id = ?1 AND player_id = ?2 AND attempt_token_hash = ?3
       LIMIT 1`,
    )
    .bind(attemptId, player.id, await sha256Hex(attemptToken))
    .first<{
      id: string;
      status: string;
      delivery_protocol: string;
      play_deadline_at: number;
    }>();
  if (!attempt) {
    throw new ApiError(404, "attempt_not_found", "The attempt could not be found.");
  }
  if (attempt.status !== "started" || attempt.delivery_protocol !== "cash_sequential_v1") {
    throw new ApiError(409, "cash_attempt_required", "App Attest is required only for an active cash attempt.");
  }
  const now = Date.now();
  if (now >= attempt.play_deadline_at) {
    throw new ApiError(410, "attempt_expired", "The attempt submission window has closed.");
  }

  const localKeyID = request.headers.get("x-wbd-app-attest-key-id")?.trim() ?? "";
  const registeredKey = await db.prepare(
    `SELECT key_id FROM app_attest_keys
     WHERE player_id = ?1 AND app_id = ?2 AND environment = ?3
       AND key_id = ?4 AND revoked_at IS NULL
     LIMIT 1`,
  ).bind(player.id, appID, environment, localKeyID).first<{ key_id: string }>();
  const id = crypto.randomUUID();
  const challenge = createBase64UrlNonce(32);
  const expiresAt = Math.min(now + APP_ATTEST_CHALLENGE_TTL_MS, attempt.play_deadline_at);
  await db
    .prepare(
      `INSERT INTO app_attest_challenges (
        id, player_id, attempt_id, key_id, purpose, challenge_b64,
        request_binding_hash, card_ordinal, issued_at, expires_at, consumed_at, created_at
      ) VALUES (?1, ?2, ?3, NULL, 'registration', ?4, NULL, NULL, ?5, ?6, NULL, ?5)`,
    )
    .bind(id, player.id, attempt.id, challenge, now, expiresAt)
    .run();

  return json({
    challenge: {
      id,
      nonce: challenge,
      purpose: "registration",
      expires_at: expiresAt,
      app_id: appID,
      environment,
      server_key_registered: Boolean(registeredKey),
    },
  }, 201);
}

function requiredAppAssertion(payload: Record<string, unknown>): {
  challengeID: string;
  keyID: string;
  assertion: string;
} {
  const proof = payload.integrity_proof;
  if (!proof || Array.isArray(proof) || typeof proof !== "object") {
    throw new ApiError(403, "app_attest_required", "A verified device assertion is required.");
  }
  const value = proof as Record<string, unknown>;
  if (
    value.platform !== "ios-app-attest"
    || typeof value.challenge_id !== "string"
    || typeof value.key_id !== "string"
    || typeof value.assertion !== "string"
  ) {
    throw new ApiError(400, "app_attest_payload_invalid", "The device assertion payload is invalid.");
  }
  return { challengeID: value.challenge_id, keyID: value.key_id, assertion: value.assertion };
}

async function issueAppAttestCashAnswerChallenge(
  request: Request,
  env: ApiEnv,
  attemptId: string,
): Promise<Response> {
  const { appID, environment } = appAttestConfiguration(env);
  const db = database(env);
  const player = await authenticate(request, db);
  const attemptToken = request.headers.get("x-wbd-attempt-token") ?? "";
  const payload = await readJsonObject(request);
  const selectedOptionID = cashSelectedOption(payload);
  const attempt = await db.prepare(
    `SELECT a.id, a.status, a.delivery_protocol, a.play_deadline_at,
            i.ordinal
     FROM attempts a
     JOIN attempt_card_issues i ON i.attempt_id = a.id AND i.answered_at IS NULL
     WHERE a.id = ?1 AND a.player_id = ?2 AND a.attempt_token_hash = ?3
     LIMIT 1`,
  ).bind(attemptId, player.id, await sha256Hex(attemptToken)).first<{
    id: string; status: string; delivery_protocol: string; play_deadline_at: number; ordinal: number;
  }>();
  if (!attempt || attempt.status !== "started" || attempt.delivery_protocol !== "cash_sequential_v1") {
    throw new ApiError(409, "cash_attempt_required", "This cash attempt is not active.");
  }
  const key = await db.prepare(
    `SELECT key_id FROM app_attest_keys
     WHERE player_id = ?1 AND app_id = ?2 AND environment = ?3
       AND revoked_at IS NULL
     LIMIT 1`,
  ).bind(player.id, appID, environment).first<{ key_id: string }>();
  if (!key) throw new ApiError(403, "app_attest_key_unknown", "Register this device before answering.");
  const now = Date.now();
  if (now >= attempt.play_deadline_at) throw new ApiError(410, "attempt_expired", "The attempt submission window has closed.");
  const nonce = createBase64UrlNonce(32);
  const bindingHash = await sha256HexBytes(cashAnswerBinding(attempt.id, attempt.ordinal, selectedOptionID));
  const expiresAt = Math.min(now + APP_ATTEST_CHALLENGE_TTL_MS, attempt.play_deadline_at);
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO app_attest_challenges (
      id, player_id, attempt_id, key_id, purpose, challenge_b64,
      request_binding_hash, card_ordinal, issued_at, expires_at, consumed_at, created_at
    ) VALUES (?1, ?2, ?3, ?4, 'cash_answer', ?5, ?6, ?7, ?8, ?9, NULL, ?8)`,
  ).bind(id, player.id, attempt.id, key.key_id, nonce, bindingHash, attempt.ordinal, now, expiresAt).run();
  return json({
    challenge: {
      id,
      nonce,
      purpose: "cash_answer",
      expires_at: expiresAt,
      card_ordinal: attempt.ordinal,
      app_id: appID,
      environment,
    },
  }, 201);
}

/// Validates and consumes the server-side challenge around the lower-level
/// cryptographic App Attest assertion verifier imported above.
async function verifyCashAnswerAssertion(
  db: D1Database,
  playerID: string,
  attemptID: string,
  ordinal: number,
  selectedOptionID: string | null,
  payload: Record<string, unknown>,
  env: ApiEnv,
): Promise<void> {
  const { appID, environment } = appAttestConfiguration(env);
  const proof = requiredAppAssertion(payload);
  const row = await db.prepare(
    `SELECT c.challenge_b64, c.request_binding_hash, k.public_key_pem, k.assertion_counter
     FROM app_attest_challenges c
     JOIN app_attest_keys k ON k.key_id = c.key_id
     WHERE c.id = ?1 AND c.player_id = ?2 AND c.attempt_id = ?3
       AND c.key_id = ?4 AND c.purpose = 'cash_answer'
       AND c.card_ordinal = ?5 AND c.consumed_at IS NULL AND c.expires_at > ?6
       AND k.app_id = ?7 AND k.environment = ?8 AND k.revoked_at IS NULL
     LIMIT 1`,
  ).bind(proof.challengeID, playerID, attemptID, proof.keyID, ordinal, Date.now(), appID, environment).first<{
    challenge_b64: string; request_binding_hash: string; public_key_pem: string; assertion_counter: number;
  }>();
  if (!row) throw new ApiError(409, "app_attest_challenge_invalid", "Your secured answer expired. Please try again.");
  const nonce = decodeBase64Url(row.challenge_b64);
  const binding = cashAnswerBinding(attemptID, ordinal, selectedOptionID);
  if (!nonce || await sha256HexBytes(binding) !== row.request_binding_hash) {
    throw new ApiError(403, "app_attest_binding_invalid", "This secured answer does not match the active card.");
  }
  let verified: Awaited<ReturnType<typeof verifyAppAttestCashAnswer>>;
  try {
    verified = await verifyAppAttestCashAnswer({
      appID, assertion: proof.assertion, challenge: nonce, canonicalRequest: binding,
      publicKeyPem: row.public_key_pem, previousSignCount: row.assertion_counter,
    });
  } catch {
    throw new ApiError(403, "app_attestation_invalid", "This device assertion could not be verified.");
  }
  const now = Date.now();
  const consumed = await db.prepare(
    `UPDATE app_attest_challenges SET consumed_at = ?2
     WHERE id = ?1 AND consumed_at IS NULL AND expires_at > ?2 RETURNING id`,
  ).bind(proof.challengeID, now).first<{ id: string }>();
  if (!consumed) throw new ApiError(409, "app_attest_challenge_replayed", "This secured answer was already used.");
  const advanced = await db.prepare(
    `UPDATE app_attest_keys SET assertion_counter = ?2, last_verified_at = ?3, updated_at = ?3
     WHERE key_id = ?1 AND assertion_counter < ?2 AND revoked_at IS NULL RETURNING key_id`,
  ).bind(proof.keyID, verified.signCount, now).first<{ key_id: string }>();
  if (!advanced) throw new ApiError(409, "app_attest_counter_replayed", "This device assertion was already used.");
}

/**
 * Server timings are the only timings used for ranking. These signals merely
 * prioritize the mandatory human review queue; they never auto-void a score.
 * Thresholds are deliberately conservative until a production pilot provides
 * calibration data.
 */
function cashReviewSignals(
  answers: ServerTimedAnswer[],
  startedAt: number,
  submittedAt: number,
): { flags: string[]; riskScore: number } {
  const flags = ["server_timed_pending_integrity_review"];
  const answered = answers.filter((answer) => answer.selectedOptionId !== null);
  const responseTimes = answered.map((answer) => Math.max(answer.answeredAtMs - answer.issuedAtMs, 0));
  const rapidAnswers = responseTimes.filter((responseMs) => responseMs <= 300).length;
  const frequencies = new Map<number, number>();
  for (const responseMs of responseTimes) {
    frequencies.set(responseMs, (frequencies.get(responseMs) ?? 0) + 1);
  }
  const highestRepeatedLatency = Math.max(0, ...frequencies.values());
  const roundDurationMs = Math.max(submittedAt - startedAt, 0);
  let riskScore = 35;

  if (rapidAnswers >= 6) {
    flags.push("rapid_answer_pattern_review");
    riskScore += 25;
  }
  if (highestRepeatedLatency >= 4) {
    flags.push("repeated_response_latency_review");
    riskScore += 20;
  }
  if (answers.length >= 8 && roundDurationMs <= answers.length * 400) {
    flags.push("round_duration_review");
    riskScore += 20;
  }
  return { flags, riskScore: Math.min(riskScore, 100) };
}

/**
 * At the immutable round deadline, the service completes every unanswered
 * card itself. Missing cards are recorded as server timeouts and retain their
 * full per-card penalty; the client never receives another card in grace.
 */
async function recordCashRoundTimeouts(
  db: D1Database,
  attempt: AttemptRow,
  cards: CompetitionCard[],
  now: number,
): Promise<void> {
  const issues = await db.prepare(
    `SELECT ordinal, card_id, issued_at, answered_at
     FROM attempt_card_issues WHERE attempt_id = ?1 ORDER BY ordinal ASC`,
  ).bind(attempt.id).all<AttemptCardIssueRow>();
  const byOrdinal = new Map((issues.results ?? []).map((issue) => [issue.ordinal, issue]));
  const statements: D1PreparedStatement[] = [];
  for (const card of [...cards].sort((left, right) => left.position - right.position)) {
    const issue = byOrdinal.get(card.position);
    if (issue?.answered_at !== null && issue?.answered_at !== undefined) continue;
    if (issue && issue.card_id !== card.id) {
      throw new ApiError(409, "competition_under_review", "This attempt's server-issued card no longer matches the private pack.");
    }
    // A card never released before the global deadline has zero active time;
    // a null selection still incurs the full per-card scoring penalty.
    const issuedAt = issue?.issued_at ?? attempt.play_deadline_at;
    const answeredAt = issue
      ? Math.max(issue.issued_at, Math.min(issue.issued_at + attempt.per_card_limit_ms, attempt.play_deadline_at))
      : attempt.play_deadline_at;
    if (issue) {
      statements.push(
        db.prepare(
          `UPDATE attempt_card_issues SET answered_at = ?3
           WHERE attempt_id = ?1 AND ordinal = ?2 AND answered_at IS NULL`,
        ).bind(attempt.id, card.position, answeredAt),
      );
    } else {
      statements.push(
        db.prepare(
          `INSERT INTO attempt_card_issues (attempt_id, ordinal, card_id, issued_at, answered_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        ).bind(attempt.id, card.position, card.id, issuedAt, answeredAt),
      );
    }
    statements.push(
      db.prepare(
        `INSERT INTO attempt_answers (
          attempt_id, card_id, ordinal, selected_option_id,
          client_response_ms, is_correct, answer_version, created_at
        ) VALUES (?1, ?2, ?3, '__timeout__', ?4, 0, ?5, ?6)`,
      ).bind(attempt.id, card.id, card.position, answeredAt - issuedAt, card.contentVersion, now),
    );
  }
  if (statements.length > 0) await db.batch(statements);
}

async function finalizeCashAttempt(
  db: D1Database,
  attempt: AttemptRow,
  playerID: string,
  cards: CompetitionCard[],
  now: number,
): Promise<Response> {
  const answerRows = await db.prepare(
    `SELECT i.ordinal, i.card_id, i.issued_at, i.answered_at, a.selected_option_id
     FROM attempt_card_issues i
     JOIN attempt_answers a ON a.attempt_id = i.attempt_id AND a.card_id = i.card_id
     WHERE i.attempt_id = ?1 ORDER BY i.ordinal ASC`,
  ).bind(attempt.id).all<ServerTimedAttemptAnswerRow>();
  const serverTimedAnswers: ServerTimedAnswer[] = (answerRows.results ?? []).map((row) => ({
    cardId: row.card_id,
    position: row.ordinal,
    selectedOptionId: row.selected_option_id === "__timeout__" ? null : row.selected_option_id,
    issuedAtMs: row.issued_at,
    answeredAtMs: row.answered_at ?? row.issued_at,
  }));
  const score = scoreServerTimedSubmission({
    cards,
    answers: serverTimedAnswers,
    perCardLimitMs: attempt.per_card_limit_ms,
  });
  // Grace transports the result but can never become play time.
  const scoredAt = Math.min(now, attempt.play_deadline_at);
  const integrity = cashReviewSignals(serverTimedAnswers, attempt.started_at, scoredAt);
  const integrityFlags = integrity.flags;
  const submissionHash = await sha256Hex(canonicalSubmission(attempt.id, score.answers));
  const updated = await db.prepare(
    `UPDATE attempts SET
      status = 'submitted', submitted_at = ?2,
      client_active_ms = ?3, server_elapsed_ms = ?4,
      adjusted_total_ms = ?5, correct_count = ?6, hard_card_ms = ?7,
      integrity_status = 'review', integrity_flags_json = ?8,
      submission_hash = ?9, score_status = 'provisional', updated_at = ?2
     WHERE id = ?1 AND status = 'started' RETURNING id`,
  ).bind(
    attempt.id,
    scoredAt,
    score.clientActiveMs,
    scoredAt - attempt.started_at,
    score.adjustedTotalMs,
    score.correctCount,
    score.hardCardMs,
    JSON.stringify(integrityFlags),
    submissionHash,
  ).first<{ id: string }>();
  if (!updated) throw new ApiError(409, "attempt_not_active", "This attempt is no longer active.");
  await db.prepare(
    `INSERT OR IGNORE INTO competition_reviews (
      id, attempt_id, competition_id, player_id, status, risk_score,
      flags_json, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6, ?7, ?7)`,
  ).bind(
    crypto.randomUUID(),
    attempt.id,
    attempt.competition_id,
    playerID,
    integrity.riskScore,
    JSON.stringify(integrityFlags),
    scoredAt,
  ).run();
  return json({
    // Keep this terminal shape symmetrical with a normal next-card response.
    // Earlier builds require `status`; omitting it made a legitimate final
    // score look like an unreadable server response to the iOS client.
    attempt_id: attempt.id,
    status: "finished",
    answered_count: attempt.question_count,
    question_count: attempt.question_count,
    score: {
      attempt_id: attempt.id,
      correct_count: score.correctCount,
      question_count: attempt.question_count,
      adjusted_total_ms: score.adjustedTotalMs,
      hard_card_ms: score.hardCardMs,
      status: "provisional",
      integrity_status: "review",
      integrity_flags: integrityFlags,
      prize_eligible: false,
      timing_trust: "server_authoritative",
      ranking_order: ["correct_count_desc", "adjusted_total_ms_asc", "hard_card_ms_asc"],
    },
  });
}

/**
 * Cash-only answer boundary. It deliberately has no `response_ms` input:
 * response time is derived from rows written by this service. The one internal
 * rehearsal competition is allowed through while the public cash gate is off.
 */
async function answerCashAttempt(
  request: Request,
  env: ApiEnv,
  attemptId: string,
  roundTimeoutOnly = false,
): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const attemptToken = request.headers.get("x-wbd-attempt-token") ?? "";
  if (!/^wbd_a_[A-Za-z0-9_-]{40,80}$/.test(attemptToken)) {
    throw new ApiError(401, "attempt_token_required", "The signed attempt token is required.");
  }

  const attempt = await db
    .prepare(
      `SELECT
        a.id, a.competition_id, c.slug AS competition_slug, a.status, a.rules_version, a.pack_version,
        a.pack_hash, a.scoring_version, a.delivery_protocol,
        c.rules_version AS current_rules_version,
        c.pack_version AS current_pack_version,
        c.scoring_version AS current_scoring_version,
        a.started_at, a.play_deadline_at, a.submit_deadline_at,
        a.submitted_at, a.correct_count, a.adjusted_total_ms, a.hard_card_ms,
        a.score_status, c.question_count, c.per_card_limit_ms, c.upload_grace_ms
      FROM attempts a
      JOIN competitions c ON c.id = a.competition_id
      WHERE a.id = ?1
        AND a.player_id = ?2
        AND a.attempt_token_hash = ?3
      LIMIT 1`,
    )
    .bind(attemptId, player.id, await sha256Hex(attemptToken))
    .first<AttemptRow>();
  if (!attempt) {
    throw new ApiError(404, "attempt_not_found", "The attempt could not be found.");
  }
  if (attempt.delivery_protocol !== "cash_sequential_v1") {
    throw new ApiError(
      409,
      "cash_attempt_required",
      "This route is reserved for one-card-at-a-time cash attempts.",
    );
  }
  if (attempt.status !== "started") {
    throw new ApiError(409, "attempt_not_active", "This attempt is no longer active.");
  }

  const now = Date.now();
  if (now > attempt.submit_deadline_at) {
    await db
      .prepare(
        `UPDATE attempts
         SET status = 'expired', updated_at = ?2
         WHERE id = ?1 AND status = 'started'`,
      )
      .bind(attempt.id, now)
      .run();
    throw new ApiError(410, "attempt_expired", "The attempt submission window has closed.");
  }

  const cards = await loadCompetitionPack(db, attempt.competition_id);
  const packIssues = validateCompetitionPack(cards, attempt.question_count);
  const isolationIssues = attempt.competition_slug === SERVER_REHEARSAL_SLUG
    ? []
    : validateCompetitionIsolation(cards, await loadPublicContentSources(db));
  if (packIssues.length > 0 || isolationIssues.length > 0) {
    throw new ApiError(
      409,
      "competition_under_review",
      "Scoring is paused while the private competition pack is reviewed.",
      { issues: [...packIssues, ...isolationIssues].slice(0, 25) },
    );
  }
  const currentCompetition: CompetitionRow = {
    id: attempt.competition_id,
    slug: "",
    title: "",
    status: "",
    content_status: "",
    rules_version: attempt.current_rules_version,
    pack_version: attempt.current_pack_version,
    scoring_version: attempt.current_scoring_version,
    question_count: attempt.question_count,
    per_card_limit_ms: attempt.per_card_limit_ms,
    upload_grace_ms: attempt.upload_grace_ms,
    entry_mode: "phone_verified",
    country_code: "",
    minimum_age: 0,
    currency: "",
    opens_at: 0,
    closes_at: 0,
    score_review_closes_at: 0,
  };
  const currentPackHash = await competitionPackHash(currentCompetition, cards);
  if (
    attempt.pack_hash === null
    || attempt.rules_version !== attempt.current_rules_version
    || attempt.pack_version !== attempt.current_pack_version
    || attempt.scoring_version !== attempt.current_scoring_version
    || attempt.pack_hash !== currentPackHash
  ) {
    throw new ApiError(
      409,
      "competition_under_review",
      "Scoring is paused because this attempt's pinned pack no longer matches the competition.",
    );
  }

  if (now >= attempt.play_deadline_at) {
    const verifiedDevice = await db.prepare("SELECT platform FROM attempt_device_bindings WHERE attempt_id = ?1 AND player_id = ?2")
      .bind(attempt.id, player.id).first();
    if (!verifiedDevice && !hasInternalRehearsalSimulatorBypass(request, attempt.competition_slug)) {
      throw new ApiError(403, "device_verification_required", "Device verification must finish before this attempt can be scored.");
    }
    await recordCashRoundTimeouts(db, attempt, cards, now);
    return finalizeCashAttempt(db, attempt, player.id, cards, now);
  }
  if (roundTimeoutOnly) {
    throw new ApiError(409, "attempt_still_active", "The round clock has not reached its server deadline.");
  }

  const payload = await readJsonObject(request);
  const selectedOptionID = cashSelectedOption(payload);

  const issue = await db
    .prepare(
      `SELECT ordinal, card_id, issued_at, answered_at
       FROM attempt_card_issues
       WHERE attempt_id = ?1 AND answered_at IS NULL
       ORDER BY ordinal ASC
       LIMIT 1`,
    )
    .bind(attempt.id)
    .first<AttemptCardIssueRow>();
  if (!issue) {
    throw new ApiError(
      409,
      "cash_attempt_issue_missing",
      "This cash attempt has no active server-issued card.",
    );
  }
  const card = cards.find((candidate) => candidate.id === issue.card_id);
  if (!card || card.position !== issue.ordinal) {
    throw new ApiError(
      409,
      "competition_under_review",
      "This cash attempt's server-issued card no longer matches the private pack.",
    );
  }
  if (
    selectedOptionID !== null
    && !card.options.some((option) => option.id === selectedOptionID)
  ) {
    throw new ApiError(400, "unknown_option", "The selected option is not part of this card.");
  }

  const androidVerified = await db.prepare("SELECT attempt_id FROM android_integrity_verifications WHERE attempt_id = ?1 AND player_id = ?2")
    .bind(attempt.id, player.id).first<{ attempt_id: string }>();
  if (androidVerified || isAndroidLeagueClient(request)) {
    await verifyAndroidCashAnswer(db, player.id, attempt.id, issue.ordinal, selectedOptionID, payload, env);
  } else if (!hasInternalRehearsalSimulatorBypass(request, attempt.competition_slug)) {
    await verifyCashAnswerAssertion(
      db,
      player.id,
      attempt.id,
      issue.ordinal,
      selectedOptionID,
      payload,
      env,
    );
  }

  const deadlineAt = issue.issued_at + attempt.per_card_limit_ms;
  const didTimeOut = now >= deadlineAt;
  const answeredAt = didTimeOut ? deadlineAt : now;
  const recordedOptionID = didTimeOut ? null : selectedOptionID;
  const isCorrect = recordedOptionID === card.correctOptionId;
  const nextCard = cards.find((candidate) => candidate.position === issue.ordinal + 1);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE attempt_card_issues
         SET answered_at = ?4
         WHERE attempt_id = ?1 AND ordinal = ?2 AND card_id = ?3 AND answered_at IS NULL`,
      )
      .bind(attempt.id, issue.ordinal, issue.card_id, answeredAt),
    db
      .prepare(
        `INSERT INTO attempt_answers (
          attempt_id, card_id, ordinal, selected_option_id,
          client_response_ms, is_correct, answer_version, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        attempt.id,
        card.id,
        card.position,
        recordedOptionID ?? "__timeout__",
        answeredAt - issue.issued_at,
        isCorrect ? 1 : 0,
        card.contentVersion,
        now,
      ),
  ];
  if (nextCard) {
    statements.push(
      db
        .prepare(
          `INSERT INTO attempt_card_issues (
            attempt_id, ordinal, card_id, issued_at
          ) VALUES (?1, ?2, ?3, ?4)`,
        )
        .bind(attempt.id, nextCard.position, nextCard.id, now),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("unique")) {
      throw new ApiError(
        409,
        "cash_answer_already_recorded",
        "That server-issued card has already been answered.",
      );
    }
    throw error;
  }

  if (nextCard) {
    return json({
      attempt_id: attempt.id,
      status: "playing",
      answered_count: issue.ordinal,
      question_count: attempt.question_count,
      card: publicCompetitionCard(nextCard, attempt.per_card_limit_ms),
      card_deadline_at: now + attempt.per_card_limit_ms,
    });
  }

  return finalizeCashAttempt(db, attempt, player.id, cards, now);
}

async function leaderboard(request: Request, env: ApiEnv, competitionId: string): Promise<Response> {
  const db = database(env);
  const viewer = request.headers.has("authorization")
    ? await authenticate(request, db)
    : null;
  const competition = await db
    .prepare(`SELECT * FROM competitions WHERE id = ?1 LIMIT 1`)
    .bind(competitionId)
    .first<CompetitionRow>();
  if (!competition) {
    throw new ApiError(404, "competition_not_found", "The competition could not be found.");
  }

  const practiceOnly = competition.entry_mode === "guest";
  // Live standings should update immediately after submission. Integrity is
  // still represented by score_status and final review, but a score that is
  // merely pending review should remain visible as provisional. Only failed
  // attempts are excluded from the public table.
  const integrityPredicate = "a.integrity_status != 'failed'";
  const result = await db
    .prepare(
      `SELECT
        a.id AS attempt_id,
        p.public_handle,
        a.correct_count,
        a.adjusted_total_ms,
        a.hard_card_ms,
        a.score_status
      FROM attempts a
      JOIN players p ON p.id = a.player_id
      WHERE a.competition_id = ?1
        AND a.status = 'submitted'
        AND a.score_status IN ('provisional', 'confirmed')
        AND ${integrityPredicate}
      ORDER BY
        a.correct_count DESC,
        a.adjusted_total_ms ASC,
        a.hard_card_ms ASC,
        p.public_handle ASC
      LIMIT ?2`,
    )
    .bind(competitionId, MAX_LEADERBOARD_ROWS)
    .all<{
      attempt_id: string;
      public_handle: string;
      correct_count: number;
      adjusted_total_ms: number;
      hard_card_ms: number;
      score_status: LeaderboardScore["scoreStatus"];
    }>();

  const scores: LeaderboardScore[] = (result.results ?? []).map((row) => ({
    attemptId: row.attempt_id,
    publicHandle: row.public_handle,
    correctCount: row.correct_count,
    adjustedTotalMs: row.adjusted_total_ms,
    hardCardMs: row.hard_card_ms,
    scoreStatus: row.score_status,
  }));
  // Keep the authenticated player's own provisional row available even when
  // it is not yet in the public slice, so the result screen is never empty
  // immediately after submission.
  if (viewer && !scores.some((entry) => entry.publicHandle === viewer.publicHandle)) {
    const own = await db.prepare(`
      SELECT a.id AS attempt_id, p.public_handle, a.correct_count,
             a.adjusted_total_ms, a.hard_card_ms, a.score_status
      FROM attempts a JOIN players p ON p.id = a.player_id
      WHERE a.competition_id = ?1 AND a.player_id = ?2
        AND a.status = 'submitted'
        AND a.score_status IN ('provisional', 'confirmed')
        AND a.integrity_status != 'failed'
      ORDER BY a.updated_at DESC LIMIT 1
    `).bind(competitionId, viewer.id).first<{
      attempt_id: string;
      public_handle: string;
      correct_count: number;
      adjusted_total_ms: number;
      hard_card_ms: number;
      score_status: LeaderboardScore["scoreStatus"];
    }>();
    if (own) scores.push({
      attemptId: own.attempt_id,
      publicHandle: own.public_handle,
      correctCount: own.correct_count,
      adjustedTotalMs: own.adjusted_total_ms,
      hardCardMs: own.hard_card_ms,
      scoreStatus: own.score_status,
    });
  }
  const ranked = rankLeaderboard(scores);
  const viewerEntry = viewer
    ? ranked.find((entry) => entry.publicHandle === viewer.publicHandle) ?? null
    : null;
  const rehearsal = isServerRehearsal(competition);
  const verifiedCashStandings = !rehearsal
    && !practiceOnly
    && competition.currency === "NGN";

  return json({
    competition: {
      id: competition.id,
      slug: competition.slug,
      question_count: competition.question_count,
      scoring_version: competition.scoring_version,
      mode: rehearsal ? "prize" : (practiceOnly ? "practice" : "prize"),
      test_only: rehearsal,
      prize_eligible: verifiedCashStandings,
      ranking_scope: rehearsal ? "server_rehearsal_display_only" : (practiceOnly ? "practice" : "integrity_passed_only"),
    },
    leaderboard: ranked.slice(0, PUBLIC_LEADERBOARD_ROWS).map((entry) => ({
      rank: entry.rank,
      tie_size: entry.tieSize,
      public_handle: entry.publicHandle,
      correct_count: entry.correctCount,
      adjusted_total_ms: entry.adjustedTotalMs,
      hard_card_ms: entry.hardCardMs,
      score_status: entry.scoreStatus,
    })),
    viewer: viewerEntry
      ? {
        public_handle: viewerEntry.publicHandle,
        rank: viewerEntry.rank,
        tie_size: viewerEntry.tieSize,
        in_public_page: viewerEntry.rank <= PUBLIC_LEADERBOARD_ROWS,
      }
      : null,
    total_ranked: ranked.length,
    truncated: ranked.length === MAX_LEADERBOARD_ROWS,
    exact_ties: "shared_rank",
  });
}

async function latestCompletedCompetition(request: Request, env: ApiEnv): Promise<Response> {
  const controls = (await publishedAppConfig(env)).events.odogwu_league;
  if (controls.show_last_leaderboard === false) {
    throw new ApiError(404, "no_completed_competition", "The last leaderboard is currently hidden.");
  }
  const db = database(env);
  const now = Date.now();
  const requestedID = new URL(request.url).searchParams.get("competition_id")?.trim() ?? "";
  const competition = requestedID
    ? await db.prepare(
        `SELECT * FROM competitions
         WHERE id = ?1 AND status IN ('open', 'locked', 'final') AND content_status = 'published'
           AND closes_at <= ?2 LIMIT 1`,
      ).bind(requestedID, now).first<CompetitionRow>()
    : await db.prepare(
        `SELECT * FROM competitions
         WHERE status IN ('open', 'locked', 'final') AND content_status = 'published'
           AND closes_at <= ?1
         ORDER BY closes_at DESC LIMIT 1`,
      ).bind(now).first<CompetitionRow>();
  if (!competition) throw new ApiError(404, "no_completed_competition", "No completed League round is available yet.");
  const prizes = await prizePayload(db, competition.id);
  const cashReadiness = await cashLaunchReadiness(db);
  const rows = await db.prepare(
    `SELECT a.id AS attempt_id, p.public_handle, a.correct_count,
            a.adjusted_total_ms, a.hard_card_ms, a.score_status
       FROM attempts a JOIN players p ON p.id = a.player_id
      WHERE a.competition_id = ?1 AND a.status = 'submitted'
        AND a.score_status IN ('provisional', 'confirmed')
        AND a.integrity_status IN ('passed', 'review')
      ORDER BY a.correct_count DESC, a.adjusted_total_ms ASC,
               a.hard_card_ms ASC, p.public_handle ASC
      LIMIT ?2`,
  ).bind(competition.id, MAX_LEADERBOARD_ROWS).all<{
    attempt_id: string; public_handle: string; correct_count: number;
    adjusted_total_ms: number; hard_card_ms: number;
    score_status: "provisional" | "confirmed";
  }>();
  const ranked = rankLeaderboard((rows.results ?? []).map((row) => ({
    attemptId: row.attempt_id, publicHandle: row.public_handle,
    correctCount: row.correct_count, adjustedTotalMs: row.adjusted_total_ms,
    hardCardMs: row.hard_card_ms, scoreStatus: row.score_status,
  })));
  const reviewSummary = await db.prepare(
    `SELECT
       SUM(CASE WHEN a.score_status = 'provisional' THEN 1 ELSE 0 END) AS provisional_count,
       MAX(a.updated_at) AS last_updated_at
       FROM attempts a
      WHERE a.competition_id = ?1 AND a.status = 'submitted'
        AND a.score_status IN ('provisional', 'confirmed')
        AND a.integrity_status IN ('passed', 'review')`,
  ).bind(competition.id).first<{ provisional_count: number | null; last_updated_at: number | null }>();
  const reviewState = ranked.length === 0 || (reviewSummary?.provisional_count ?? 0) > 0
    ? "provisional"
    : "final";
  return json({
    competition: competitionPayload(competition, prizes, cashReadiness.available, true),
    review_state: reviewState,
    leaderboard: ranked.slice(0, PUBLIC_LEADERBOARD_ROWS).map((entry) => ({
      rank: entry.rank, tie_size: entry.tieSize, public_handle: entry.publicHandle,
      correct_count: entry.correctCount, adjusted_total_ms: entry.adjustedTotalMs,
      hard_card_ms: entry.hardCardMs, score_status: entry.scoreStatus,
    })),
    total_ranked: ranked.length,
    truncated: ranked.length === MAX_LEADERBOARD_ROWS,
    last_updated_at: reviewSummary?.last_updated_at ?? competition.closes_at,
  });
}

async function createScoreChallenge(
  request: Request,
  env: ApiEnv,
  attemptId: string,
): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const attempt = await db
    .prepare(
      `SELECT a.competition_id, a.status, c.score_review_closes_at
       FROM attempts a
       JOIN competitions c ON c.id = a.competition_id
       WHERE a.id = ?1 AND a.player_id = ?2
       LIMIT 1`,
    )
    .bind(attemptId, player.id)
    .first<{
      competition_id: string;
      status: string;
      score_review_closes_at: number;
    }>();
  if (!attempt) {
    throw new ApiError(404, "attempt_not_found", "The attempt could not be found.");
  }
  if (attempt.status !== "submitted") {
    throw new ApiError(409, "score_not_available", "Submit the attempt before challenging its score.");
  }
  if (Date.now() > attempt.score_review_closes_at) {
    throw new ApiError(410, "challenge_window_closed", "The score challenge window has closed.");
  }

  const payload = await readJsonObject(request);
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const statement = typeof payload.statement === "string" ? payload.statement.trim() : "";
  const cardId = typeof payload.card_id === "string" ? payload.card_id : null;
  if (!new Set(["card_answer", "timer", "score", "other"]).has(kind)) {
    throw new ApiError(400, "invalid_challenge_kind", "Challenge kind is invalid.");
  }
  if (statement.length < 20 || statement.length > 2000) {
    throw new ApiError(
      400,
      "invalid_challenge_statement",
      "Challenge statement must be between 20 and 2,000 characters.",
    );
  }
  if (cardId) {
    const card = await db
      .prepare(
        `SELECT id FROM competition_cards
         WHERE id = ?1 AND competition_id = ?2
         LIMIT 1`,
      )
      .bind(cardId, attempt.competition_id)
      .first<{ id: string }>();
    if (!card) {
      throw new ApiError(400, "invalid_card", "The challenged card is not in this competition.");
    }
  }

  const now = Date.now();
  const challengeId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO score_challenges (
        id, attempt_id, player_id, competition_id, card_id,
        kind, statement, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'open', ?8, ?8)`,
    )
    .bind(
      challengeId,
      attemptId,
      player.id,
      attempt.competition_id,
      cardId,
      kind,
      statement,
      now,
    )
    .run();

  return json(
    {
      challenge: {
        id: challengeId,
        attempt_id: attemptId,
        kind,
        card_id: cardId,
        status: "open",
        created_at: now,
        review: "human",
      },
    },
    201,
  );
}

function watISOString(milliseconds: number): string {
  return new Date(milliseconds + 60 * 60 * 1_000)
    .toISOString()
    .replace(/\.000Z$/, "+01:00");
}

function contentReleaseSummary(release: PreparedContentRelease) {
  return {
    release_id: release.id,
    revision: release.revision,
    schema_version: release.schemaVersion,
    effective_week_wat: release.effectiveWeekWat,
    effective_from_wat: release.effectiveFromWat,
    expires_at_wat: release.expiresAtWat,
    minimum_app_version: release.minimumAppVersion,
    ...(release.sponsor
      ? {
          sponsor: {
            kind: release.sponsor.kind,
            sponsor_name: release.sponsor.sponsorName,
            message: release.sponsor.message,
            campaign_title: release.sponsor.campaignTitle,
            logo_url: release.sponsor.logoURL,
          },
        }
      : {}),
    assets: Object.fromEntries(
      release.assets.map((asset) => [
        asset.kind,
        {
          content_version: asset.contentVersion,
          sha256: asset.sha256,
          byte_count: asset.byteCount,
          item_count: asset.itemCount,
        },
      ]),
    ),
  };
}

type EventPackRow = {
  id: string;
  title: string;
  status: "published" | "revoked";
  access_mode: "permanent" | "event_end";
  expires_at_ms: number | null;
  cards_json: string;
  card_count: number;
};

function normalizeEventPackCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLocaleUpperCase("en-US").replace(/[\s-]/g, "");
}

function createEventPackCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const token = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `WBD-${token.slice(0, 5)}-${token.slice(5, 10)}-${token.slice(10, 15)}-${token.slice(15)}`;
}

function validateEventPackCards(value: unknown): { cards: Array<Record<string, unknown>>; issues: string[] } {
  const issues: string[] = [];
  if (!Array.isArray(value) || value.length < 5 || value.length > 300) {
    return { cards: [], issues: ["cards:count_must_be_5_to_300"] };
  }
  const cards: Array<Record<string, unknown>> = [];
  const ids = new Set<string>();
  value.forEach((candidate, index) => {
    const path = `cards[${index}]`;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      issues.push(`${path}:object_required`);
      return;
    }
    const card = candidate as Record<string, unknown>;
    const allowed = new Set(["id", "main_word", "category", "difficulty", "forbidden_words"]);
    for (const key of Object.keys(card)) if (!allowed.has(key)) issues.push(`${path}:unknown_field:${key}`);
    const id = typeof card.id === "string" ? card.id.trim() : "";
    const mainWord = typeof card.main_word === "string" ? card.main_word.trim() : "";
    const category = typeof card.category === "string" ? card.category.trim() : "";
    const difficulty = typeof card.difficulty === "string" ? card.difficulty.trim() : "";
    const forbidden = card.forbidden_words;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) issues.push(`${path}.id:invalid`);
    if (ids.has(id)) issues.push(`${path}.id:duplicate`);
    ids.add(id);
    if (!mainWord || mainWord.length > 120) issues.push(`${path}.main_word:invalid`);
    if (!category || category.length > 60) issues.push(`${path}.category:invalid`);
    if (!["Easy", "Medium", "Hard"].includes(difficulty)) issues.push(`${path}.difficulty:invalid`);
    if (!Array.isArray(forbidden) || forbidden.length < 1 || forbidden.length > 8
      || forbidden.some((word) => typeof word !== "string" || !word.trim() || word.length > 100)) {
      issues.push(`${path}.forbidden_words:invalid`);
    }
    cards.push({ id, main_word: mainWord, category, difficulty, forbidden_words: forbidden });
  });
  return { cards, issues };
}

async function publishEventPack(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: MAX_CONTENT_JSON_BYTES, requireApplicationJSON: true });
  const id = `ep_${crypto.randomUUID()}`;
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const accessMode = payload.access_mode;
  const expiresAt = payload.expires_at_ms === null ? null : Number(payload.expires_at_ms);
  const codeExpiresAt = payload.code_expires_at_ms === null || payload.code_expires_at_ms === undefined
    ? null : Number(payload.code_expires_at_ms);
  const maxRedemptions = payload.max_redemptions === null || payload.max_redemptions === undefined
    ? null : Number(payload.max_redemptions);
  const { cards, issues } = validateEventPackCards(payload.cards);
  if (!title || title.length > 80) issues.push("title:required_max_80");
  if (accessMode !== "permanent" && accessMode !== "event_end") issues.push("access_mode:invalid");
  if (accessMode === "permanent" && expiresAt !== null) issues.push("expires_at_ms:must_be_null_for_permanent");
  if (accessMode === "event_end" && (!Number.isSafeInteger(expiresAt) || Number(expiresAt) <= Date.now())) issues.push("expires_at_ms:future_timestamp_required");
  if (codeExpiresAt !== null && (!Number.isSafeInteger(codeExpiresAt) || codeExpiresAt <= Date.now())) issues.push("code_expires_at_ms:future_timestamp_required");
  if (maxRedemptions !== null && (!Number.isSafeInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100_000)) issues.push("max_redemptions:invalid");
  if (issues.length) return json({ published: false, issues }, 422);

  const code = createEventPackCode();
  const codeHash = await sha256Hex(normalizeEventPackCode(code));
  const now = Date.now();
  const db = database(env);
  await db.batch([
    db.prepare(`INSERT INTO event_packs (id, title, status, access_mode, expires_at_ms, cards_json, card_count, created_by, created_at)
      VALUES (?1, ?2, 'published', ?3, ?4, ?5, ?6, ?7, ?8)`)
      .bind(id, title, accessMode, expiresAt, JSON.stringify(cards), cards.length, authorization.publishedBy, now),
    db.prepare(`INSERT INTO event_pack_codes (code_hash, pack_id, max_redemptions, expires_at_ms, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(codeHash, id, maxRedemptions, codeExpiresAt, now),
  ]);
  await recordAdminAudit(db, authorization, "publish", "event_pack", id, "Published private event pack", {
    accessMode, expiresAt, cardCount: cards.length, maxRedemptions, codeExpiresAt,
  });
  return json({ published: true, pack: { id, title, access_mode: accessMode, expires_at_ms: expiresAt, card_count: cards.length }, redemption_code: code }, 201);
}

async function revokeEventPack(request: Request, env: ApiEnv, packId: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const db = database(env);
  const now = Date.now();
  const result = await db.prepare(`UPDATE event_packs SET status = 'revoked', revoked_at = ?2 WHERE id = ?1 AND status = 'published'`)
    .bind(packId, now).run();
  if (!result.meta.changes) throw new ApiError(404, "event_pack_not_found", "This event pack is not active.");
  await db.prepare(`UPDATE event_pack_codes SET revoked_at = ?2 WHERE pack_id = ?1 AND revoked_at IS NULL`)
    .bind(packId, now).run();
  await recordAdminAudit(db, authorization, "revoke", "event_pack", packId, "Revoked private event pack");
  return json({ revoked: true, pack_id: packId });
}

async function revokeEventPackCode(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request);
  const normalizedCode = normalizeEventPackCode(payload.code);
  if (!/^WBD[A-HJ-NP-Z2-9]{20}$/.test(normalizedCode)) {
    throw new ApiError(400, "event_pack_code_invalid", "Enter a valid event pack code.");
  }
  const codeHash = await sha256Hex(normalizedCode);
  const db = database(env);
  const now = Date.now();
  const result = await db.prepare(`UPDATE event_pack_codes SET revoked_at = ?2 WHERE code_hash = ?1 AND revoked_at IS NULL`)
    .bind(codeHash, now).run();
  if (!result.meta.changes) throw new ApiError(404, "event_pack_code_not_found", "This event pack code is not active.");
  await recordAdminAudit(db, authorization, "revoke", "event_pack_code", codeHash, "Revoked event pack invitation code");
  return json({ revoked: true });
}

async function eventPackPayload(db: D1Database, playerId: string, packId: string): Promise<Response> {
  const now = Date.now();
  const row = await db.prepare(`SELECT p.id, p.title, p.status, p.access_mode, p.expires_at_ms, p.cards_json, p.card_count
      FROM event_pack_access_grants g JOIN event_packs p ON p.id = g.pack_id
      WHERE g.player_id = ?1 AND p.id = ?2 AND p.status = 'published'
        AND (g.expires_at_ms IS NULL OR g.expires_at_ms > ?3)
        AND (p.expires_at_ms IS NULL OR p.expires_at_ms > ?3)
      LIMIT 1`)
    .bind(playerId, packId, now).first<EventPackRow>();
  if (!row) throw new ApiError(404, "event_pack_access_denied", "This event pack is not available to this player.");
  let cards: unknown;
  try { cards = JSON.parse(row.cards_json); } catch { throw new ApiError(503, "event_pack_content_unavailable", "This event pack could not be loaded."); }
  return json({ pack: { id: row.id, title: row.title, access_mode: row.access_mode, expires_at_ms: row.expires_at_ms, card_count: row.card_count, cards } });
}

async function listPlayerEventPacks(request: Request, env: ApiEnv): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const result = await db.prepare(`SELECT p.id, p.title, p.access_mode, p.expires_at_ms, p.card_count
      FROM event_pack_access_grants g JOIN event_packs p ON p.id = g.pack_id
      WHERE g.player_id = ?1 AND p.status = 'published'
        AND (g.expires_at_ms IS NULL OR g.expires_at_ms > ?2)
        AND (p.expires_at_ms IS NULL OR p.expires_at_ms > ?2)
      ORDER BY p.title COLLATE NOCASE`)
    .bind(player.id, Date.now()).all();
  return json({ packs: result.results ?? [] });
}

async function redeemPlayerEventPack(request: Request, env: ApiEnv): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const payload = await readJsonObject(request);
  const normalizedCode = normalizeEventPackCode(payload.code);
  if (!/^WBD[A-HJ-NP-Z2-9]{20}$/.test(normalizedCode)) {
    throw new ApiError(400, "event_pack_code_invalid", "Enter a valid event pack code.");
  }
  const codeHash = await sha256Hex(normalizedCode);
  const now = Date.now();
  const existing = await db.prepare(`SELECT g.pack_id FROM event_pack_access_grants g JOIN event_packs p ON p.id = g.pack_id
      WHERE g.player_id = ?1 AND g.code_hash = ?2 AND p.status = 'published'
        AND (g.expires_at_ms IS NULL OR g.expires_at_ms > ?3)
        AND (p.expires_at_ms IS NULL OR p.expires_at_ms > ?3) LIMIT 1`)
    .bind(player.id, codeHash, now).first<{ pack_id: string }>();
  if (existing) return eventPackPayload(db, player.id, existing.pack_id);

  const redemption = await db.prepare(`INSERT INTO event_pack_redemptions (code_hash, player_id, redeemed_at)
      SELECT c.code_hash, ?2, ?3 FROM event_pack_codes c JOIN event_packs p ON p.id = c.pack_id
      WHERE c.code_hash = ?1 AND c.revoked_at IS NULL AND p.status = 'published'
        AND (c.expires_at_ms IS NULL OR c.expires_at_ms > ?3)
        AND (p.expires_at_ms IS NULL OR p.expires_at_ms > ?3)
        AND (c.max_redemptions IS NULL OR (SELECT COUNT(*) FROM event_pack_redemptions r WHERE r.code_hash = c.code_hash) < c.max_redemptions)
      ON CONFLICT(code_hash, player_id) DO NOTHING`)
    .bind(codeHash, player.id, now).run();
  const priorRedemption = await db.prepare(`SELECT 1 AS redeemed FROM event_pack_redemptions WHERE code_hash = ?1 AND player_id = ?2 LIMIT 1`)
    .bind(codeHash, player.id).first<{ redeemed: number }>();
  if (!priorRedemption) {
    const code = await db.prepare(`SELECT c.revoked_at, c.expires_at_ms AS code_expires, c.max_redemptions,
        (SELECT COUNT(*) FROM event_pack_redemptions r WHERE r.code_hash = c.code_hash) AS used,
        p.status, p.expires_at_ms AS pack_expires
      FROM event_pack_codes c JOIN event_packs p ON p.id = c.pack_id WHERE c.code_hash = ?1 LIMIT 1`)
      .bind(codeHash).first<{ revoked_at: number | null; code_expires: number | null; max_redemptions: number | null; used: number; status: string; pack_expires: number | null }>();
    if (!code || code.revoked_at || code.status !== "published" || (code.code_expires !== null && code.code_expires <= now)
      || (code.pack_expires !== null && code.pack_expires <= now)) {
      throw new ApiError(404, "event_pack_code_unavailable", "This event pack code is invalid or expired.");
    }
    if (code.max_redemptions !== null && code.used >= code.max_redemptions) {
      throw new ApiError(409, "event_pack_code_limit_reached", "This event pack code has reached its redemption limit.");
    }
    throw new ApiError(409, "event_pack_redemption_unavailable", "This event pack code could not be redeemed.");
  }
  const code = await db.prepare(`SELECT c.pack_id, p.expires_at_ms FROM event_pack_codes c JOIN event_packs p ON p.id = c.pack_id WHERE c.code_hash = ?1 AND p.status = 'published' LIMIT 1`)
    .bind(codeHash).first<{ pack_id: string; expires_at_ms: number | null }>();
  if (!code || (code.expires_at_ms !== null && code.expires_at_ms <= now)) {
    throw new ApiError(404, "event_pack_code_unavailable", "This event pack code is invalid or expired.");
  }
  await db.prepare(`INSERT INTO event_pack_access_grants (player_id, pack_id, granted_at, expires_at_ms, code_hash)
      VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(player_id, pack_id) DO UPDATE SET granted_at = excluded.granted_at, expires_at_ms = excluded.expires_at_ms, code_hash = excluded.code_hash`)
    .bind(player.id, code.pack_id, now, code.expires_at_ms, codeHash).run();
  void redemption;
  return eventPackPayload(db, player.id, code.pack_id);
}

async function currentContentManifest(
  request: Request,
  env: ApiEnv,
): Promise<Response> {
  const db = database(env);
  const now = Date.now();
  const release = await db
    .prepare(
      `SELECT
        id, revision, schema_version, status, effective_week_wat,
        effective_from_ms, expires_at_ms, minimum_app_version,
        sponsor_kind, sponsor_name, sponsor_message, sponsor_campaign_title, sponsor_logo_url,
        published_by, published_at
       FROM content_releases
       WHERE status = 'published'
         AND effective_from_ms <= ?1
         AND expires_at_ms > ?2
       ORDER BY revision DESC
       LIMIT 1`,
    )
    .bind(now, now)
    .first<ContentReleaseRow>();
  if (!release) {
    throw new ApiError(
      404,
      "no_active_content_release",
      "There is no active remote-content release right now.",
    );
  }

  const result = await db
    .prepare(
      `SELECT
        release_id, kind, content_version, sha256, byte_count,
        item_count, payload_json
       FROM content_assets
       WHERE release_id = ?1
       ORDER BY kind ASC`,
    )
    .bind(release.id)
    .all<ContentAssetRow>();
  const assets = result.results ?? [];
  if (
    assets.length !== 2 ||
    !assets.some((asset) => asset.kind === PARTY_DECK_KIND) ||
    !assets.some((asset) => asset.kind === SOLO_GIST_KIND)
  ) {
    throw new ApiError(
      503,
      "content_release_incomplete",
      "The active remote-content release is incomplete.",
    );
  }

  const origin = new URL(request.url).origin;
  const publicAssets = Object.fromEntries(
    assets.map((asset) => [
      asset.kind,
      {
        content_version: asset.content_version,
        url: new URL(
          `/api/v1/content/assets/${encodeURIComponent(release.id)}/${asset.kind}`,
          origin,
        ).href,
        sha256: asset.sha256,
        byte_count: asset.byte_count,
        item_count: asset.item_count,
      },
    ]),
  );
  const manifest = {
    schema_version: REMOTE_CONTENT_SCHEMA_VERSION,
    manifest_version: release.id,
    revision: release.revision,
    effective_week_wat: release.effective_week_wat,
    effective_from_wat: watISOString(release.effective_from_ms),
    expires_at_wat: watISOString(release.expires_at_ms),
    minimum_app_version: release.minimum_app_version,
    published_at: new Date(release.published_at).toISOString(),
    ...(release.sponsor_kind && release.sponsor_name
      ? {
          sponsor: {
            kind: release.sponsor_kind,
            sponsor_name: release.sponsor_name,
            message: release.sponsor_message,
            campaign_title: release.sponsor_campaign_title,
            logo_url: release.sponsor_logo_url,
          },
        }
      : {}),
    assets: publicAssets,
  };
  return cacheableJsonResponse(request, manifest, {
    etag: `"wbd-content-r${release.revision}"`,
    cacheControl: "public, max-age=300, must-revalidate",
    lastModifiedMs: release.published_at,
  });
}

async function contentAsset(
  request: Request,
  env: ApiEnv,
  releaseID: string,
  kind: string,
): Promise<Response> {
  if (kind !== PARTY_DECK_KIND && kind !== SOLO_GIST_KIND) {
    throw new ApiError(404, "content_asset_not_found", "The content asset was not found.");
  }
  const row = await database(env)
    .prepare(
      `SELECT
        a.release_id, a.kind, a.content_version, a.sha256,
        a.byte_count, a.item_count, a.payload_json
       FROM content_assets a
       JOIN content_releases r ON r.id = a.release_id
       WHERE a.release_id = ?1
         AND a.kind = ?2
         AND r.status IN ('published', 'superseded')
         AND r.effective_from_ms <= ?3
       LIMIT 1`,
    )
    .bind(releaseID, kind, Date.now())
    .first<ContentAssetRow>();
  if (!row) {
    throw new ApiError(404, "content_asset_not_found", "The content asset was not found.");
  }

  const etag = `"sha256-${row.sha256}"`;
  const headers = new Headers({
    "cache-control": "public, max-age=31536000, immutable",
    "content-type": "application/json; charset=utf-8",
    "content-length": String(row.byte_count),
    "x-content-sha256": row.sha256,
    "x-content-type-options": "nosniff",
    etag,
  });
  if (etagMatches(request, etag)) return new Response(null, { status: 304, headers });
  return new Response(row.payload_json, { status: 200, headers });
}

async function validateContentRelease(
  request: Request,
  env: ApiEnv,
): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, {
    maximumBytes: MAX_CONTENT_JSON_BYTES,
    requireApplicationJSON: true,
  });
  const validation = await validateAndPrepareContentRelease(payload);
  if (!validation.release) {
    return json({ valid: false, issues: validation.issues }, 422);
  }
  await assertDailyQuestionsAreFresh(database(env), validation.release);
  return json({ valid: true, release: contentReleaseSummary(validation.release) });
}

/**
 * Today’s 5 is a daily-return promise, not a randomizer with the same cards
 * every Monday. A replacement for the same WAT week may reuse its pack so an
 * editorial correction remains possible, but the immediately previous weekly
 * release is a hard no-repeat boundary. Revoked releases are included too: if
 * cards reached the public manifest, treat them as seen rather than recycle.
 */
async function assertDailyQuestionsAreFresh(
  db: D1Database,
  candidate: PreparedContentRelease,
): Promise<void> {
  const previous = await db
    .prepare(
      `SELECT r.id, r.effective_week_wat, a.payload_json
       FROM content_releases r
       JOIN content_assets a ON a.release_id = r.id
       WHERE a.kind = ?1
         AND r.status IN ('published', 'superseded', 'revoked')
         AND r.effective_from_ms < ?2
       ORDER BY r.effective_from_ms DESC, r.revision DESC
       LIMIT 1`,
    )
    .bind(SOLO_GIST_KIND, candidate.effectiveFromMs)
    .first<{ id: string; effective_week_wat: string; payload_json: string }>();
  if (!previous) return;

  const currentAsset = candidate.assets.find((asset) => asset.kind === SOLO_GIST_KIND);
  if (!currentAsset) {
    throw new ApiError(503, "content_release_incomplete", "The candidate Solo asset is missing.");
  }
  const candidateIDs = dailyQuestionIDs(currentAsset.payloadJson);
  const previousIDs = dailyQuestionIDs(previous.payload_json);
  if (!candidateIDs || !previousIDs) {
    throw new ApiError(
      503,
      "content_history_unavailable",
      "Daily-card freshness could not be verified against the previous release.",
    );
  }
  const reused = [...candidateIDs].filter((id) => previousIDs.has(id));
  if (reused.length > 0) {
    throw new ApiError(
      409,
      "daily_question_reuse",
      "The next weekly release reuses Today’s 5 questions from the previous week.",
      {
        previous_release_id: previous.id,
        previous_effective_week_wat: previous.effective_week_wat,
        reused_question_count: reused.length,
      },
    );
  }
}

function dailyQuestionIDs(payloadJson: string): Set<string> | null {
  try {
    const document = JSON.parse(payloadJson) as {
      daily_packs?: Array<{ question_ids?: unknown }>;
    };
    if (!Array.isArray(document.daily_packs) || document.daily_packs.length !== 7) {
      return null;
    }
    const ids = new Set<string>();
    for (const pack of document.daily_packs) {
      if (!Array.isArray(pack.question_ids) || pack.question_ids.length !== 5) return null;
      for (const id of pack.question_ids) {
        if (typeof id !== "string" || !id.trim()) return null;
        ids.add(id.trim());
      }
    }
    return ids.size === 35 ? ids : null;
  } catch {
    return null;
  }
}

async function publishContentRelease(
  request: Request,
  env: ApiEnv,
): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, {
    maximumBytes: MAX_CONTENT_JSON_BYTES,
    requireApplicationJSON: true,
  });
  const validation = await validateAndPrepareContentRelease(payload);
  const release = validation.release;
  if (!release) return json({ valid: false, issues: validation.issues }, 422);
  if (release.expiresAtMs <= Date.now()) {
    return json(
      { valid: false, issues: ["release.expires_at_wat:must_be_in_the_future"] },
      422,
    );
  }

  const db = database(env);
  await assertDailyQuestionsAreFresh(db, release);
  const maximumRevision = await db
    .prepare(`SELECT MAX(revision) AS revision FROM content_releases`)
    .first<{ revision: number | null }>();
  if (maximumRevision?.revision !== null && maximumRevision?.revision !== undefined) {
    if (release.revision <= maximumRevision.revision) {
      throw new ApiError(
        409,
        "content_revision_not_monotonic",
        "The release revision must be greater than every published revision.",
        { current_revision: maximumRevision.revision },
      );
    }
  }

  const overlap = await db
    .prepare(
      `SELECT id, effective_week_wat
       FROM content_releases
       WHERE status = 'published'
         AND effective_week_wat != ?1
         AND effective_from_ms < ?2
         AND expires_at_ms > ?3
       LIMIT 1`,
    )
    .bind(release.effectiveWeekWat, release.expiresAtMs, release.effectiveFromMs)
    .first<{ id: string; effective_week_wat: string }>();
  if (overlap) {
    throw new ApiError(
      409,
      "content_schedule_overlap",
      "The release overlaps another published WAT content week.",
      { release_id: overlap.id, effective_week_wat: overlap.effective_week_wat },
    );
  }

  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE content_releases
         SET status = 'superseded'
         WHERE effective_week_wat = ?1 AND status = 'published'`,
      )
      .bind(release.effectiveWeekWat),
    db
      .prepare(
        `INSERT INTO content_releases (
          id, revision, schema_version, status, effective_week_wat,
          effective_from_ms, expires_at_ms, minimum_app_version,
          sponsor_kind, sponsor_name, sponsor_message, sponsor_campaign_title, sponsor_logo_url,
          published_by, published_at, created_at
        ) VALUES (?1, ?2, ?3, 'published', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)`,
      )
      .bind(
        release.id,
        release.revision,
        release.schemaVersion,
        release.effectiveWeekWat,
        release.effectiveFromMs,
        release.expiresAtMs,
        release.minimumAppVersion,
        release.sponsor?.kind ?? null,
        release.sponsor?.sponsorName ?? null,
        release.sponsor?.message ?? null,
        release.sponsor?.campaignTitle ?? null,
        release.sponsor?.logoURL ?? null,
        authorization.publishedBy,
        now,
      ),
    ...release.assets.map((asset) =>
      db
        .prepare(
          `INSERT INTO content_assets (
            release_id, kind, content_version, sha256, byte_count,
            item_count, payload_json, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        )
        .bind(
          release.id,
          asset.kind,
          asset.contentVersion,
          asset.sha256,
          asset.byteCount,
          asset.itemCount,
          asset.payloadJson,
          now,
        ),
    ),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLocaleLowerCase() : String(error);
    if (message.includes("unique")) {
      throw new ApiError(
        409,
        "content_release_already_exists",
        "The release ID or revision has already been published.",
      );
    }
    throw error;
  }

  return json(
    {
      published: true,
      release: contentReleaseSummary(release),
      manifest_url: new URL("/api/v1/content/manifest", request.url).href,
    },
    201,
  );
}

async function changeContentReleaseStatus(request: Request, env: ApiEnv, action: "rollback" | "revoke"): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: MAX_CONTENT_JSON_BYTES, requireApplicationJSON: true });
  const reason = adminReason(payload);
  const releaseID = typeof payload.release_id === "string" ? payload.release_id.trim() : "";
  if (!releaseID || releaseID.length > 128) throw new ApiError(400, "release_id_required", "A content release ID is required.");
  const db = database(env);
  const release = await db.prepare(`SELECT id, effective_week_wat, status FROM content_releases WHERE id = ?1 LIMIT 1`).bind(releaseID).first<{ id: string; effective_week_wat: string; status: string }>();
  if (!release) throw new ApiError(404, "content_release_not_found", "The requested content release was not found.");
  if (action === "revoke" && release.status === "revoked") return json({ revoked: true, already_revoked: true, release_id: releaseID });
  if (action === "rollback" && release.status === "revoked") throw new ApiError(409, "content_release_revoked", "A revoked content release cannot be restored.");
  const now = Date.now();
  const nextStatus = action === "rollback" ? "published" : "revoked";
  const statements: D1PreparedStatement[] = [];
  if (action === "rollback") statements.push(db.prepare(`UPDATE content_releases SET status = 'superseded' WHERE status = 'published' AND effective_week_wat = ?1`).bind(release.effective_week_wat));
  statements.push(db.prepare(`UPDATE content_releases SET status = ?1 WHERE id = ?2`).bind(nextStatus, releaseID));
  statements.push(db.prepare(`INSERT INTO content_release_audit (id, release_id, action, actor, reason, changed_at, details_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`).bind(crypto.randomUUID(), releaseID, action, authorization.publishedBy, reason, now, JSON.stringify({ from: release.status, to: nextStatus })));
  await db.batch(statements);
  return json({ [action === "rollback" ? "rolled_back" : "revoked"]: true, release_id: releaseID });
}

function appConfigETag(config: AppConfigDocument): string {
  return `"wbd-app-config-r${config.revision}"`;
}

async function currentAppConfig(request: Request, env: ApiEnv): Promise<Response> {
  let config = await publishedAppConfig(env);
  // The player-facing config must never claim that an Odogwu round is live
  // unless the competition that backs it is still open and card-backed. This
  // closes the gap where a stale published config could say "live" while the
  // player API correctly returned no_active_competition.
  if (env.DB) {
    const league = config.events.odogwu_league;
    const now = Date.now();
    const startsAt = league.starts_at ? Date.parse(league.starts_at) : NaN;
    const endsAt = league.ends_at ? Date.parse(league.ends_at) : NaN;
    if (league.enabled && league.home_placement === "banner" && Number.isFinite(startsAt) && Number.isFinite(endsAt) && now < endsAt) {
      try {
        await reconcileCompetitionLifecycle(env.DB);
        const backingRound = await env.DB.prepare(`
          SELECT c.id, c.opens_at, c.closes_at, c.status
          FROM competitions c
          WHERE c.status IN ('open', 'scheduled')
            AND c.content_status = 'published'
            AND lower(c.title) LIKE '%odogwu%'
            AND c.opens_at IS NOT NULL
            AND c.closes_at IS NOT NULL
            AND (SELECT COUNT(*) FROM competition_cards cc WHERE cc.competition_id = c.id) >= c.question_count
          ORDER BY CASE WHEN c.status = 'open' AND c.opens_at <= ?1 AND c.closes_at > ?1 THEN 0 ELSE 1 END,
            c.opens_at ASC, c.id ASC
          LIMIT 1
        `).bind(now).first<{ id: string; opens_at: number; closes_at: number; status: string }>();
        if (backingRound) {
          // The competition record is authoritative for the schedule. This
          // keeps a rescheduled round's banner/countdown connected even when
          // the older published app-config revision still has previous times.
          config = {
            ...config,
            events: {
              ...config.events,
              odogwu_league: {
                ...config.events.odogwu_league,
                starts_at: new Date(backingRound.opens_at).toISOString(),
                ends_at: new Date(backingRound.closes_at).toISOString(),
                // Banner visibility is operator-controlled and independent of
                // the competition start. Never move it when a round is
                // rescheduled.
                visible_from: null,
              },
            },
          };
        } else if (config.events.odogwu_league.starts_at || config.events.odogwu_league.ends_at) {
          // Do not hide a manually enabled banner merely because the previous
          // round was cancelled or rescheduled. Remove only the stale timer.
          config = {
            ...config,
            events: {
              ...config.events,
              odogwu_league: { ...config.events.odogwu_league, starts_at: null, ends_at: null, visible_from: null },
            },
          };
        }
      } catch {
        // Fail closed for the live player surface if the backing state cannot
        // be checked. The competition API also fails closed in this case.
        config = safeDefaultAppConfig();
      }
    }
  }
  return cacheableJsonResponse(request, config, {
    etag: appConfigETag(config),
    // League start/stop state is backed by the competition table and can
    // change independently of the published config. Keep this short-lived so
    // a cancelled or edited schedule cannot remain on a player's screen for
    // the full editorial-config cache window.
    cacheControl: env.DB ? "public, max-age=30, must-revalidate" : "no-store",
    lastModifiedMs: Date.parse(config.published_at),
  });
}

async function publishedAppConfig(env: ApiEnv): Promise<AppConfigDocument> {
  if (!env.DB) return safeDefaultAppConfig();
  let config = safeDefaultAppConfig();
  try {
    const row = await env.DB.prepare(
      `SELECT config_json FROM app_config_revisions
       WHERE status = 'published' ORDER BY revision DESC LIMIT 1`,
    ).first<{ config_json: string }>();
    if (row) {
      try {
        const parsed = JSON.parse(row.config_json) as unknown;
        const validation = validateAppConfig(parsed);
        if (validation.config && validation.issues.length === 0) config = validation.config;
      } catch {
        // Fail closed to the safe defaults rather than serving corrupt controls.
      }
    }
  } catch {
    // A missing or temporarily unavailable config table must not take down the app.
    // The validated safe defaults keep financial features disabled.
  }
  return config;
}

async function currentLeagueSchedule(request: Request, env: ApiEnv): Promise<Response> {
  const config = await publishedAppConfig(env);

  const schedule = config.events.odogwu_league.weekly_schedule;
  const state = schedule
    ? resolveLeagueSchedule(schedule)
    : {
      timezone: "Africa/Lagos" as const,
      is_open: false,
      current_open_at: null,
      current_close_at: null,
      next_open_at: null,
      next_close_at: null,
    };
  return cacheableJsonResponse(request, {
    event_id: "odogwu-league",
    enabled: config.events.odogwu_league.enabled,
    entry_enabled: config.events.odogwu_league.entry_enabled,
    revision: config.revision,
    schedule,
    ...state,
  }, {
    etag: `"wbd-league-schedule-r${config.revision}"`,
    cacheControl: "public, max-age=30, must-revalidate",
  });
}

function configPayload(payload: Record<string, unknown>): unknown {
  return payload.config ?? payload;
}

function adminReason(payload: Record<string, unknown>): string {
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (!reason || reason.length > 500) throw new ApiError(400, "config_reason_required", "A concise change reason is required.");
  return reason;
}

async function validateAppConfigRequest(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: MAX_JSON_BYTES, requireApplicationJSON: true });
  const result = validateAppConfig(configPayload(payload));
  return result.config && result.issues.length === 0
    ? json({ valid: true, config: result.config })
    : json({ valid: false, issues: result.issues }, 422);
}

async function publishAppConfig(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: MAX_JSON_BYTES, requireApplicationJSON: true });
  const reason = adminReason(payload);
  const db = database(env);
  let result: ReturnType<typeof validateAppConfig>;
  if (payload.config !== undefined) {
    result = validateAppConfig(payload.config);
  } else {
    const revision = Number(payload.revision);
    if (!Number.isInteger(revision) || revision < 1) throw new ApiError(400, "config_or_revision_required", "Provide a config document or a reviewed revision.");
    const reviewed = await db.prepare(`SELECT config_json FROM app_config_revisions WHERE revision = ?1 AND status = 'review' LIMIT 1`).bind(revision).first<{ config_json: string }>();
    if (!reviewed) throw new ApiError(404, "config_revision_not_found", "The reviewed app-config revision was not found.");
    result = validateAppConfig(JSON.parse(reviewed.config_json) as unknown);
  }
  if (!result.config || result.issues.length) return json({ published: false, issues: result.issues }, 422);
  const existing = await db.prepare(`SELECT id, status, config_json FROM app_config_revisions WHERE revision = ?1 LIMIT 1`).bind(result.config.revision).first<{ id: string; status: string; config_json: string }>();
  const now = Date.now();
  if (existing) {
    if (existing.status !== "review") {
      throw new ApiError(409, "config_revision_not_publishable", "Only a reviewed app-config revision can be published.", { revision: result.config.revision, status: existing.status });
    }
    if (existing.config_json !== JSON.stringify(result.config)) {
      throw new ApiError(409, "config_revision_changed", "The reviewed configuration does not match the publish payload.", { revision: result.config.revision });
    }
    await db.batch([
      db.prepare(`UPDATE app_config_revisions SET status = 'rolled_back' WHERE status = 'published'`),
      db.prepare(`UPDATE app_config_revisions SET status = 'published', published_at = ?1 WHERE id = ?2`).bind(now, existing.id),
      db.prepare(`INSERT INTO app_config_audit (id, revision_id, action, actor, reason, changed_at, details_json) VALUES (?1, ?2, 'publish', ?3, ?4, ?5, ?6)`).bind(crypto.randomUUID(), existing.id, authorization.publishedBy, reason, now, JSON.stringify({ revision: result.config.revision, from: "review" })),
    ]);
    return json({ published: true, config: result.config });
  }
  const current = await db.prepare(`SELECT MAX(revision) AS revision FROM app_config_revisions`).first<{ revision: number | null }>();
  if (current?.revision !== null && current?.revision !== undefined && result.config.revision <= current.revision) {
    throw new ApiError(409, "config_revision_not_monotonic", "The app-config revision must increase.", { current_revision: current.revision });
  }
  const id = `app-config-${result.config.revision}`;
  await db.batch([
    db.prepare(`UPDATE app_config_revisions SET status = 'rolled_back' WHERE status = 'published'`),
    db.prepare(`INSERT INTO app_config_revisions (id, revision, status, config_json, created_by, reason, created_at, published_at) VALUES (?1, ?2, 'published', ?3, ?4, ?5, ?6, ?6)`).bind(id, result.config.revision, JSON.stringify(result.config), authorization.publishedBy, reason, now),
    db.prepare(`INSERT INTO app_config_audit (id, revision_id, action, actor, reason, changed_at, details_json) VALUES (?1, ?2, 'publish', ?3, ?4, ?5, ?6)`).bind(crypto.randomUUID(), id, authorization.publishedBy, reason, now, JSON.stringify({ revision: result.config.revision })),
  ]);
  return json({ published: true, config: result.config }, 201);
}

async function createAppConfigDraft(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: MAX_JSON_BYTES, requireApplicationJSON: true });
  const reason = adminReason(payload);
  const result = validateAppConfig(configPayload(payload));
  if (!result.config || result.issues.length) return json({ saved: false, issues: result.issues }, 422);
  const db = database(env);
  const now = Date.now();
  const id = `app-config-${result.config.revision}`;
  const configJSON = JSON.stringify(result.config);
  const existing = await db.prepare(`SELECT id, status, config_json, created_by FROM app_config_revisions WHERE revision = ?1 LIMIT 1`).bind(result.config.revision).first<{ id: string; status: string; config_json: string; created_by: string }>();
  if (existing) {
    if (existing.status === "draft" && existing.created_by === authorization.publishedBy && existing.config_json === configJSON) {
      return json({ saved: true, status: "draft", revision: result.config.revision, already_exists: true });
    }
    throw new ApiError(409, "config_revision_exists", "That app-config revision already exists.");
  }
  try {
    await db.batch([
      db.prepare(`INSERT INTO app_config_revisions (id, revision, status, config_json, created_by, reason, created_at) VALUES (?1, ?2, 'draft', ?3, ?4, ?5, ?6)`).bind(id, result.config.revision, configJSON, authorization.publishedBy, reason, now),
      db.prepare(`INSERT INTO app_config_audit (id, revision_id, action, actor, reason, changed_at, details_json) VALUES (?1, ?2, 'draft', ?3, ?4, ?5, ?6)`).bind(crypto.randomUUID(), id, authorization.publishedBy, reason, now, JSON.stringify({ revision: result.config.revision })),
    ]);
  } catch (error) {
    if (String(error).toLocaleLowerCase().includes("unique")) throw new ApiError(409, "config_revision_exists", "That app-config revision already exists.");
    throw error;
  }
  return json({ saved: true, status: "draft", revision: result.config.revision }, 201);
}

async function reviewAppConfig(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: MAX_JSON_BYTES, requireApplicationJSON: true });
  const reason = adminReason(payload);
  const revision = Number(payload.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new ApiError(400, "config_revision_required", "A positive revision is required.");
  const db = database(env);
  const row = await db.prepare(`SELECT id, status FROM app_config_revisions WHERE revision = ?1 LIMIT 1`).bind(revision).first<{ id: string; status: string }>();
  if (!row) throw new ApiError(404, "config_revision_not_found", "The requested app-config revision was not found.");
  if (row.status !== "draft" && row.status !== "review") throw new ApiError(409, "config_revision_not_reviewable", "Only draft app-config revisions can enter review.");
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE app_config_revisions SET status = 'review' WHERE id = ?1`).bind(row.id),
    db.prepare(`INSERT INTO app_config_audit (id, revision_id, action, actor, reason, changed_at, details_json) VALUES (?1, ?2, 'review', ?3, ?4, ?5, ?6)`).bind(crypto.randomUUID(), row.id, authorization.publishedBy, reason, now, JSON.stringify({ revision })),
  ]);
  return json({ reviewed: true, status: "review", revision });
}

async function disableAppConfig(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: MAX_JSON_BYTES, requireApplicationJSON: true });
  const reason = adminReason(payload);
  const db = database(env);
  const row = await db.prepare(`SELECT id FROM app_config_revisions WHERE status = 'published' ORDER BY revision DESC LIMIT 1`).first<{ id: string }>();
  if (!row) return json({ disabled: true, already_disabled: true });
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE app_config_revisions SET status = 'disabled' WHERE id = ?1`).bind(row.id),
    db.prepare(`INSERT INTO app_config_audit (id, revision_id, action, actor, reason, changed_at, details_json) VALUES (?1, ?2, 'emergency_disable', ?3, ?4, ?5, '{}')`).bind(crypto.randomUUID(), row.id, authorization.publishedBy, reason, now),
  ]);
  return json({ disabled: true, safe_defaults_active: true });
}

async function changeAppConfigStatus(request: Request, env: ApiEnv, action: "rollback" | "revoke"): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: MAX_JSON_BYTES, requireApplicationJSON: true });
  const reason = adminReason(payload);
  const revision = Number(payload.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new ApiError(400, "config_revision_required", "A positive revision is required.");
  const db = database(env);
  const row = await db.prepare(`SELECT id, config_json FROM app_config_revisions WHERE revision = ?1 LIMIT 1`).bind(revision).first<{ id: string; config_json: string }>();
  if (!row) throw new ApiError(404, "config_revision_not_found", "The requested app-config revision was not found.");
  const now = Date.now();
  const nextStatus = action === "rollback" ? "published" : "revoked";
  const statements: D1PreparedStatement[] = [];
  if (action === "rollback") statements.push(db.prepare(`UPDATE app_config_revisions SET status = 'rolled_back' WHERE status = 'published'`));
  statements.push(db.prepare(`UPDATE app_config_revisions SET status = ?1, published_at = ?2 WHERE id = ?3`).bind(nextStatus, action === "rollback" ? now : null, row.id));
  statements.push(db.prepare(`INSERT INTO app_config_audit (id, revision_id, action, actor, reason, changed_at, details_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`).bind(crypto.randomUUID(), row.id, action, authorization.publishedBy, reason, now, JSON.stringify({ revision })));
  await db.batch(statements);
  return json({ [action === "rollback" ? "rolled_back" : "revoked"]: true, revision });
}

async function contentAdminSession(
  request: Request,
  env: ApiEnv,
): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  return json({ authorized: true, method: authorization.method });
}

async function listAdminContentReleases(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const result = await database(env).prepare(`SELECT r.id, r.revision, r.effective_week_wat, r.effective_from_ms,
      r.status, r.published_at, r.created_at, COUNT(a.release_id) AS asset_count
    FROM content_releases r LEFT JOIN content_assets a ON a.release_id = r.id
    GROUP BY r.id ORDER BY r.effective_from_ms DESC, r.revision DESC LIMIT 50`).all();
  return json({ releases: result.results ?? [] });
}

type PartyDeckEditorCard = {
  "Card Number": number;
  ID: string;
  Difficulty: "Easy" | "Medium" | "Hard";
  Category: string;
  "Main Word": string;
  "Forbidden Word 1": string;
  "Forbidden Word 2": string;
  "Forbidden Word 3": string;
};

const PARTY_DECK_EDITOR_KEYS = [
  "Card Number",
  "ID",
  "Difficulty",
  "Category",
  "Main Word",
  "Forbidden Word 1",
  "Forbidden Word 2",
  "Forbidden Word 3",
] as const;

function normalizedEditorText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-NG").replace(/\s+/g, " ");
}

function validatePartyDeckEditorCards(value: unknown): {
  cards: PartyDeckEditorCard[] | null;
  issues: string[];
} {
  const issues: string[] = [];
  if (!Array.isArray(value)) return { cards: null, issues: ["cards:array_required"] };
  if (value.length < PARTY_DECK_EDITOR_MIN_CARDS || value.length > PARTY_DECK_EDITOR_MAX_CARDS) {
    issues.push(`cards:count:${value.length}/${PARTY_DECK_EDITOR_MIN_CARDS}-${PARTY_DECK_EDITOR_MAX_CARDS}`);
  }

  const cards: PartyDeckEditorCard[] = [];
  const numbers = new Set<number>();
  const ids = new Set<string>();
  const mainWords = new Set<string>();
  value.forEach((candidate, index) => {
    const path = `cards[${index}]`;
    if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") {
      issues.push(`${path}:object_required`);
      return;
    }
    const card = candidate as Record<string, unknown>;
    for (const key of Object.keys(card)) {
      if (!(PARTY_DECK_EDITOR_KEYS as readonly string[]).includes(key)) issues.push(`${path}:unknown_field:${key}`);
    }
    const number = card["Card Number"];
    const id = typeof card.ID === "string" ? card.ID.trim() : "";
    const difficulty = card.Difficulty;
    const rawCategory = typeof card.Category === "string" ? card.Category.trim() : "";
    const category = PARTY_DECK_EDITOR_CATEGORY_ALIASES.get(rawCategory) ?? rawCategory;
    const mainWord = typeof card["Main Word"] === "string" ? card["Main Word"].trim() : "";
    const forbidden = [1, 2, 3].map((suffix) => {
      const key = `Forbidden Word ${suffix}`;
      return typeof card[key] === "string" ? card[key].trim() : "";
    });

    if (!Number.isSafeInteger(number) || Number(number) < 1) issues.push(`${path}.Card Number:positive_integer_required`);
    if (typeof number === "number" && numbers.has(number)) issues.push(`${path}.Card Number:duplicate`);
    if (typeof number === "number") numbers.add(number);
    if (!id) issues.push(`${path}.ID:nonempty_string_required`);
    if (ids.has(normalizedEditorText(id))) issues.push(`${path}.ID:duplicate`);
    ids.add(normalizedEditorText(id));
    if (difficulty !== "Easy" && difficulty !== "Medium" && difficulty !== "Hard") issues.push(`${path}.Difficulty:invalid`);
    if (!category || category.length > 80 || /[<>\u0000-\u001f]/.test(category) || (
      rawCategory !== category && !PARTY_DECK_EDITOR_CATEGORY_ALIASES.has(rawCategory)
    )) issues.push(`${path}.Category:invalid`);
    if (!mainWord) issues.push(`${path}.Main Word:nonempty_string_required`);
    const normalizedMain = normalizedEditorText(mainWord);
    if (mainWords.has(normalizedMain)) issues.push(`${path}.Main Word:duplicate`);
    mainWords.add(normalizedMain);
    if (forbidden.some((word) => !word)) issues.push(`${path}:three_forbidden_words_required`);
    if (new Set(forbidden.map(normalizedEditorText)).size !== 3) issues.push(`${path}:forbidden_words_must_be_distinct`);
    if (forbidden.some((word) => normalizedEditorText(word) === normalizedMain)) issues.push(`${path}:forbidden_word_matches_main_word`);
    if (id.length > 160 || mainWord.length > 240 || forbidden.some((word) => word.length > 240)) issues.push(`${path}:text_too_long`);

    cards.push({
      "Card Number": Number(number),
      ID: id,
      Difficulty: difficulty as PartyDeckEditorCard["Difficulty"],
      Category: category,
      "Main Word": mainWord,
      "Forbidden Word 1": forbidden[0],
      "Forbidden Word 2": forbidden[1],
      "Forbidden Word 3": forbidden[2],
    });
  });

  return { cards: issues.length ? null : cards, issues };
}

function bundledPartyDeckCards(): PartyDeckEditorCard[] {
  const validation = validatePartyDeckEditorCards(bundledPartyDeckCatalog);
  if (!validation.cards) throw new Error(`Bundled party deck is invalid: ${validation.issues.join(", ")}`);
  return validation.cards;
}

async function getPartyDeckEditorState(request: Request, env: ApiEnv): Promise<Response> {
  await authorizeContentAdmin(request, env);
  const row = await database(env)
    .prepare("SELECT cards_json, updated_by, updated_at FROM party_deck_editor_state WHERE id = ?1 LIMIT 1")
    .bind(PARTY_DECK_EDITOR_ID)
    .first<{ cards_json: string; updated_by: string; updated_at: number }>();
  if (!row) return json({ cards: bundledPartyDeckCards(), updated_at: null, updated_by: null, source: "bundled_catalog" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.cards_json) as unknown;
  } catch {
    throw new ApiError(503, "party_deck_editor_corrupt", "The saved card draft could not be read.");
  }
  const validation = validatePartyDeckEditorCards(parsed);
  if (!validation.cards) throw new ApiError(503, "party_deck_editor_corrupt", "The saved card draft failed validation.");
  return json({ cards: validation.cards, updated_at: row.updated_at, updated_by: row.updated_by, source: "saved_draft" });
}

async function savePartyDeckEditorState(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: MAX_CONTENT_JSON_BYTES, requireApplicationJSON: true });
  const validation = validatePartyDeckEditorCards(payload.cards);
  if (!validation.cards) return json({ saved: false, issues: validation.issues }, 422);
  const expectedUpdatedAt = payload.expected_updated_at === null || payload.expected_updated_at === undefined
    ? null
    : Number(payload.expected_updated_at);
  if (expectedUpdatedAt !== null && !Number.isSafeInteger(expectedUpdatedAt)) throw new ApiError(400, "expected_updated_at_invalid", "The editor version is invalid.");
  const db = database(env);
  const existing = await db.prepare("SELECT updated_at FROM party_deck_editor_state WHERE id = ?1 LIMIT 1").bind(PARTY_DECK_EDITOR_ID).first<{ updated_at: number }>();
  if ((existing && expectedUpdatedAt !== existing.updated_at) || (!existing && expectedUpdatedAt !== null)) {
    throw new ApiError(409, "party_deck_editor_conflict", "This card list changed elsewhere. Reload it before saving.", { updated_at: existing?.updated_at ?? null });
  }
  const now = Date.now();
  await db.prepare(
    `INSERT INTO party_deck_editor_state (id, cards_json, updated_by, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET cards_json = excluded.cards_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(PARTY_DECK_EDITOR_ID, JSON.stringify(validation.cards), authorization.publishedBy, now).run();
  return json({ saved: true, cards: validation.cards, updated_at: now, updated_by: authorization.publishedBy });
}

function phoneVerificationUnavailable(): Response {
  const capability = getPhoneVerificationProvider().capability;
  return json(
    {
      error: {
        code: "phone_verification_unavailable",
        message: "Phone verification is not configured yet.",
        details: capability,
      },
    },
    503,
  );
}

async function capabilities(env: ApiEnv): Promise<Response> {
  const phone = getPhoneVerificationProvider().capability;
  const readiness = env.DB
    ? await cashLaunchReadiness(database(env))
    : { available: false, blockers: [...REQUIRED_CASH_LAUNCH_GATES] };
  return json({
    api_version: API_VERSION,
    capabilities: {
      guest_sessions: Boolean(env.DB),
      phone_verification: phone,
      remote_push_registration: {
        available: Boolean(env.DB && env.WBD_PUSH_TOKEN_ENCRYPTION_SECRET?.trim()),
        delivery: "registration_only",
      },
      play_on_call: {
        available: playOnCallIsConfigured(env),
        transport: "durable_object_websocket_v1",
        call_audio_or_video: "external_app",
      },
      cash_attempts: {
        available: readiness.available,
        reason: readiness.available ? "remote_cash_enablement_required" : "launch_gates_incomplete",
        phone_verification_required: true,
        device_attestation_required: true,
        trusted_timing_required: true,
        required_launch_gates: REQUIRED_CASH_LAUNCH_GATES,
        blockers: readiness.blockers,
      },
    },
  });
}

type CashLaunchGateStatus = "pending" | "passed" | "failed";

function cashLaunchGateStatus(value: unknown): CashLaunchGateStatus {
  if (value === "pending" || value === "passed" || value === "failed") return value;
  throw new ApiError(400, "invalid_cash_launch_gate_status", "Use pending, passed, or failed.");
}

async function listCashLaunchGates(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const db = database(env);
  const result = await db
    .prepare(
      `SELECT gate_key, status, evidence_reference, note, reviewed_by, reviewed_at, updated_at
       FROM cash_launch_gates`,
    )
    .all<{
      gate_key: string;
      status: CashLaunchGateStatus;
      evidence_reference: string | null;
      note: string | null;
      reviewed_by: string | null;
      reviewed_at: number | null;
      updated_at: number;
    }>();
  const records = new Map((result.results ?? []).map((row) => [row.gate_key, row]));
  const gates = REQUIRED_CASH_LAUNCH_GATES.map((gate) => records.get(gate) ?? {
    gate_key: gate,
    status: "pending" as const,
    evidence_reference: null,
    note: null,
    reviewed_by: null,
    reviewed_at: null,
    updated_at: null,
  });
  const audit = await db
    .prepare(
      `SELECT id, gate_key, status, evidence_reference, note, reviewed_by, changed_at
       FROM cash_launch_gate_audit
       ORDER BY changed_at DESC, id DESC
       LIMIT 500`,
    )
    .all<{
      id: string;
      gate_key: CashLaunchGateKey;
      status: CashLaunchGateStatus;
      evidence_reference: string | null;
      note: string;
      reviewed_by: string;
      changed_at: number;
    }>();
  const readiness = await cashLaunchReadiness(db);
  return json({
    available: readiness.available,
    blockers: readiness.blockers,
    gates,
    audit: audit.results ?? [],
  });
}

async function updateCashLaunchGate(
  request: Request,
  env: ApiEnv,
  gateKey: string,
): Promise<Response> {
  if (!isCashLaunchGateKey(gateKey)) {
    throw new ApiError(404, "cash_launch_gate_not_found", "The requested cash launch gate does not exist.");
  }
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, {
    maximumBytes: 16_000,
    requireApplicationJSON: true,
  });
  const status = cashLaunchGateStatus(payload.status);
  const evidenceReference = typeof payload.evidence_reference === "string"
    ? payload.evidence_reference.trim().slice(0, 500)
    : "";
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2_000) : "";
  if (!note) throw new ApiError(400, "cash_launch_gate_note_required", "A gate review note is required.");
  if (status === "passed" && !evidenceReference) {
    throw new ApiError(
      400,
      "cash_launch_gate_evidence_required",
      "A passed launch gate requires a restricted evidence reference.",
    );
  }
  const now = Date.now();
  const db = database(env);
  await db.batch([
    db.prepare(
      `INSERT INTO cash_launch_gates (
        gate_key, status, evidence_reference, note, reviewed_by, reviewed_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
      ON CONFLICT(gate_key) DO UPDATE SET
        status = excluded.status,
        evidence_reference = excluded.evidence_reference,
        note = excluded.note,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        updated_at = excluded.updated_at`,
    )
      .bind(gateKey, status, evidenceReference || null, note, authorization.publishedBy, now),
    db.prepare(
      `INSERT INTO cash_launch_gate_audit (
        id, gate_key, status, evidence_reference, note, reviewed_by, changed_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind(
        crypto.randomUUID(),
        gateKey,
        status,
        evidenceReference || null,
        note,
        authorization.publishedBy,
        now,
      ),
  ]);
  const readiness = await cashLaunchReadiness(db);
  return json({ updated: true, gate_key: gateKey, status, available: readiness.available, blockers: readiness.blockers });
}

function eligibleCompetitionCountries(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new ApiError(400, "invalid_eligible_countries", "Provide between 1 and 32 ISO two-letter country codes.");
  }
  const countries = [...new Set(value.map((country) =>
    typeof country === "string"
      ? normalizedCountryCode(country)
      : "",
  ))];
  if (countries.some((country) => !/^[A-Z]{2}$/.test(country))) {
    throw new ApiError(400, "invalid_eligible_countries", "Every eligible country must use an ISO two-letter country code; use GB for the United Kingdom.");
  }
  return countries;
}

async function updateCompetitionEligibleCountries(
  request: Request,
  env: ApiEnv,
  competitionID: string,
): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, {
    maximumBytes: 8_000,
    requireApplicationJSON: true,
  });
  const countries = eligibleCompetitionCountries(payload.eligible_countries);
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2_000) : "";
  if (!note) throw new ApiError(400, "eligibility_policy_note_required", "An eligibility-policy review note is required.");
  const db = database(env);
  const competition = await db.prepare(
    "SELECT id, status, currency FROM competitions WHERE id = ?1 LIMIT 1",
  ).bind(competitionID).first<{ id: string; status: string; currency: string }>();
  if (!competition) throw new ApiError(404, "competition_not_found", "The requested competition does not exist.");
  if (competition.status !== "draft" && competition.status !== "scheduled") {
    throw new ApiError(409, "competition_eligibility_policy_locked", "Country eligibility can only change before a competition opens.");
  }
  const now = Date.now();
  const countriesJSON = JSON.stringify(countries);
  await db.batch([
    db.prepare("UPDATE competitions SET eligible_countries_json = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(countriesJSON, now, competition.id),
    db.prepare(`INSERT INTO competition_eligibility_policy_audit (
      id, competition_id, eligible_countries_json, actor, note, changed_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(crypto.randomUUID(), competition.id, countriesJSON, authorization.publishedBy, note, now),
  ]);
  return json({
    updated: true,
    competition_id: competition.id,
    eligible_countries: countries,
    prize_currency: competition.currency,
  });
}

type CashReviewStatus = "queued" | "in_review" | "cleared" | "voided";
type CashPayoutStatus = "pending" | "approved" | "sent" | "failed" | "cancelled";
type EligibilityDecisionStatus = "eligible" | "ineligible" | "suspended";
type PrivacyRequestType = "access" | "correction" | "deletion";
type PrivacyRequestStatus = "queued" | "in_review" | "completed" | "denied" | "withdrawn";

function cashReviewStatus(value: unknown): CashReviewStatus {
  if (value === "queued" || value === "in_review" || value === "cleared" || value === "voided") return value;
  throw new ApiError(400, "invalid_review_status", "Use queued, in_review, cleared, or voided.");
}

function cashReviewTransitionAllowed(from: CashReviewStatus, to: CashReviewStatus): boolean {
  if (from === "queued") return to === "in_review" || to === "cleared" || to === "voided";
  if (from === "in_review") return to === "cleared" || to === "voided";
  return false;
}

function cashPayoutStatus(value: unknown): CashPayoutStatus {
  if (value === "pending" || value === "approved" || value === "sent" || value === "failed" || value === "cancelled") return value;
  throw new ApiError(400, "invalid_payout_status", "Use pending, approved, sent, failed, or cancelled.");
}

function payoutTransitionAllowed(
  from: CashPayoutStatus,
  to: CashPayoutStatus,
): boolean {
  if (from === "pending") {
    return to === "approved" || to === "failed" || to === "cancelled";
  }
  if (from === "approved") {
    return to === "sent" || to === "failed" || to === "cancelled";
  }
  return false;
}

function eligibilityDecisionStatus(value: unknown): EligibilityDecisionStatus {
  if (value === "eligible" || value === "ineligible" || value === "suspended") {
    return value;
  }
  throw new ApiError(400, "invalid_eligibility_status", "Use eligible, ineligible, or suspended.");
}

function privacyRequestType(value: unknown): PrivacyRequestType {
  if (value === "access" || value === "correction" || value === "deletion") return value;
  throw new ApiError(400, "invalid_privacy_request_type", "Use access, correction, or deletion.");
}

function privacyRequestStatus(value: unknown): PrivacyRequestStatus {
  if (
    value === "queued" || value === "in_review" || value === "completed"
    || value === "denied" || value === "withdrawn"
  ) {
    return value;
  }
  throw new ApiError(
    400,
    "invalid_privacy_request_status",
    "Use queued, in_review, completed, denied, or withdrawn.",
  );
}

function containsRestrictedPrivacyRequestData(value: string): boolean {
  // This database deliberately does not hold a player's direct-contact or
  // payout data. A false positive can move to restricted support, while a
  // leaked phone number or payment reference cannot be removed from an audit
  // trail safely.
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phoneOrPaymentNumber = /(?:\+?\d[\s().-]?){7,}/;
  return email.test(value) || phoneOrPaymentNumber.test(value);
}

function assertSafePrivacyRequestText(value: string): void {
  if (containsRestrictedPrivacyRequestData(value)) {
    throw new ApiError(
      400,
      "privacy_request_sensitive_data_not_allowed",
      "Do not include an email address, phone number, bank details, payment reference, or identity document in this request. Use the verified support channel if needed.",
    );
  }
}

async function createPrivacyRequest(request: Request, env: ApiEnv): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const payload = await readJsonObject(request, {
    maximumBytes: 8_000,
    requireApplicationJSON: true,
  });
  const requestType = privacyRequestType(payload.type);
  const statement = typeof payload.statement === "string" ? payload.statement.trim().slice(0, 1_200) : "";
  if (!statement) {
    throw new ApiError(
      400,
      "privacy_request_statement_required",
      "Describe the data request without including payment details or identity documents.",
    );
  }
  assertSafePrivacyRequestText(statement);
  const active = await db
    .prepare(
      `SELECT id FROM privacy_requests
       WHERE player_id = ?1 AND request_type = ?2
         AND status IN ('queued', 'in_review')
       LIMIT 1`,
    )
    .bind(player.id, requestType)
    .first<{ id: string }>();
  if (active) {
    throw new ApiError(409, "privacy_request_already_open", "A request of this type is already under review.");
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO privacy_requests (
        id, player_id, request_type, status, statement, operator_note,
        handled_by, handled_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'queued', ?4, NULL, NULL, NULL, ?5, ?5)`,
    )
    .bind(id, player.id, requestType, statement, now)
    .run();
  return json({ request: { id, type: requestType, status: "queued", created_at: now } }, 201);
}

async function listMyPrivacyRequests(request: Request, env: ApiEnv): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const result = await db
    .prepare(
      `SELECT id, request_type, status, statement, created_at, updated_at
       FROM privacy_requests WHERE player_id = ?1
       ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(player.id)
    .all();
  return json({ requests: result.results ?? [] });
}

async function listPrivacyRequests(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const status = new URL(request.url).searchParams.get("status")?.trim();
  const db = database(env);
  const result = await db
    .prepare(
      `SELECT r.id, r.player_id, p.public_handle, r.request_type, r.status,
              r.statement, r.operator_note, r.handled_by, r.handled_at,
              r.created_at, r.updated_at
       FROM privacy_requests r JOIN players p ON p.id = r.player_id
       ${status ? "WHERE r.status = ?1" : ""}
       ORDER BY r.created_at ASC LIMIT 500`,
    )
    .bind(...(status ? [privacyRequestStatus(status)] : []))
    .all();
  return json({ requests: result.results ?? [] });
}

async function updatePrivacyRequest(
  request: Request,
  env: ApiEnv,
  requestID: string,
): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, {
    maximumBytes: 16_000,
    requireApplicationJSON: true,
  });
  const status = privacyRequestStatus(payload.status);
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2_000) : "";
  if (!note) throw new ApiError(400, "privacy_request_note_required", "A review note is required.");
  assertSafePrivacyRequestText(note);
  const db = database(env);
  const row = await db
    .prepare(`SELECT id, player_id, request_type, status FROM privacy_requests WHERE id = ?1 LIMIT 1`)
    .bind(requestID)
    .first<{
      id: string;
      player_id: string;
      request_type: PrivacyRequestType;
      status: PrivacyRequestStatus;
    }>();
  if (!row) throw new ApiError(404, "privacy_request_not_found", "The privacy request could not be found.");
  if (row.status === "completed" || row.status === "denied" || row.status === "withdrawn") {
    throw new ApiError(409, "privacy_request_closed", "This privacy request is already closed.");
  }
  if (status === "completed" && row.request_type === "deletion") {
    const holds = await db
      .prepare(
        `SELECT 'active_attempt' AS hold_type
         FROM attempts WHERE player_id = ?1 AND status = 'started'
         UNION ALL
         SELECT 'open_score_challenge' AS hold_type
         FROM score_challenges
         WHERE player_id = ?1 AND status IN ('open', 'under_review')
         UNION ALL
         SELECT 'active_cash_review' AS hold_type
         FROM competition_reviews
         WHERE player_id = ?1 AND status IN ('queued', 'in_review')
         UNION ALL
         SELECT 'active_payout' AS hold_type
         FROM competition_payouts
         WHERE player_id = ?1 AND status IN ('pending', 'approved')
         LIMIT 20`,
      )
      .bind(row.player_id)
      .all<{ hold_type: string }>();
    const activeHolds = [...new Set((holds.results ?? []).map((hold) => hold.hold_type))];
    if (activeHolds.length > 0) {
      throw new ApiError(
        409,
        "privacy_deletion_hold_active",
        "Deletion cannot be marked complete while active game, dispute, review, or payout holds remain.",
        { holds: activeHolds },
      );
    }
  }
  const now = Date.now();
  await db
    .prepare(
      `UPDATE privacy_requests
       SET status = ?1, operator_note = ?2, handled_by = ?3,
           handled_at = ?4, updated_at = ?4
       WHERE id = ?5`,
    )
    .bind(status, note, authorization.publishedBy, now, row.id)
    .run();
  await recordAdminAudit(db, authorization, `privacy_request_${status}`, "privacy_request", row.id, note, { player_id: row.player_id, request_type: row.request_type, from: row.status, to: status });
  return json({ updated: true, request_id: row.id, status });
}

/**
 * Cash eligibility is an operational decision, not a side effect of SMS
 * verification. The reviewer records only an outcome and non-sensitive note;
 * identity, sanctions, and payout-account evidence remain in the restricted
 * manual process rather than this gameplay database.
 */
async function decidePlayerEligibility(
  request: Request,
  env: ApiEnv,
  playerID: string,
): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, {
    maximumBytes: 16_000,
    requireApplicationJSON: true,
  });
  const status = eligibilityDecisionStatus(payload.status);
  const rulesVersion = typeof payload.rules_version === "string"
    ? payload.rules_version.trim()
    : "";
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2_000) : "";
  if (!rulesVersion) {
    throw new ApiError(400, "rules_version_required", "The reviewed rules version is required.");
  }
  if (!note) {
    throw new ApiError(400, "eligibility_note_required", "An eligibility decision note is required.");
  }

  const db = database(env);
  const player = await db
    .prepare(
      `SELECT id, phone_verified_at, country_code, accepted_rules_version
       FROM players WHERE id = ?1 LIMIT 1`,
    )
    .bind(playerID)
    .first<{
      id: string;
      phone_verified_at: number | null;
      country_code: string | null;
      accepted_rules_version: string | null;
    }>();
  if (!player) throw new ApiError(404, "player_not_found", "The player could not be found.");
  if (!player.phone_verified_at || !player.country_code) {
    throw new ApiError(409, "phone_verification_required", "A verified phone and country attestation are required first.");
  }
  if (player.accepted_rules_version !== rulesVersion) {
    throw new ApiError(
      409,
      "rules_acceptance_required",
      "The player must accept this exact published rules version before review.",
    );
  }

  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE players
         SET eligibility_status = ?1, updated_at = ?2
         WHERE id = ?3`,
      )
      .bind(status, now, player.id),
    db
      .prepare(
        `INSERT INTO player_eligibility_reviews (
          id, player_id, status, rules_version, country_code, note, reviewer, reviewed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        crypto.randomUUID(),
        player.id,
        status,
        rulesVersion,
        player.country_code,
        note,
        authorization.publishedBy,
        now,
      ),
  ]);
  return json({
    updated: true,
    player_id: player.id,
    eligibility_status: status,
    rules_version: rulesVersion,
  });
}

async function listCashReviews(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const url = new URL(request.url);
  const competitionID = url.searchParams.get("competition_id")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const db = database(env);
  await reconcileCompetitionLifecycle(db);
  await reconcileClearedPayouts(env, db, authorization, competitionID);
  const where: string[] = [];
  const values: string[] = [];
  if (competitionID) { where.push("r.competition_id = ?"); values.push(competitionID); }
  if (status) { where.push("r.status = ?"); values.push(cashReviewStatus(status)); }
  const query = `SELECT r.id, r.attempt_id, r.competition_id, r.player_id, p.public_handle,
    r.status, r.risk_score, r.flags_json, r.note, r.reviewer, r.reviewed_at, r.created_at, r.updated_at
    FROM competition_reviews r JOIN players p ON p.id = r.player_id JOIN competitions c ON c.id = r.competition_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY r.created_at ASC LIMIT 500`;
  const result = await db.prepare(query).bind(...values).all();
  return json({ reviews: result.results ?? [] });
}

async function adminLeaderboard(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const competitionID = new URL(request.url).searchParams.get("competition_id")?.trim() ?? "";
  if (!competitionID) throw new ApiError(400, "competition_id_required", "A competition is required.");
  const db = database(env);
  await reconcileCompetitionLifecycle(db);
  const competition = await db.prepare("SELECT * FROM competitions WHERE id = ?1 LIMIT 1").bind(competitionID).first<CompetitionRow>();
  if (!competition) throw new ApiError(404, "competition_not_found", "The competition could not be found.");
  const integrityPredicate = competition.entry_mode === "guest" ? "a.integrity_status != 'failed'" : "a.integrity_status IN ('passed', 'review')";
  const result = await db.prepare(`SELECT a.id AS attempt_id, a.player_id, p.public_handle, a.correct_count, a.adjusted_total_ms, a.hard_card_ms, a.score_status, a.integrity_status FROM attempts a JOIN players p ON p.id = a.player_id WHERE a.competition_id = ?1 AND a.status = 'submitted' AND a.score_status IN ('provisional','confirmed') AND ${integrityPredicate} ORDER BY a.correct_count DESC, a.adjusted_total_ms ASC, a.hard_card_ms ASC, p.public_handle ASC LIMIT ?2`).bind(competitionID, MAX_LEADERBOARD_ROWS).all<any>();
  const ranked = rankLeaderboard((result.results ?? []).map((row) => ({ attemptId: row.attempt_id, publicHandle: row.public_handle, correctCount: row.correct_count, adjustedTotalMs: row.adjusted_total_ms, hardCardMs: row.hard_card_ms, scoreStatus: row.score_status })));
  const reviews = await db.prepare("SELECT attempt_id, status, risk_score, flags_json FROM competition_reviews WHERE competition_id = ?1").bind(competitionID).all<any>();
  const reviewByAttempt = new Map((reviews.results ?? []).map((row) => [row.attempt_id, row]));
  return json({ competition: { id: competition.id, title: competition.title, status: competition.status, opens_at: competition.opens_at, closes_at: competition.closes_at }, closed: competition.closes_at <= Date.now() || competition.status !== "open", leaderboard: ranked.map((entry) => { const source = (result.results ?? []).find((row: any) => row.attempt_id === entry.attemptId); const review = reviewByAttempt.get(entry.attemptId); return { ...entry, player_id: source?.player_id, integrity_status: source?.integrity_status, review_status: review?.status ?? null, risk_score: review?.risk_score ?? null, flags_json: review?.flags_json ?? "[]" }; }) });
}

async function prepareCompetitionReview(request: Request, env: ApiEnv, competitionID: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const db = database(env);
  const competition = await db.prepare("SELECT id, closes_at, status FROM competitions WHERE id = ?1 LIMIT 1").bind(competitionID).first<{id:string;closes_at:number;status:string}>();
  if (!competition) throw new ApiError(404, "competition_not_found", "The competition could not be found.");
  if (competition.closes_at > Date.now() && competition.status === "open") throw new ApiError(409, "competition_not_closed", "Top-three review preparation is available after the competition closes.");
  const finalists = await db.prepare(`SELECT a.id AS attempt_id, a.player_id, a.integrity_flags_json FROM attempts a
    WHERE a.competition_id = ?1 AND a.status = 'submitted' AND a.score_status IN ('provisional','confirmed') AND a.integrity_status != 'failed'
    ORDER BY a.correct_count DESC, a.adjusted_total_ms ASC, a.hard_card_ms ASC, a.id ASC LIMIT 3`).bind(competitionID).all<any>();
  const now = Date.now();
  const statements = (finalists.results ?? []).map((row) => db.prepare(`INSERT OR IGNORE INTO competition_reviews (id, attempt_id, competition_id, player_id, status, risk_score, flags_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'queued', 0, ?5, ?6, ?6)`).bind(crypto.randomUUID(), row.attempt_id, competitionID, row.player_id, row.integrity_flags_json || "[]", now));
  if (statements.length) await db.batch(statements);
  await recordAdminAudit(db, authorization, "competition_review_prepared", "competition", competitionID, "Top-three finalists prepared for owner review.", { finalist_count: statements.length });
  return json({ prepared: true, finalist_count: statements.length });
}

async function listSupportCases(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.trim() ?? "";
  const db = database(env);
  const result = await db.prepare(`SELECT s.*, p.public_handle
    FROM support_cases s LEFT JOIN players p ON p.id = s.player_id
    ${status ? "WHERE s.status = ?1" : ""}
    ORDER BY CASE s.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, s.updated_at DESC LIMIT ?${status ? "2" : "1"}`)
    .bind(...(status ? [status, 200] : [200])).all();
  return json({ cases: result.results ?? [] });
}

async function createSupportCase(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: 16_000, requireApplicationJSON: true });
  const category = String(payload.category ?? "general").trim().slice(0, 40);
  const priority = String(payload.priority ?? "normal").trim();
  const subject = String(payload.subject ?? "").trim().slice(0, 180);
  const message = String(payload.message ?? "").trim().slice(0, 4_000);
  if (!subject || !message) throw new ApiError(400, "support_case_content_required", "Subject and message are required.");
  if (!new Set(["low", "normal", "high", "urgent"]).has(priority)) throw new ApiError(400, "support_priority_invalid", "Unsupported support priority.");
  const id = crypto.randomUUID();
  const now = Date.now();
  const db = database(env);
  await db.prepare(`INSERT INTO support_cases
    (id, player_id, category, priority, status, subject, message, competition_id, review_id, payout_id, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?6, ?7, ?8, ?9, ?10, ?10)`)
    .bind(id, typeof payload.player_id === "string" ? payload.player_id.trim() || null : null, category, priority, subject, message,
      typeof payload.competition_id === "string" ? payload.competition_id.trim() || null : null,
      typeof payload.review_id === "string" ? payload.review_id.trim() || null : null,
      typeof payload.payout_id === "string" ? payload.payout_id.trim() || null : null, now).run();
  await recordAdminAudit(db, authorization, "support_case_created", "support_case", id, "Support case created.", { category, priority });
  return json({ created: true, case_id: id }, 201);
}

async function updateSupportCase(request: Request, env: ApiEnv, caseID: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: 16_000, requireApplicationJSON: true });
  const status = String(payload.status ?? "").trim();
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2_000) : "";
  if (!new Set(["open", "investigating", "waiting_for_player", "resolved", "closed", "rejected"]).has(status)) throw new ApiError(400, "support_status_invalid", "Unsupported support status.");
  if (!note) throw new ApiError(400, "support_note_required", "A case note is required.");
  const db = database(env);
  const existing = await db.prepare("SELECT id, status FROM support_cases WHERE id = ?1 LIMIT 1").bind(caseID).first<{ id: string; status: string }>();
  if (!existing) throw new ApiError(404, "support_case_not_found", "The support case was not found.");
  const now = Date.now();
  await db.prepare("UPDATE support_cases SET status = ?1, internal_note = ?2, assigned_to = ?3, updated_at = ?4, closed_at = CASE WHEN ?1 IN ('resolved','closed','rejected') THEN ?4 ELSE NULL END WHERE id = ?5")
    .bind(status, note, authorization.publishedBy, now, caseID).run();
  await recordAdminAudit(db, authorization, `support_case_${status}`, "support_case", caseID, note, { from: existing.status, to: status });
  return json({ updated: true, case_id: caseID, status });
}

async function listAdminPlayers(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 120);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 500);
  const db = database(env);
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const phoneHash = search ? await sha256Hex(search) : "";
  const result = await db.prepare(`SELECT p.id, p.public_handle, p.account_state, p.eligibility_status,
      p.phone_verified_at, p.created_at, p.updated_at,
      COUNT(DISTINCT a.id) AS attempt_count,
      MAX(a.updated_at) AS last_attempt_at
    FROM players p LEFT JOIN attempts a ON a.player_id = p.id
    ${search ? "WHERE (p.public_handle LIKE ?1 ESCAPE '\\' OR p.id LIKE ?1 ESCAPE '\\' OR p.phone_lookup_hash = ?2)" : ""}
    GROUP BY p.id ORDER BY p.updated_at DESC LIMIT ?${search ? "2" : "1"}`)
    .bind(...(search ? [pattern, phoneHash, limit] : [limit])).all();
  return json({ players: result.results ?? [] });
}

async function listAdminCompetitions(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const db = database(env);
  await reconcileCompetitionLifecycle(db);
  const result = await db.prepare(`SELECT c.id, c.slug, c.title, c.status, c.content_status,
      c.opens_at AS start_at, c.closes_at AS end_at, c.question_count, c.pack_version, c.currency, c.created_at,
      (SELECT amount_minor FROM competition_prizes p WHERE p.competition_id = c.id AND p.place = 1) AS prize_1_minor,
      (SELECT amount_minor FROM competition_prizes p WHERE p.competition_id = c.id AND p.place = 2) AS prize_2_minor,
      (SELECT amount_minor FROM competition_prizes p WHERE p.competition_id = c.id AND p.place = 3) AS prize_3_minor,
      COUNT(DISTINCT a.id) AS attempt_count,
      COUNT(DISTINCT r.id) AS review_count
    FROM competitions c
    LEFT JOIN attempts a ON a.competition_id = c.id
    LEFT JOIN competition_reviews r ON r.competition_id = c.id
    GROUP BY c.id ORDER BY COALESCE(c.opens_at, c.created_at) DESC LIMIT 100`).all();
  return json({ competitions: result.results ?? [] });
}

async function createAdminCompetition(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: 16_000, requireApplicationJSON: true });
  const reason = adminReason(payload);
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const slug = typeof payload.slug === "string" ? payload.slug.trim().toLowerCase() : "";
  if (!title || title.length > 140) throw new ApiError(400, "competition_title_invalid", "Title must be between 1 and 140 characters.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) throw new ApiError(400, "competition_slug_invalid", "Slug must use lowercase letters, numbers, and hyphens.");
  const startAt = Date.parse(String(payload.start_at ?? ""));
  const endAt = Date.parse(String(payload.end_at ?? ""));
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) throw new ApiError(400, "competition_window_invalid", "A valid opening and closing time are required.");
  const questionCount = Number(payload.question_count ?? 12);
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 100) throw new ApiError(400, "question_count_invalid", "Question count must be an integer from 1 to 100.");
  const id = crypto.randomUUID();
  const now = Date.now();
  const db = database(env);
  try {
    await db.prepare(`INSERT INTO competitions
      (id, slug, title, status, content_status, rules_version, pack_version, scoring_version,
       question_count, per_card_limit_ms, upload_grace_ms, entry_mode, eligible_countries_json,
       country_code, minimum_age, currency, opens_at, closes_at, score_review_closes_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, 'draft', 'draft', ?4, ?5, 'accuracy-time-v1', ?6, 12000, 15000,
        'phone_verified', '["NG"]', 'NG', 18, 'NGN', ?7, ?8, ?8, ?9, ?9)`)
      .bind(id, slug, title, `rules-${now}`, `pack-${now}`, questionCount, startAt, endAt, now)
      .run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new ApiError(409, "competition_slug_exists", "A competition with this slug already exists.");
    throw error;
  }
  await recordAdminAudit(db, authorization, "competition_created", "competition", id, reason, { title, slug, status: "draft", start_at: startAt, end_at: endAt, question_count: questionCount });
  return json({ created: true, competition: { id, slug, title, status: "draft", start_at: startAt, end_at: endAt, question_count: questionCount } }, 201);
}

async function updateAdminCompetition(request: Request, env: ApiEnv, competitionID: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: 16_000, requireApplicationJSON: true });
  const reason = adminReason(payload);
  const db = database(env);
  const current = await db.prepare(`SELECT id, title, status, content_status, opens_at AS start_at, closes_at AS end_at, question_count, currency, pack_version FROM competitions WHERE id = ?1 LIMIT 1`).bind(competitionID).first<{ id: string; title: string; status: string; content_status: string; start_at: number | null; end_at: number | null; question_count: number; currency: string; pack_version: string }>();
  if (!current) throw new ApiError(404, "competition_not_found", "The competition was not found.");
  const title = payload.title === undefined ? current.title : String(payload.title).trim();
  if (!title || title.length > 140) throw new ApiError(400, "competition_title_invalid", "Title must be between 1 and 140 characters.");
  const statusValues = new Set(["draft", "scheduled", "open", "locked", "final", "cancelled"]);
  const requestedStatus = payload.status === undefined ? current.status : String(payload.status);
  if (!statusValues.has(requestedStatus)) throw new ApiError(400, "competition_status_invalid", "Unsupported competition status.");
  const questionCount = payload.question_count === undefined ? current.question_count : Number(payload.question_count);
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 100) throw new ApiError(400, "question_count_invalid", "Question count must be an integer from 1 to 100.");
  const parseTime = (value: unknown, fallback: number | null, field: string) => {
    if (value === undefined || value === null || value === "") return fallback;
    const parsed = typeof value === "number" ? value : Date.parse(String(value));
    if (!Number.isFinite(parsed) || parsed < 0) throw new ApiError(400, `${field}_invalid`, `${field} must be a valid date/time.`);
    return Math.trunc(parsed);
  };
  const startAt = parseTime(payload.start_at, current.start_at, "start_at");
  const endAt = parseTime(payload.end_at, current.end_at, "end_at");
  if (startAt !== null && endAt !== null && endAt <= startAt) throw new ApiError(400, "competition_window_invalid", "End time must be after start time.");
  // A future time window must remain scheduler-controlled. Previously an
  // operator could edit a live/open row to a future time while leaving its
  // status as `open`; reconciliation never auto-opened that row because it
  // only promotes `scheduled` rows, so the edited schedule appeared to
  // revert or disappear from the player flow. Persist the edited schedule as
  // scheduled until its actual start time.
  const status = requestedStatus === "open" && startAt !== null && startAt > Date.now()
    ? "scheduled"
    : requestedStatus;
  let replacedScheduledID: string | null = null;
  if ((status === "open" || status === "scheduled") && startAt !== null && endAt !== null) {
    const overlap = await db.prepare(`SELECT id, title, status, opens_at AS start_at, closes_at AS end_at
      FROM competitions
      WHERE id != ?1 AND status IN ('open', 'scheduled')
        AND opens_at IS NOT NULL AND closes_at IS NOT NULL
        AND opens_at < ?3 AND closes_at > ?2
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, opens_at ASC
      LIMIT 1`).bind(competitionID, startAt, endAt).first<{ id: string; title: string; status: string; start_at: number; end_at: number }>();
    if (overlap) {
      const replace = payload.replace_existing === true;
      if (replace && overlap.status === "scheduled") {
        replacedScheduledID = overlap.id;
      } else {
        throw new ApiError(409, "competition_overlap", `This time overlaps “${overlap.title}” (${overlap.status}). Choose a different time or explicitly replace the scheduled round.`, { conflict: overlap, can_replace: overlap.status === "scheduled" });
      }
    }
  }
  if (status === "open" || status === "scheduled") {
    const league = (await publishedAppConfig(env)).events.odogwu_league;
    if (!league.enabled || league.home_placement !== "banner") {
      throw new ApiError(409, "odogwu_banner_required", "Odogwu League cannot open until its player-facing banner is enabled and placed as a banner.", { required: "events.odogwu_league.enabled=true", home_placement: "banner" });
    }
    const bannerEndsAt = league.banner_ends_at ? Date.parse(league.banner_ends_at) : null;
    if (bannerEndsAt !== null && Number.isFinite(bannerEndsAt) && startAt !== null && startAt >= bannerEndsAt) {
      throw new ApiError(409, "odogwu_banner_scheduled_off", "This session cannot open because the Odogwu banner is scheduled to hide before the session starts. Clear or move the banner hide time first.", { banner_ends_at: league.banner_ends_at, session_start_at: startAt });
    }
    if (current.content_status !== "published") {
      throw new ApiError(409, "competition_content_unpublished", "Publish and verify the question pack before opening or scheduling this competition.");
    }
    const cardCount = await db.prepare("SELECT COUNT(*) AS count FROM competition_cards WHERE competition_id = ?1").bind(competitionID).first<{ count: number }>();
    if (Number(cardCount?.count ?? 0) < questionCount) {
      throw new ApiError(409, "competition_cards_incomplete", `This competition has ${Number(cardCount?.count ?? 0)} of ${questionCount} required question cards. It cannot be opened or scheduled yet.`);
    }
  }
  const currency = payload.currency === undefined ? current.currency : String(payload.currency).toUpperCase();
  if (currency !== "NGN") throw new ApiError(400, "competition_currency_invalid", "Cash competitions must use NGN.");
  const packVersion = payload.pack_version === undefined ? current.pack_version : String(payload.pack_version).trim();
  if (!packVersion || packVersion.length > 160) throw new ApiError(400, "pack_version_invalid", "Pack version must be a non-empty value up to 160 characters.");
  const attempts = await db.prepare("SELECT COUNT(*) AS count FROM attempts WHERE competition_id = ?1").bind(competitionID).first<{ count: number }>();
  if (packVersion !== current.pack_version && Number(attempts?.count ?? 0) > 0) {
    throw new ApiError(409, "pack_locked", "The question pack is locked after the first attempt.");
  }
  const prizeValues = [1, 2, 3].map((place) => payload[`prize_${place}_minor`]);
  const hasPrizeChange = prizeValues.some((value) => value !== undefined);
  let prizes: number[] | null = null;
  if (hasPrizeChange) {
    if (Number(attempts?.count ?? 0) > 0) throw new ApiError(409, "prizes_locked", "Prize amounts are locked after the first attempt.");
    prizes = prizeValues.map((value, index) => {
      const amount = Number(value);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new ApiError(400, "prize_invalid", `Prize for place ${index + 1} must be a positive integer in minor currency units.`);
      return amount;
    });
  }
  const now = Date.now();
  const statements = [
    ...(replacedScheduledID ? [db.prepare("UPDATE competitions SET status = 'cancelled', updated_at = ?1 WHERE id = ?2").bind(now, replacedScheduledID)] : []),
    db.prepare(`UPDATE competitions SET title = ?1, status = ?2, opens_at = ?3, closes_at = ?4, question_count = ?5, currency = ?6, pack_version = ?7, updated_at = ?8 WHERE id = ?9`).bind(title, status, startAt, endAt, questionCount, currency, packVersion, now, competitionID),
  ];
  if (prizes) {
    statements.push(db.prepare("DELETE FROM competition_prizes WHERE competition_id = ?1").bind(competitionID));
    prizes.forEach((amount, index) => statements.push(db.prepare("INSERT INTO competition_prizes (competition_id, place, amount_minor) VALUES (?1, ?2, ?3)").bind(competitionID, index + 1, amount)));
  }
  await db.batch(statements);
  if (replacedScheduledID) await recordAdminAudit(db, authorization, "competition_replaced", "competition", replacedScheduledID, reason, { replacement_competition_id: competitionID, replacement_title: title });
  await recordAdminAudit(db, authorization, "competition_updated", "competition", competitionID, reason, { before: current, after: { title, status, requested_status: requestedStatus, start_at: startAt, end_at: endAt, question_count: questionCount, currency, pack_version: packVersion, prizes_minor: prizes } });
  return json({ updated: true, competition: { id: competitionID, title, status, start_at: startAt, end_at: endAt, question_count: questionCount, currency, pack_version: packVersion } });
}

async function deleteAdminCompetition(request: Request, env: ApiEnv, competitionID: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: 8_000, requireApplicationJSON: true });
  const reason = adminReason(payload);
  const db = database(env);
  const row = await db.prepare(`SELECT id, title, status,
      (SELECT COUNT(*) FROM attempts WHERE competition_id = competitions.id) AS attempts,
      (SELECT COUNT(*) FROM competition_reviews WHERE competition_id = competitions.id) AS reviews,
      (SELECT COUNT(*) FROM competition_payouts WHERE competition_id = competitions.id) AS payouts
    FROM competitions WHERE id = ?1 LIMIT 1`).bind(competitionID).first<{ id: string; title: string; status: string; attempts: number; reviews: number; payouts: number }>();
  if (!row) throw new ApiError(404, "competition_not_found", "The competition was not found.");
  if (Number(row.attempts) || Number(row.reviews) || Number(row.payouts)) {
    throw new ApiError(409, "competition_delete_forbidden", "This competition has participant, review, or payout history and can only be archived.");
  }
  await db.batch([
    db.prepare("DELETE FROM competition_eligibility_policy_audit WHERE competition_id = ?1").bind(competitionID),
    db.prepare("DELETE FROM rehearsal_payout_previews WHERE competition_id = ?1").bind(competitionID),
    db.prepare("DELETE FROM competition_prizes WHERE competition_id = ?1").bind(competitionID),
    db.prepare("DELETE FROM competitions WHERE id = ?1").bind(competitionID),
  ]);
  await recordAdminAudit(db, authorization, "competition_deleted", "competition", competitionID, reason, { title: row.title, status: row.status });
  return json({ deleted: true, competition_id: competitionID });
}

async function listAdminSettings(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const db = database(env);
  const result = await db.prepare(`SELECT id, role_key, label, permissions_json, enabled, created_at, updated_at FROM admin_roles ORDER BY role_key ASC`).all();
  return json({ owner: authorization.publishedBy, current_access: authorization.method, roles: result.results ?? [] });
}

async function updateAdminRole(request: Request, env: ApiEnv, roleID: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: 4_000, requireApplicationJSON: true });
  const reason = adminReason(payload);
  const enabled = typeof payload.enabled === "boolean" ? payload.enabled : null;
  const permissions = payload.permissions === undefined
    ? null
    : Array.isArray(payload.permissions) && payload.permissions.every((item) => typeof item === "string" && /^[a-z0-9_*.-]{1,80}$/i.test(item))
      ? [...new Set(payload.permissions as string[])]
      : undefined;
  if (enabled === null && permissions === null) throw new ApiError(400, "role_update_required", "Provide an enabled state or permissions for this role.");
  if (permissions === undefined || (permissions && permissions.length > 50)) throw new ApiError(400, "role_permissions_invalid", "Permissions must be up to 50 bounded permission keys.");
  const db = database(env);
  const role = await db.prepare("SELECT id, role_key, label, enabled FROM admin_roles WHERE id = ?1 LIMIT 1").bind(roleID).first<{ id: string; role_key: string; label: string; enabled: number }>();
  if (!role) throw new ApiError(404, "role_not_found", "The admin role was not found.");
  if (role.role_key === "owner" && !enabled) throw new ApiError(409, "owner_role_cannot_disable", "The owner role cannot be disabled.");
  if (role.role_key === "owner" && permissions && !permissions.includes("*")) throw new ApiError(409, "owner_permissions_cannot_reduce", "The owner role must retain the wildcard permission.");
  const nextEnabled = enabled === null ? role.enabled : enabled ? 1 : 0;
  const currentPermissions = permissions === null ? null : JSON.stringify(permissions);
  await db.prepare(`UPDATE admin_roles SET enabled = ?1, permissions_json = COALESCE(?2, permissions_json), updated_at = ?3 WHERE id = ?4`).bind(nextEnabled, currentPermissions, Date.now(), roleID).run();
  await recordAdminAudit(db, authorization, "admin_role_updated", "admin_role", roleID, reason, { role_key: role.role_key, enabled: Boolean(nextEnabled), permissions });
  return json({ updated: true, role: { ...role, enabled: nextEnabled, ...(permissions === null ? {} : { permissions_json: currentPermissions }) } });
}

async function getAdminHealth(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const checks: Record<string, { status: "operational" | "degraded" | "unconfigured"; detail: string }> = {};
  let databaseOK = false;
  try {
    await database(env).prepare("SELECT 1 AS ok").first();
    databaseOK = true;
  } catch {
    databaseOK = false;
  }
  checks.database = databaseOK
    ? { status: "operational", detail: "D1 responded to a health query." }
    : { status: "degraded", detail: "D1 health query failed." };
  checks.apple_admin = env.WBD_APPLE_CLIENT_ID && env.WBD_APPLE_PRIVATE_KEY && env.WBD_APPLE_TEAM_ID && env.WBD_APPLE_KEY_ID
    ? { status: "operational", detail: "Apple owner authentication is configured." }
    : { status: "unconfigured", detail: "Apple owner authentication secrets are incomplete." };
  checks.payout_vault = env.WBD_PAYOUT_DATA_ENCRYPTION_SECRET
    ? { status: "operational", detail: "Payout details encryption is configured." }
    : { status: "unconfigured", detail: "Payout details encryption is not configured." };
  const apnsReady = Boolean(env.WBD_APNS_HOST?.trim() && env.WBD_APNS_BUNDLE_ID?.trim() && env.WBD_APNS_KEY_ID?.trim() && env.WBD_APNS_TEAM_ID?.trim() && env.WBD_APNS_PRIVATE_KEY?.trim() && env.WBD_PUSH_TOKEN_ENCRYPTION_SECRET?.trim());
  let fcmReady = false;
  try { fcmConfiguration(env); fcmReady = Boolean(env.WBD_PUSH_TOKEN_ENCRYPTION_SECRET?.trim()); } catch { /* Configuration only; do not expose credentials. */ }
  checks.notifications_ios = apnsReady
    ? { status: "operational", detail: "Apple push and encrypted device-token storage are configured." }
    : { status: "unconfigured", detail: "Apple push configuration is incomplete." };
  checks.notifications_android = fcmReady
    ? { status: "operational", detail: "Android push and encrypted device-token storage are configured." }
    : { status: "unconfigured", detail: "Android push configuration is incomplete." };
  checks.notifications = apnsReady && fcmReady
    ? { status: "operational", detail: "Apple and Android push senders are configured. Actual delivery still depends on registered devices." }
    : { status: "degraded", detail: "Push delivery is not fully configured for both platforms; payout status remains available in-app." };
  return json({ generated_at: new Date().toISOString(), checks });
}

async function getAdminAnalytics(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const db = database(env);
  await reconcileCompetitionLifecycle(db);
  const count = async (query: string) => Number((await db.prepare(query).first<{ value: number }>())?.value ?? 0);
  const [players, attempts, submitted, confirmed, reviews, flagged, payouts, paid] = await Promise.all([
    count("SELECT COUNT(*) AS value FROM players"),
    count("SELECT COUNT(*) AS value FROM attempts"),
    count("SELECT COUNT(*) AS value FROM attempts WHERE status = 'submitted'"),
    count("SELECT COUNT(*) AS value FROM attempts WHERE score_status = 'confirmed'"),
    count("SELECT COUNT(*) AS value FROM competition_reviews"),
    count("SELECT COUNT(*) AS value FROM competition_reviews WHERE risk_score > 0 OR flags_json <> '[]'"),
    count("SELECT COUNT(*) AS value FROM competition_payouts"),
    count("SELECT COUNT(*) AS value FROM competition_payouts WHERE status = 'sent'"),
  ]);
  const competitions = await db.prepare(`SELECT c.id, c.title, c.status, COUNT(DISTINCT a.id) AS attempts, COUNT(DISTINCT r.id) AS reviews, COUNT(DISTINCT p.id) AS payouts
    FROM competitions c LEFT JOIN attempts a ON a.competition_id = c.id LEFT JOIN competition_reviews r ON r.competition_id = c.id LEFT JOIN competition_payouts p ON p.competition_id = c.id
    GROUP BY c.id ORDER BY COALESCE(c.opens_at, c.created_at) DESC LIMIT 25`).all();
  return json({ generated_at: new Date().toISOString(), totals: { players, attempts, submitted_attempts: submitted, confirmed_attempts: confirmed, reviews, flagged, payouts, paid_payouts: paid }, competitions: competitions.results ?? [] });
}

async function updateCashReview(request: Request, env: ApiEnv, reviewID: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: 32_000, requireApplicationJSON: true });
  const status = cashReviewStatus(payload.status);
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2_000) : "";
  if (!note) throw new ApiError(400, "review_note_required", "A review decision note is required.");
  const db = database(env);
  const row = await db.prepare(`SELECT id, attempt_id, status FROM competition_reviews WHERE id = ?1 LIMIT 1`).bind(reviewID).first<{ id: string; attempt_id: string; status: CashReviewStatus }>();
  if (!row) throw new ApiError(404, "review_not_found", "The cash review was not found.");
  if (!cashReviewTransitionAllowed(row.status, status)) {
    throw new ApiError(
      409,
      "invalid_cash_review_transition",
      "A cash review may move from queued to review, cleared, or voided, then its decision is final.",
    );
  }
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE competition_reviews SET status = ?1, note = ?2, reviewer = ?3, reviewed_at = ?4, updated_at = ?4 WHERE id = ?5`).bind(status, note, authorization.publishedBy, now, reviewID),
    db.prepare(`UPDATE attempts SET integrity_status = ?1, score_status = CASE WHEN ?4 = 'cleared' THEN 'confirmed' WHEN ?4 = 'voided' THEN 'voided' ELSE score_status END, status = CASE WHEN ?4 = 'voided' THEN 'voided' ELSE status END, updated_at = ?2 WHERE id = ?3`).bind(status === "cleared" ? "passed" : status === "voided" ? "failed" : "review", now, row.attempt_id, status),
  ]);
  if (status === "cleared") {
    await materializeClearedTopThreePayouts(env, db, row.attempt_id, authorization);
  }
  await recordAdminAudit(db, authorization, `review_${status}`, "competition_review", reviewID, note, { attempt_id: row.attempt_id, from: row.status, to: status });
  return json({ updated: true, review_id: reviewID, status });
}

async function materializeClearedTopThreePayouts(env: ApiEnv, db: D1Database, attemptID: string, authorization: ContentAdminAuthorization) {
  const source = await db.prepare("SELECT competition_id FROM attempts WHERE id = ?1 LIMIT 1").bind(attemptID).first<{ competition_id: string }>();
  if (!source) return;
  const rows = await db.prepare(`SELECT a.id AS attempt_id, a.player_id, a.correct_count, a.adjusted_total_ms, a.hard_card_ms, a.score_status, r.status AS review_status
    FROM attempts a LEFT JOIN competition_reviews r ON r.attempt_id = a.id
    WHERE a.competition_id = ?1 AND a.status != 'voided' AND a.score_status IN ('provisional','confirmed')
    ORDER BY a.correct_count DESC, a.adjusted_total_ms ASC, a.hard_card_ms ASC, a.id ASC LIMIT 3`).bind(source.competition_id).all<any>();
  if ((rows.results ?? []).length === 0 || (rows.results ?? []).some((row) => row.review_status !== "cleared" || row.score_status !== "confirmed")) return;
  const prizes = await db.prepare("SELECT place, amount_minor FROM competition_prizes WHERE competition_id = ?1 ORDER BY place ASC LIMIT 3").bind(source.competition_id).all<{place:number;amount_minor:number}>();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  const newPlayerIDs: string[] = [];
  for (let index = 0; index < (rows.results ?? []).length; index += 1) {
    const row = rows.results![index];
    const prize = (prizes.results ?? []).find((item) => item.place === index + 1);
    if (!prize) continue;
    const existing = await db.prepare("SELECT id FROM competition_payouts WHERE competition_id = ?1 AND attempt_id = ?2 LIMIT 1").bind(source.competition_id, row.attempt_id).first<{ id: string }>();
    if (existing) continue;
    newPlayerIDs.push(row.player_id);
    const id = crypto.randomUUID();
    statements.push(db.prepare(`INSERT OR IGNORE INTO competition_payouts (id, competition_id, attempt_id, player_id, place, amount_minor, currency, status, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'NGN', 'pending', 'system:review-clearance', ?7, ?7)`).bind(id, source.competition_id, row.attempt_id, row.player_id, index + 1, prize.amount_minor, now));
    statements.push(db.prepare(`INSERT OR IGNORE INTO competition_payout_audit (id, payout_id, action, actor, note, details_json, changed_at) SELECT ?1, id, 'created', 'system:review-clearance', 'Payout intent created automatically after top-three review clearance.', ?2, ?3 FROM competition_payouts WHERE competition_id = ?4 AND attempt_id = ?5`).bind(crypto.randomUUID(), JSON.stringify({ automatic: true, review_attempt_id: attemptID }), now, source.competition_id, row.attempt_id));
  }
  if (statements.length) {
    await db.batch(statements);
    await recordAdminAudit(db, authorization, "top_three_payouts_materialized", "competition", source.competition_id, "Top-three payout intents created automatically after review clearance.", { attempt_id: attemptID, count: Math.floor(statements.length / 2) });
    for (const playerID of newPlayerIDs) {
      try {
        await notifyPayoutDetailsRequired(env, db, playerID, "payout_details_required");
      } catch {
        // The in-app payout request remains authoritative if APNs is unavailable.
      }
    }
  }
}

async function reconcileClearedPayouts(env: ApiEnv, db: D1Database, authorization: ContentAdminAuthorization, competitionID?: string) {
  await db.prepare(`UPDATE attempts SET score_status = 'confirmed', integrity_status = 'passed'
    WHERE status = 'submitted' AND score_status = 'provisional'
      AND EXISTS (SELECT 1 FROM competition_reviews r WHERE r.attempt_id = attempts.id AND r.status = 'cleared')`).run();
  const competitions = await db.prepare(`
    SELECT DISTINCT r.competition_id
    FROM competition_reviews r
    WHERE r.status = 'cleared' ${competitionID ? "AND r.competition_id = ?1" : ""}
  `).bind(...(competitionID ? [competitionID] : [])).all<{ competition_id: string }>();
  for (const competition of competitions.results ?? []) {
    const top = await db.prepare(`
      SELECT a.id AS attempt_id
      FROM attempts a
      WHERE a.competition_id = ?1
        AND a.status != 'voided'
        AND a.score_status IN ('provisional', 'confirmed')
      ORDER BY a.correct_count DESC, a.adjusted_total_ms ASC, a.hard_card_ms ASC, a.id ASC
      LIMIT 1
    `).bind(competition.competition_id).first<{ attempt_id: string }>();
    if (top) await materializeClearedTopThreePayouts(env, db, top.attempt_id, authorization);
  }
}

async function listCashPayouts(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const competitionID = new URL(request.url).searchParams.get("competition_id")?.trim() ?? "";
  const db = database(env);
  await reconcileCompetitionLifecycle(db);
  await reconcileClearedPayouts(env, db, authorization, competitionID);
  const result = await db.prepare(`SELECT p.*, pl.public_handle, c.title AS competition_title
    FROM competition_payouts p JOIN players pl ON pl.id = p.player_id JOIN competitions c ON c.id = p.competition_id
    ${competitionID ? "WHERE p.competition_id = ?1" : ""}
    ORDER BY p.place ASC, p.created_at ASC LIMIT 500`)
    .bind(...(competitionID ? [competitionID] : []))
    .all<Record<string, unknown> & { id: string }>();
  const payouts = result.results ?? [];
  if (payouts.length === 0) return json({ payouts: [] });

  const placeholders = payouts.map(() => "?").join(", ");
  const auditResult = await db
    .prepare(
      `SELECT id, payout_id, action, actor, note, details_json, changed_at
       FROM competition_payout_audit
       WHERE payout_id IN (${placeholders})
       ORDER BY changed_at ASC, id ASC`,
    )
    .bind(...payouts.map((payout) => payout.id))
    .all<{
      id: string;
      payout_id: string;
      action: string;
      actor: string;
      note: string;
      details_json: string;
      changed_at: number;
    }>();
  const auditByPayout = new Map<string, Array<{
    id: string;
    action: string;
    actor: string;
    note: string;
    details_json: string;
    changed_at: number;
  }>>();
  for (const row of auditResult.results ?? []) {
    const current = auditByPayout.get(row.payout_id) ?? [];
    current.push({
      id: row.id,
      action: row.action,
      actor: row.actor,
      note: row.note,
      details_json: row.details_json,
      changed_at: row.changed_at,
    });
    auditByPayout.set(row.payout_id, current);
  }
  return json({
    payouts: payouts.map((payout) => ({
      ...payout,
      audit: auditByPayout.get(payout.id) ?? [],
    })),
  });
}

function payoutText(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string") throw new ApiError(400, "payout_details_invalid", `${field} is required.`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximumLength) {
    throw new ApiError(400, "payout_details_invalid", `${field} is invalid.`);
  }
  return normalized;
}

async function submitPlayerPayoutDetails(request: Request, env: ApiEnv): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const payload = await readJsonObject(request, { maximumBytes: 8_000, requireApplicationJSON: true });
  const competitionID = payoutText(payload.competition_id, "competition_id", 160);
  const legalName = payoutText(payload.legal_name, "legal_name", 120);
  const bankName = payoutText(payload.bank_name, "bank_name", 120);
  const accountNumber = payoutText(payload.account_number, "account_number", 64).replace(/\s/g, "");
  const countryCode = "NG";
  if (!/^[0-9]{6,34}$/.test(accountNumber)) {
    throw new ApiError(400, "payout_details_invalid", "Use a valid Nigerian bank account number.");
  }
  const payout = await db.prepare(
    `SELECT id FROM competition_payouts
     WHERE competition_id = ?1 AND player_id = ?2 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(competitionID, player.id).first<{ id: string }>();
  if (!payout) {
    throw new ApiError(409, "payout_details_not_requested", "Payout details are not currently requested for this account.");
  }
  let detailsCiphertext: string;
  try {
    detailsCiphertext = await encryptConfidentialPayload(
      JSON.stringify({ legal_name: legalName, bank_name: bankName, account_number: accountNumber, country_code: countryCode, currency: "NGN" }),
      env.WBD_PAYOUT_DATA_ENCRYPTION_SECRET,
    );
  } catch {
    throw new ApiError(503, "payout_details_unavailable", "Secure payout details are not configured yet.");
  }
  const now = Date.now();
  await db.prepare(
    `INSERT INTO competition_payout_details (
       id, payout_id, player_id, competition_id, details_ciphertext, status,
       submitted_at, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, 'submitted', ?6, ?6, ?6)
     ON CONFLICT(payout_id) DO UPDATE SET
       details_ciphertext = excluded.details_ciphertext,
       status = 'submitted', submitted_at = excluded.submitted_at,
       reviewed_by = NULL, reviewed_at = NULL, updated_at = excluded.updated_at`,
  ).bind(crypto.randomUUID(), payout.id, player.id, competitionID, detailsCiphertext, now).run();
  try { await notifyPayoutDetailsRequired(env, db, player.id, "payout_submitted"); } catch { /* in-app status remains authoritative */ }
  return json({ payout_details: { status: "submitted", message: "Your payout details were received and are being reviewed manually." } });
}

async function getPlayerPayoutDetailsStatus(request: Request, env: ApiEnv): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const competitionID = new URL(request.url).searchParams.get("competition_id")?.trim() ?? "";
  if (!competitionID) throw new ApiError(400, "competition_id_required", "A competition ID is required.");
  const row = await db.prepare(
    `SELECT p.status AS payout_status, p.place, p.amount_minor, p.currency,
            d.status AS details_status, d.submitted_at, p.updated_at
       FROM competition_payouts p
       LEFT JOIN competition_payout_details d ON d.payout_id = p.id
      WHERE p.competition_id = ?1 AND p.player_id = ?2
      ORDER BY p.created_at DESC LIMIT 1`,
  ).bind(competitionID, player.id).first<{
    payout_status: CashPayoutStatus;
    place: number;
    amount_minor: number;
    currency: string;
    details_status: "submitted" | "verified" | "rejected" | null;
    submitted_at: number | null;
    updated_at: number;
  }>();
  if (!row) return json({ payout_details: { status: "not_requested", timeline: ["awaiting_final_results"] } });
  const status = row.details_status === "rejected"
    ? "rejected"
    : row.payout_status === "pending" && row.details_status === "submitted"
      ? "under_review"
      : row.payout_status;
  const timeline = ["winner_confirmed", ...(row.details_status ? ["form_submitted"] : [])];
  if (status === "under_review") timeline.push("under_review");
  if (status === "approved") timeline.push("under_review", "approved");
  if (status === "sent") timeline.push("under_review", "approved", "paid");
  if (status === "failed") timeline.push("under_review", "failed");
  if (status === "cancelled") timeline.push("under_review", "cancelled");
  return json({ payout_details: {
    status, place: row.place, amount_minor: row.amount_minor, currency: row.currency,
    submitted_at: row.submitted_at, updated_at: row.updated_at, timeline,
  } });
}

/**
 * The internal rehearsal needs to exercise the winner handoff without ever
 * collecting a bank account or opening a payable record. The only identifier
 * retained is the final four digits of a deliberately dummy account number.
 */
async function submitRehearsalPayoutPreview(request: Request, env: ApiEnv): Promise<Response> {
  const db = database(env);
  const player = await authenticate(request, db);
  const payload = await readJsonObject(request, { maximumBytes: 8_000, requireApplicationJSON: true });
  const competitionID = payoutText(payload.competition_id, "competition_id", 160);
  const displayName = payoutText(payload.legal_name, "test name", 120);
  const bankLabel = payoutText(payload.bank_name, "test bank name", 120);
  const accountNumber = payoutText(payload.account_number, "dummy account number", 64).replace(/\s/g, "");
  if (!/^[0-9]{6,34}$/.test(accountNumber)) {
    throw new ApiError(400, "rehearsal_payout_preview_invalid", "Use a 6–34 digit dummy Nigerian account number.");
  }

  const competition = await db.prepare(
    `SELECT * FROM competitions WHERE id = ?1 LIMIT 1`,
  ).bind(competitionID).first<CompetitionRow>();
  if (!competition || !isServerRehearsal(competition)) {
    throw new ApiError(404, "rehearsal_payout_preview_unavailable", "The test payout form is available only for the current internal League rehearsal.");
  }

  const rankedResult = await db.prepare(
    `SELECT a.id AS attempt_id, a.player_id, p.public_handle,
            a.correct_count, a.adjusted_total_ms, a.hard_card_ms, a.score_status
       FROM attempts a
       JOIN players p ON p.id = a.player_id
      WHERE a.competition_id = ?1
        AND a.status = 'submitted'
        AND a.score_status IN ('provisional', 'confirmed')
        AND a.integrity_status != 'failed'
      ORDER BY a.correct_count DESC, a.adjusted_total_ms ASC, a.hard_card_ms ASC, p.public_handle ASC
      LIMIT ?2`,
  ).bind(competitionID, MAX_LEADERBOARD_ROWS).all<{
    attempt_id: string;
    player_id: string;
    public_handle: string;
    correct_count: number;
    adjusted_total_ms: number;
    hard_card_ms: number;
    score_status: "provisional" | "confirmed";
  }>();
  const rows = rankedResult.results ?? [];
  const ranked = rankLeaderboard(rows.map((row) => ({
    attemptId: row.attempt_id,
    publicHandle: row.public_handle,
    correctCount: row.correct_count,
    adjustedTotalMs: row.adjusted_total_ms,
    hardCardMs: row.hard_card_ms,
    scoreStatus: row.score_status,
  })));
  const playerAttempt = rows.find((row) => row.player_id === player.id);
  const playerRank = playerAttempt
    ? ranked.find((entry) => entry.attemptId === playerAttempt.attempt_id)?.rank
    : undefined;
  if (!playerRank || playerRank > 3) {
    throw new ApiError(409, "rehearsal_payout_preview_not_top_three", "Only the current top three can test the winner form.");
  }

  const now = Date.now();
  const accountLast4 = accountNumber.slice(-4);
  const countryCode = "NG";
  await db.prepare(
    `INSERT INTO rehearsal_payout_previews (
       id, competition_id, player_id, rank_at_submission, display_name,
       bank_label, account_last4, country_code, submitted_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
     ON CONFLICT(competition_id, player_id) DO UPDATE SET
       rank_at_submission = excluded.rank_at_submission,
       display_name = excluded.display_name,
       bank_label = excluded.bank_label,
       account_last4 = excluded.account_last4,
       country_code = excluded.country_code,
       submitted_at = excluded.submitted_at,
       updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), competitionID, player.id, playerRank, displayName,
    bankLabel, accountLast4, countryCode, now,
  ).run();
  return json({
    payout_details: {
      status: "test_saved",
      message: `Test form saved for the owner queue at rank ${playerRank}. Only the final four dummy account digits were recorded; no payment can be created.`,
    },
  });
}

async function listRehearsalPayoutPreviews(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const competitionID = new URL(request.url).searchParams.get("competition_id")?.trim() ?? "";
  const db = database(env);
  const result = await db.prepare(
    `SELECT r.id, r.competition_id, r.player_id, r.rank_at_submission,
            r.display_name, r.bank_label, r.account_last4, r.country_code,
            r.submitted_at, r.updated_at, p.public_handle, c.title AS competition_title
       FROM rehearsal_payout_previews r
       JOIN players p ON p.id = r.player_id
       JOIN competitions c ON c.id = r.competition_id
       ${competitionID ? "WHERE r.competition_id = ?1" : "WHERE c.slug = ?1"}
      ORDER BY r.rank_at_submission ASC, r.submitted_at ASC
      LIMIT 100`,
  ).bind(competitionID || SERVER_REHEARSAL_SLUG).all<Record<string, unknown>>();
  return json({
    test_only: true,
    message: "Internal test queue only. No entry in this list can be paid.",
    payout_previews: result.results ?? [],
  });
}

async function listCashPayoutDetails(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  assertIndividualPayoutOperator(authorization);
  const competitionID = new URL(request.url).searchParams.get("competition_id")?.trim() ?? "";
  const db = database(env);
  const result = await db.prepare(
    `SELECT d.id, d.payout_id, d.player_id, d.competition_id, d.details_ciphertext,
            d.status, d.submitted_at, d.reviewed_by, d.reviewed_at,
            p.public_handle, cp.place, cp.amount_minor, cp.currency
     FROM competition_payout_details d
     JOIN players p ON p.id = d.player_id
     JOIN competition_payouts cp ON cp.id = d.payout_id
     ${competitionID ? "WHERE d.competition_id = ?1" : ""}
     ORDER BY d.submitted_at ASC LIMIT 500`,
  ).bind(...(competitionID ? [competitionID] : [])).all<Record<string, unknown> & { details_ciphertext: string }>();
  const details = [];
  for (const row of result.results ?? []) {
    let payoutDetails: Record<string, string> | null = null;
    try {
      payoutDetails = JSON.parse(await decryptConfidentialPayload(row.details_ciphertext, env.WBD_PAYOUT_DATA_ENCRYPTION_SECRET)) as Record<string, string>;
    } catch {
      payoutDetails = null;
    }
    const { details_ciphertext: _ciphertext, ...metadata } = row;
    details.push({ ...metadata, payout_details: payoutDetails });
  }
  return json({ payout_details: details });
}

async function updateCashPayoutDetails(request: Request, env: ApiEnv, detailID: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  assertIndividualPayoutOperator(authorization);
  const payload = await readJsonObject(request, { maximumBytes: 16_000, requireApplicationJSON: true });
  const status = payload.status === "verified" || payload.status === "rejected" ? payload.status : "";
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2_000) : "";
  if (!status || !note) throw new ApiError(400, "payout_details_review_invalid", "A verified or rejected status and review note are required.");
  const db = database(env);
  const row = await db.prepare(`SELECT id, payout_id, status FROM competition_payout_details WHERE id = ?1 LIMIT 1`).bind(detailID).first<{ id: string; payout_id: string; status: string }>();
  if (!row) throw new ApiError(404, "payout_details_not_found", "The payout details record was not found.");
  if (row.status !== "submitted") throw new ApiError(409, "payout_details_already_reviewed", "This payout details record has already been reviewed.");
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE competition_payout_details SET status = ?1, reviewed_by = ?2, reviewed_at = ?3, updated_at = ?3 WHERE id = ?4`).bind(status, authorization.publishedBy, now, detailID),
    db.prepare(`INSERT INTO competition_payout_audit (id, payout_id, action, actor, note, details_json, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, '{}', ?6)`).bind(crypto.randomUUID(), row.payout_id, `details_${status}`, authorization.publishedBy, note, now),
  ]);
  await recordAdminAudit(db, authorization, `payout_details_${status}`, "competition_payout_details", detailID, note, { payout_id: row.payout_id });
  return json({ updated: true, id: detailID, status });
}

async function createCashPayout(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  assertIndividualPayoutOperator(authorization);
  const payload = await readJsonObject(request, { maximumBytes: 16_000, requireApplicationJSON: true });
  const competitionID = typeof payload.competition_id === "string" ? payload.competition_id.trim() : "";
  const attemptID = typeof payload.attempt_id === "string" ? payload.attempt_id.trim() : "";
  const place = Number(payload.place);
  const amountMinor = Number(payload.amount_minor);
  const currency = typeof payload.currency === "string" ? payload.currency.trim().toUpperCase() : "NGN";
  if (!competitionID || !attemptID || !Number.isInteger(place) || place < 1 || !Number.isInteger(amountMinor) || amountMinor <= 0 || currency !== "NGN") {
    throw new ApiError(400, "invalid_payout", "A competition, attempt, positive place, NGN amount, and attempt are required.");
  }
  const db = database(env);
  const row = await db.prepare(`SELECT a.player_id, a.competition_id, a.status, a.score_status, r.status AS review_status,
    r.reviewer AS review_reviewer,
    cp.amount_minor AS configured_amount, c.currency AS competition_currency
    FROM attempts a JOIN competition_reviews r ON r.attempt_id = a.id
    JOIN competition_prizes cp ON cp.competition_id = a.competition_id AND cp.place = ?3
    JOIN competitions c ON c.id = a.competition_id
    WHERE a.id = ?1 AND a.competition_id = ?2 LIMIT 1`).bind(attemptID, competitionID, place).first<{ player_id: string; competition_id: string; status: string; score_status: string; review_status: CashReviewStatus; review_reviewer: string | null; configured_amount: number; competition_currency: string }>();
  if (!row || row.status === "voided" || row.score_status !== "confirmed" || row.review_status !== "cleared") throw new ApiError(409, "payout_not_ready", "Only a confirmed, cleared winner can receive a payout record.");
  if (row.competition_currency !== "NGN") {
    throw new ApiError(409, "payout_currency_mismatch", "Payouts can only be created for a competition configured in NGN.");
  }
  if (!row.review_reviewer || row.review_reviewer === authorization.publishedBy) {
    throw new ApiError(409, "separate_payout_operator_required", "A different authorized operator must create the payout after review.");
  }
  if (row.configured_amount !== amountMinor) throw new ApiError(409, "payout_amount_mismatch", "The payout amount does not match the published prize configuration.");
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO competition_payouts (id, competition_id, attempt_id, player_id, place, amount_minor, currency, status, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?9)`).bind(id, competitionID, attemptID, row.player_id, place, amountMinor, currency, authorization.publishedBy, now),
    db.prepare(`INSERT INTO competition_payout_audit (id, payout_id, action, actor, note, details_json, changed_at) VALUES (?1, ?2, 'created', ?3, ?4, '{}', ?5)`).bind(crypto.randomUUID(), id, authorization.publishedBy, "Payout record created after winner review.", now),
  ]);
  await recordAdminAudit(db, authorization, "payout_created", "competition_payout", id, "Payout record created after winner review.", { competition_id: competitionID, attempt_id: attemptID, place, amount_minor: amountMinor, currency });
  let notification: { eligible: number; sent: number; failed: number; removed: number } | null = null;
  try {
    notification = await notifyPayoutDetailsRequired(env, db, row.player_id);
  } catch {
    // The payout record remains valid; the operator can retry the notification
    // after APNs configuration is corrected.
  }
  return json({ created: true, payout_id: id, status: "pending", notification }, 201);
}

async function updateCashPayout(request: Request, env: ApiEnv, payoutID: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  assertIndividualPayoutOperator(authorization);
  const payload = await readJsonObject(request, { maximumBytes: 16_000, requireApplicationJSON: true });
  const status = cashPayoutStatus(payload.status);
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2_000) : "";
  if (!note) throw new ApiError(400, "payout_note_required", "A payout status note is required.");
  const transferReference = typeof payload.transfer_reference === "string" ? payload.transfer_reference.trim().slice(0, 160) : null;
  if (status === "sent" && !transferReference) throw new ApiError(400, "transfer_reference_required", "A completed transfer requires its provider reference.");
  const db = database(env);
  const row = await db.prepare(`SELECT id, status, created_by, approved_by, player_id FROM competition_payouts WHERE id = ?1 LIMIT 1`).bind(payoutID).first<{ id: string; status: CashPayoutStatus; created_by: string; approved_by: string | null; player_id: string }>();
  if (!row) throw new ApiError(404, "payout_not_found", "The payout record was not found.");
  if (!payoutTransitionAllowed(row.status, status)) {
    throw new ApiError(
      409,
      "invalid_payout_transition",
      "Payouts must move from pending to approved, then from approved to sent; failed, cancelled, and sent payouts are final.",
    );
  }
  // This endpoint requires owner authorization; the owner may perform both steps.
  if (
    status === "sent"
    && !row.approved_by
  ) {
    throw new ApiError(
      409,
      "different_sender_required",
      "The payout must be approved before recording the transfer.",
    );
  }
  const now = Date.now();
  const approvedAt = status === "approved" ? now : null;
  const sentAt = status === "sent" ? now : null;
  await db.batch([
    db.prepare(`UPDATE competition_payouts SET status = ?1, transfer_reference = COALESCE(?2, transfer_reference), failure_reason = CASE WHEN ?1 = 'failed' THEN ?3 ELSE failure_reason END, approved_by = CASE WHEN ?1 = 'approved' THEN ?4 ELSE approved_by END, approved_at = CASE WHEN ?1 = 'approved' THEN ?5 ELSE approved_at END, sent_by = CASE WHEN ?1 = 'sent' THEN ?4 ELSE sent_by END, sent_at = CASE WHEN ?1 = 'sent' THEN ?5 ELSE sent_at END, updated_at = ?5 WHERE id = ?6`).bind(status, transferReference, note, authorization.publishedBy, approvedAt ?? sentAt ?? now, payoutID),
    db.prepare(`INSERT INTO competition_payout_audit (id, payout_id, action, actor, note, details_json, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`).bind(crypto.randomUUID(), payoutID, status, authorization.publishedBy, note, JSON.stringify(transferReference ? { transfer_reference: transferReference } : {}), now),
  ]);
  await recordAdminAudit(db, authorization, `payout_${status}`, "competition_payout", payoutID, note, { transfer_reference: transferReference });
  const notificationEvent = status === "approved"
    ? "payout_approved"
    : status === "sent"
      ? "payout_sent"
      : status === "failed"
        ? "payout_failed"
        : "payout_cancelled" as const;
  try { await notifyPayoutDetailsRequired(env, db, row.player_id, notificationEvent); } catch { /* status remains available in-app */ }
  return json({ updated: true, payout_id: payoutID, status });
}

async function resendCashPayoutNotification(request: Request, env: ApiEnv, payoutID: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const db = database(env);
  const row = await db.prepare(
    `SELECT id, player_id, status FROM competition_payouts WHERE id = ?1 LIMIT 1`,
  ).bind(payoutID).first<{ id: string; player_id: string; status: CashPayoutStatus }>();
  if (!row) throw new ApiError(404, "payout_not_found", "The payout record was not found.");
  if (row.status === "cancelled") throw new ApiError(409, "payout_notification_closed", "Cancelled payouts cannot send winner notifications.");
  const notification = await notifyPayoutDetailsRequired(env, db, row.player_id);
  await recordAdminAudit(
    db,
    authorization,
    "payout_notification_resent",
    "competition_payout",
    payoutID,
    "Winner payout notification resent from the owner console.",
    notification,
  );
  return json({ sent: true, payout_id: payoutID, notification });
}

async function updateAdminPlayerAccountState(
  request: Request,
  env: ApiEnv,
  playerID: string,
): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: 16_000, requireApplicationJSON: true });
  const action = payload.action === "reinstate" ? "reinstate" : payload.action === "suspend" ? "suspend" : "";
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2_000) : "";
  if (!action) throw new ApiError(400, "player_account_action_invalid", "Use suspend or reinstate.");
  if (!note) throw new ApiError(400, "player_account_note_required", "A reason is required for an account restriction change.");
  const db = database(env);
  const player = await db.prepare(
    `SELECT id, account_state, phone_verified_at FROM players WHERE id = ?1 LIMIT 1`,
  ).bind(playerID).first<{ id: string; account_state: string; phone_verified_at: number | null }>();
  if (!player) throw new ApiError(404, "player_not_found", "The player could not be found.");
  const nextState = action === "suspend" ? "suspended" : player.phone_verified_at ? "phone_verified" : "guest";
  if (player.account_state === nextState) {
    return json({ updated: true, player_id: player.id, account_state: nextState, already_applied: true });
  }
  const now = Date.now();
  await db.prepare(`UPDATE players SET account_state = ?1, updated_at = ?2 WHERE id = ?3`).bind(nextState, now, player.id).run();
  await recordAdminAudit(db, authorization, `player_${action}`, "player", player.id, note, { from: player.account_state, to: nextState });
  return json({ updated: true, player_id: player.id, account_state: nextState });
}

async function routeApiRequest(request: Request, env: ApiEnv): Promise<Response> {
  const path = apiPath(new URL(request.url).pathname);

  if (path === "/api/v1/health") {
    assertMethod(request, "GET");
    return json({
      service: "wetin-be-dis-competition-api",
      api_version: API_VERSION,
      status: "ok",
      database_configured: Boolean(env.DB),
    });
  }
  if (path === "/api/v1/auth/capabilities") {
    assertMethod(request, "GET");
    return capabilities(env);
  }
  if (path === "/api/v1/content/manifest") {
    assertMethod(request, "GET");
    return currentContentManifest(request, env);
  }
  if (path === "/api/v1/admin/event-packs/publish") {
    assertMethod(request, "POST");
    return publishEventPack(request, env);
  }
  if (path === "/api/v1/admin/event-packs/codes/revoke") {
    assertMethod(request, "POST");
    return revokeEventPackCode(request, env);
  }
  const adminEventPackMatch = /^\/api\/v1\/admin\/event-packs\/([^/]+)\/revoke$/.exec(path);
  if (adminEventPackMatch) {
    assertMethod(request, "POST");
    return revokeEventPack(request, env, decodeURIComponent(adminEventPackMatch[1]));
  }
  if (path === "/api/v1/me/event-packs") {
    assertMethod(request, "GET");
    return listPlayerEventPacks(request, env);
  }
  if (path === "/api/v1/me/event-packs/redeem") {
    assertMethod(request, "POST");
    return redeemPlayerEventPack(request, env);
  }
  const playerEventPackMatch = /^\/api\/v1\/me\/event-packs\/([^/]+)$/.exec(path);
  if (playerEventPackMatch) {
    assertMethod(request, "GET");
    const player = await authenticate(request, database(env));
    return eventPackPayload(database(env), player.id, decodeURIComponent(playerEventPackMatch[1]));
  }
  if (path === "/api/v1/app-config") {
    assertMethod(request, "GET");
    return currentAppConfig(request, env);
  }
  if (path === "/api/v1/competitions/schedule") {
    assertMethod(request, "GET");
    return currentLeagueSchedule(request, env);
  }
  if (path === "/api/v1/billing/google-play/purchases") {
    assertMethod(request, "POST");
    return verifyGooglePlayPurchase(request, env);
  }
  if (path === "/api/v1/billing/google-play/review-access") {
    assertMethod(request, "POST");
    return googleReviewAccess(request, env);
  }
  if (path === "/api/v1/admin/auth/apple/start") {
    assertMethod(request, "GET");
    return appleStart(request, env);
  }
  if (path === "/api/v1/admin/auth/apple/callback") {
    assertMethod(request, "POST");
    return appleCallback(request, env);
  }
  if (path === "/api/v1/admin/session") {
    assertMethod(request, "GET");
    return appleSession(request, env);
  }
  if (path === "/api/v1/admin/logout") {
    assertMethod(request, "POST");
    return appleLogout();
  }
  if (path === "/api/v1/admin/content/session") {
    assertMethod(request, "GET");
    return contentAdminSession(request, env);
  }
  if (path === "/api/v1/admin/card-preview") {
    assertMethod(request, "GET");
    return ownerCompetitionCardPreview(request, env);
  }
  if (path === "/api/v1/admin/card-preview/token" && request.method === "GET") {
    return getOwnerCardPreviewTokenStatus(request, env);
  }
  if (path === "/api/v1/admin/card-preview/token" && request.method === "POST") {
    return issueOwnerCardPreviewToken(request, env);
  }
  if (path === "/api/v1/admin/content/catalog") {
    assertMethod(request, "GET");
    return ownerContentCatalog(request, env);
  }
  if (path === "/api/v1/admin/content/releases") {
    assertMethod(request, "GET");
    return listAdminContentReleases(request, env);
  }
  if (path === "/api/v1/admin/cash/launch-gates") {
    assertMethod(request, "GET");
    return listCashLaunchGates(request, env);
  }
  const cashLaunchGateMatch = /^\/api\/v1\/admin\/cash\/launch-gates\/([^/]+)$/.exec(path);
  if (cashLaunchGateMatch) {
    assertMethod(request, "POST");
    return updateCashLaunchGate(
      request,
      env,
      decodeURIComponent(cashLaunchGateMatch[1]),
    );
  }
  const eligibleCountriesMatch = /^\/api\/v1\/admin\/cash\/competitions\/([^/]+)\/eligible-countries$/.exec(path);
  if (eligibleCountriesMatch) {
    assertMethod(request, "POST");
    return updateCompetitionEligibleCountries(request, env, decodeURIComponent(eligibleCountriesMatch[1]));
  }
  if (path === "/api/v1/admin/privacy/requests") {
    assertMethod(request, "GET");
    return listPrivacyRequests(request, env);
  }
  if (path === "/api/v1/admin/support/cases") {
    if (request.method === "GET") return listSupportCases(request, env);
    if (request.method === "POST") return createSupportCase(request, env);
    throw new ApiError(405, "method_not_allowed", "Use GET or POST for support cases.");
  }
  const supportCaseMatch = /^\/api\/v1\/admin\/support\/cases\/([^/]+)$/.exec(path);
  if (supportCaseMatch) {
    assertMethod(request, "POST");
    return updateSupportCase(request, env, decodeURIComponent(supportCaseMatch[1]));
  }
  const privacyRequestMatch = /^\/api\/v1\/admin\/privacy\/requests\/([^/]+)$/.exec(path);
  if (privacyRequestMatch) {
    assertMethod(request, "POST");
    return updatePrivacyRequest(request, env, decodeURIComponent(privacyRequestMatch[1]));
  }
  if (path === "/api/v1/admin/party-deck") {
    if (request.method === "GET") return getPartyDeckEditorState(request, env);
    if (request.method === "PUT") return savePartyDeckEditorState(request, env);
    throw new ApiError(405, "method_not_allowed", "Use GET or PUT for this endpoint.");
  }
  const contentAssetMatch =
    /^\/api\/v1\/content\/assets\/([^/]+)\/(party_deck|solo_gist)$/.exec(path);
  if (contentAssetMatch) {
    assertMethod(request, "GET");
    return contentAsset(
      request,
      env,
      decodeURIComponent(contentAssetMatch[1]),
      contentAssetMatch[2],
    );
  }
  if (path === "/api/v1/admin/content/releases/validate") {
    assertMethod(request, "POST");
    return validateContentRelease(request, env);
  }
  if (path === "/api/v1/admin/content/releases/publish") {
    assertMethod(request, "POST");
    return publishContentRelease(request, env);
  }
  if (path === "/api/v1/admin/content/releases/rollback") {
    assertMethod(request, "POST");
    return changeContentReleaseStatus(request, env, "rollback");
  }
  if (path === "/api/v1/admin/content/releases/revoke") {
    assertMethod(request, "POST");
    return changeContentReleaseStatus(request, env, "revoke");
  }
  if (path === "/api/v1/admin/app-config/validate") {
    assertMethod(request, "POST");
    return validateAppConfigRequest(request, env);
  }
  if (path === "/api/v1/admin/app-config/publish") {
    assertMethod(request, "POST");
    return publishAppConfig(request, env);
  }
  if (
    path === "/api/v1/admin/notifications/league-test"
    || path === "/api/v1/admin/notifications/league-broadcast"
    || path === "/api/v1/admin/notifications/announcement-broadcast"
  ) {
    assertMethod(request, "POST");
    return sendLeagueTestNotification(request, env);
  }
  if (path === "/api/v1/admin/competitions/rehearsal-window") {
    assertMethod(request, "POST");
    return setServerRehearsalWindow(request, env);
  }
  if (path === "/api/v1/admin/competitions/internal-public-rehearsal") {
    assertMethod(request, "POST");
    return provisionInternalPublicRehearsal(request, env);
  }
  if (path === "/api/v1/admin/competitions/one-day-simulation") {
    assertMethod(request, "POST");
    return provisionOneDayLeagueRound(request, env);
  }
  if (path === "/api/v1/admin/app-config/draft") {
    assertMethod(request, "POST");
    return createAppConfigDraft(request, env);
  }
  if (path === "/api/v1/admin/app-config/review") {
    assertMethod(request, "POST");
    return reviewAppConfig(request, env);
  }
  if (path === "/api/v1/admin/app-config/disable") {
    assertMethod(request, "POST");
    return disableAppConfig(request, env);
  }
  if (path === "/api/v1/admin/app-config/rollback") {
    assertMethod(request, "POST");
    return changeAppConfigStatus(request, env, "rollback");
  }
  if (path === "/api/v1/admin/app-config/revoke") {
    assertMethod(request, "POST");
    return changeAppConfigStatus(request, env, "revoke");
  }
  if (path === "/api/v1/admin/cash/reviews") {
    assertMethod(request, "GET");
    return listCashReviews(request, env);
  }
  if (path === "/api/v1/admin/leaderboard") {
    assertMethod(request, "GET");
    return adminLeaderboard(request, env);
  }
  if (path === "/api/v1/admin/audit") {
    assertMethod(request, "GET");
    return listAdminAudit(request, env);
  }
  if (path === "/api/v1/admin/players") {
    assertMethod(request, "GET");
    return listAdminPlayers(request, env);
  }
  if (path === "/api/v1/admin/competitions") {
    if (request.method === "GET") return listAdminCompetitions(request, env);
    if (request.method === "POST") return createAdminCompetition(request, env);
    throw new ApiError(405, "method_not_allowed", "Use GET or POST for competitions.");
  }
  const prepareReviewMatch = /^\/api\/v1\/admin\/competitions\/([^/]+)\/prepare-review$/.exec(path);
  if (prepareReviewMatch) {
    assertMethod(request, "POST");
    return prepareCompetitionReview(request, env, decodeURIComponent(prepareReviewMatch[1]));
  }
  const adminCompetitionMatch = /^\/api\/v1\/admin\/competitions\/([^/]+)$/.exec(path);
  if (adminCompetitionMatch) {
    if (request.method === "DELETE") return deleteAdminCompetition(request, env, decodeURIComponent(adminCompetitionMatch[1]));
    assertMethod(request, "POST");
    return updateAdminCompetition(request, env, decodeURIComponent(adminCompetitionMatch[1]));
  }
  if (path === "/api/v1/admin/settings") {
    assertMethod(request, "GET");
    return listAdminSettings(request, env);
  }
  const adminRoleMatch = /^\/api\/v1\/admin\/settings\/roles\/([^/]+)$/.exec(path);
  if (adminRoleMatch) {
    assertMethod(request, "POST");
    return updateAdminRole(request, env, decodeURIComponent(adminRoleMatch[1]));
  }
  if (path === "/api/v1/admin/health") {
    assertMethod(request, "GET");
    return getAdminHealth(request, env);
  }
  if (path === "/api/v1/admin/notifications/status") {
    assertMethod(request, "GET");
    return getAdminNotificationStatus(request, env);
  }
  if (path === "/api/v1/admin/analytics") {
    assertMethod(request, "GET");
    return getAdminAnalytics(request, env);
  }
  const cashReviewMatch = /^\/api\/v1\/admin\/cash\/reviews\/([^/]+)$/.exec(path);
  if (cashReviewMatch) {
    assertMethod(request, "POST");
    return updateCashReview(request, env, decodeURIComponent(cashReviewMatch[1]));
  }
  const eligibilityDecisionMatch = /^\/api\/v1\/admin\/cash\/players\/([^/]+)\/eligibility$/.exec(path);
  if (eligibilityDecisionMatch) {
    assertMethod(request, "POST");
    return decidePlayerEligibility(
      request,
      env,
      decodeURIComponent(eligibilityDecisionMatch[1]),
    );
  }
  const playerAccountStateMatch = /^\/api\/v1\/admin\/players\/([^/]+)\/account-state$/.exec(path);
  if (playerAccountStateMatch) {
    assertMethod(request, "POST");
    return updateAdminPlayerAccountState(request, env, decodeURIComponent(playerAccountStateMatch[1]));
  }
  if (path === "/api/v1/admin/cash/payouts" && request.method === "GET") {
    return listCashPayouts(request, env);
  }
  if (path === "/api/v1/admin/cash/payouts" && request.method === "POST") {
    return createCashPayout(request, env);
  }
  if (path === "/api/v1/admin/cash/payout-details" && request.method === "GET") {
    return listCashPayoutDetails(request, env);
  }
  const cashPayoutDetailsMatch = /^\/api\/v1\/admin\/cash\/payout-details\/([^/]+)$/.exec(path);
  if (cashPayoutDetailsMatch) {
    assertMethod(request, "POST");
    return updateCashPayoutDetails(request, env, decodeURIComponent(cashPayoutDetailsMatch[1]));
  }
  if (path === "/api/v1/admin/rehearsal/payout-previews") {
    assertMethod(request, "GET");
    return listRehearsalPayoutPreviews(request, env);
  }
  const cashPayoutMatch = /^\/api\/v1\/admin\/cash\/payouts\/([^/]+)\/status$/.exec(path);
  if (cashPayoutMatch) {
    assertMethod(request, "POST");
    return updateCashPayout(request, env, decodeURIComponent(cashPayoutMatch[1]));
  }
  const cashPayoutNotificationMatch = /^\/api\/v1\/admin\/cash\/payouts\/([^/]+)\/notify$/.exec(path);
  if (cashPayoutNotificationMatch) {
    assertMethod(request, "POST");
    return resendCashPayoutNotification(request, env, decodeURIComponent(cashPayoutNotificationMatch[1]));
  }
  if (path === "/api/v1/auth/phone/start" || path === "/api/v1/auth/phone/verify") {
    assertMethod(request, "POST");
    return phoneVerificationUnavailable();
  }
  if (path === "/api/v1/players/guest") {
    assertMethod(request, "POST");
    return createGuestSession(request, env);
  }
  if (path === "/api/v1/me") {
    assertMethod(request, "GET");
    return getMe(request, env);
  }
  if (path === "/api/v1/me/privacy-requests") {
    if (request.method === "GET") return listMyPrivacyRequests(request, env);
    if (request.method === "POST") return createPrivacyRequest(request, env);
    throw new ApiError(405, "method_not_allowed", "Use GET or POST for this endpoint.");
  }
  if (path === "/api/v1/me/league-profile") {
    assertMethod(request, "PUT");
    return linkFirebaseLeagueProfile(request, env);
  }
  if (path === "/api/v1/me/cash/payout-details") {
    if (request.method === "GET") return getPlayerPayoutDetailsStatus(request, env);
    if (request.method === "POST") return submitPlayerPayoutDetails(request, env);
    throw new ApiError(405, "method_not_allowed", "Use GET or POST for payout details.");
  }
  if (path === "/api/v1/me/rehearsal/payout-preview") {
    assertMethod(request, "POST");
    return submitRehearsalPayoutPreview(request, env);
  }
  if (path === "/api/v1/tv-displays" && request.method === "POST") {
    return createProjectToTVSession(request, env);
  }
  const tvDisplayMatch = /^\/api\/v1\/tv-displays\/([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4})$/.exec(path);
  if (tvDisplayMatch && ["GET", "PUT", "DELETE"].includes(request.method)) {
    return projectToTVRequest(request, env, tvDisplayMatch[1]);
  }
  if (path === "/api/v1/call-rooms") {
    assertMethod(request, "POST");
    return createPlayOnCallRoom(request, env);
  }
  const roomSocketMatch = /^\/api\/v1\/call-rooms\/([^/]+)\/socket$/.exec(path);
  if (roomSocketMatch) {
    assertMethod(request, "GET");
    return connectPlayOnCallRoom(request, env, decodeURIComponent(roomSocketMatch[1]));
  }
  const roomJoinMatch = /^\/api\/v1\/call-rooms\/([^/]+)\/join$/.exec(path);
  if (roomJoinMatch) {
    assertMethod(request, "POST");
    return joinPlayOnCallRoom(request, env, decodeURIComponent(roomJoinMatch[1]));
  }
  if (path === "/api/v1/me/notification-devices") {
    assertMethod(request, "PUT");
    return registerNotificationDevice(request, env);
  }
  if (path === "/api/v1/competitions/current") {
    assertMethod(request, "GET");
    return currentCompetition(request, env);
  }
  if (path === "/api/v1/competitions/latest-completed") {
    assertMethod(request, "GET");
    return latestCompletedCompetition(request, env);
  }

  const startMatch = /^\/api\/v1\/competitions\/([^/]+)\/attempts$/.exec(path);
  if (startMatch) {
    assertMethod(request, "POST");
    return startAttempt(request, env, decodeURIComponent(startMatch[1]));
  }
  const resumeMatch = /^\/api\/v1\/competitions\/([^/]+)\/attempts\/active$/.exec(path);
  if (resumeMatch) {
    assertMethod(request, "GET");
    return resumeActiveAttempt(request, env, decodeURIComponent(resumeMatch[1]));
  }
  const leaderboardMatch =
    /^\/api\/v1\/competitions\/([^/]+)\/leaderboard$/.exec(path);
  if (leaderboardMatch) {
    assertMethod(request, "GET");
    return leaderboard(request, env, decodeURIComponent(leaderboardMatch[1]));
  }
  const submitMatch = /^\/api\/v1\/attempts\/([^/]+)\/submit$/.exec(path);
  if (submitMatch) {
    assertMethod(request, "POST");
    return submitAttempt(request, env, decodeURIComponent(submitMatch[1]));
  }
  const androidRegistrationChallenge = /^\/api\/v1\/attempts\/([^/]+)\/play-integrity\/registration-challenge$/.exec(path);
  if (androidRegistrationChallenge) { assertMethod(request, "POST"); return issueAndroidIntegrityChallenge(request, env, decodeURIComponent(androidRegistrationChallenge[1]), "registration"); }
  const androidRegister = /^\/api\/v1\/attempts\/([^/]+)\/play-integrity\/register$/.exec(path);
  if (androidRegister) { assertMethod(request, "POST"); return registerAndroidIntegrity(request, env, decodeURIComponent(androidRegister[1])); }
  const androidAnswerChallenge = /^\/api\/v1\/attempts\/([^/]+)\/play-integrity\/cash-answer-challenge$/.exec(path);
  if (androidAnswerChallenge) { assertMethod(request, "POST"); return issueAndroidIntegrityChallenge(request, env, decodeURIComponent(androidAnswerChallenge[1]), "cash_answer"); }
  const appAttestRegistrationMatch = /^\/api\/v1\/attempts\/([^/]+)\/app-attest\/registration-challenge$/.exec(path);
  if (appAttestRegistrationMatch) {
    assertMethod(request, "POST");
    return issueAppAttestRegistrationChallenge(
      request,
      env,
      decodeURIComponent(appAttestRegistrationMatch[1]),
    );
  }
  const appAttestRegisterMatch = /^\/api\/v1\/attempts\/([^/]+)\/app-attest\/register$/.exec(path);
  if (appAttestRegisterMatch) {
    assertMethod(request, "POST");
    return registerAppAttestKey(
      request,
      env,
      decodeURIComponent(appAttestRegisterMatch[1]),
    );
  }
  const appAttestCashAnswerMatch = /^\/api\/v1\/attempts\/([^/]+)\/app-attest\/cash-answer-challenge$/.exec(path);
  if (appAttestCashAnswerMatch) {
    assertMethod(request, "POST");
    return issueAppAttestCashAnswerChallenge(
      request,
      env,
      decodeURIComponent(appAttestCashAnswerMatch[1]),
    );
  }
  const cashAnswerMatch = /^\/api\/v1\/attempts\/([^/]+)\/cash-answer$/.exec(path);
  if (cashAnswerMatch) {
    assertMethod(request, "POST");
    return answerCashAttempt(request, env, decodeURIComponent(cashAnswerMatch[1]));
  }
  const cashTimeoutMatch = /^\/api\/v1\/attempts\/([^/]+)\/cash-timeout$/.exec(path);
  if (cashTimeoutMatch) {
    assertMethod(request, "POST");
    return answerCashAttempt(request, env, decodeURIComponent(cashTimeoutMatch[1]), true);
  }
  const challengeMatch =
    /^\/api\/v1\/attempts\/([^/]+)\/challenges$/.exec(path);
  if (challengeMatch) {
    assertMethod(request, "POST");
    return createScoreChallenge(request, env, decodeURIComponent(challengeMatch[1]));
  }

  throw new ApiError(404, "endpoint_not_found", "The API endpoint could not be found.");
}

export async function handleApiRequest(
  request: Request,
  env: ApiEnv,
): Promise<Response | null> {
  if (!new URL(request.url).pathname.startsWith("/api/v1")) return null;

  const requestId = crypto.randomUUID();
  try {
    const response = await routeApiRequest(request, env);
    // A Durable Object WebSocket upgrade returns an immutable 101 response.
    // Mutating its headers here turns a valid upgrade into an internal error.
    // HTTP responses still receive the request ID for support correlation.
    if (response.status !== 101) response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
