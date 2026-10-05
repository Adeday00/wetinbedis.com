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
  createOpaqueToken,
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

export interface ApiEnv {
  DB?: D1Database;
  PLAY_ON_CALL_ROOMS?: DurableObjectNamespace;
  WBD_CONTENT_ADMIN_TOKEN?: string;
  WBD_CONTENT_ADMIN_USER_IDS?: string;
  WBD_CONTENT_ADMIN_EMAILS?: string;
  WBD_PUSH_TOKEN_ENCRYPTION_SECRET?: string;
  WBD_PLAY_ON_CALL_SIGNING_SECRET?: string;
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
const PARTY_DECK_EDITOR_CATEGORIES = new Set([
  "Celebrities",
  "Culture",
  "Diaspora",
  "Food",
  "Music",
  "Naija Life",
  "Religion",
  "School",
  "Slang",
  "Street & Hustle",
]);
// This is intentionally not an environment override. It can become true only
// after real phone verification, device attestation, and trusted timing exist.
const CASH_PRIZE_ATTEMPTS_AVAILABLE = false;
const MAX_LEADERBOARD_ROWS = 10_000;
const PUBLIC_LEADERBOARD_ROWS = 100;

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
  method: "bearer" | "siwc";
};

async function authorizeContentAdmin(
  request: Request,
  env: ApiEnv,
): Promise<ContentAdminAuthorization> {
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

  if (!configuredToken && allowedUserIDs.size === 0 && allowedEmails.size === 0) {
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
  if (!suppliedOrigin || suppliedOrigin !== expectedOrigin) {
    throw new ApiError(
      403,
      "content_admin_origin_invalid",
      "Content changes must be submitted from the owner console.",
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
  if (pathname === "/api/v1/") return "/api/v1";
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
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
    eligibilityStatus: row.eligibility_status,
    acceptedRulesVersion: row.accepted_rules_version,
  };
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
  connection: { ticket: string; ticket_expires_at: number; socket_url: string };
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
    },
  };
}

async function createPlayOnCallRoom(request: Request, env: ApiEnv): Promise<Response> {
  if (!playOnCallIsConfigured(env)) return playOnCallUnavailable();
  const player = await authenticate(request, database(env));
  const body = playOnCallRequestBody(await readJsonObject(request, { optional: true }));
  const displayName = normalizePlayOnCallDisplayName(body.displayName, player.publicHandle);

  // Eight characters from a non-confusing alphabet gives a friendly spoken
  // code without treating a room code itself as authentication. The ticket is
  // the actual short-lived join capability.
  for (let attempt = 0; attempt < 3; attempt += 1) {
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
    if (!/^[a-fA-F0-9]{64}$/.test(cleaned)) {
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
  return (result.results ?? []).map((prize) => ({
    place: prize.place,
    amount_minor: prize.amount_minor,
  }));
}

function competitionPayload(
  competition: CompetitionRow,
  prizes: Array<{ place: number; amount_minor: number }>,
) {
  return {
    id: competition.id,
    slug: competition.slug,
    title: competition.title,
    status: "preview",
    rules_version: competition.rules_version,
    pack_version: competition.pack_version,
    scoring_version: competition.scoring_version,
    mode: "practice",
    prize_eligible: false,
    timing_trust: "client_reported_untrusted",
    attempt_availability: {
      available: competition.entry_mode === "guest" && prizes.length === 0,
      reason: "practice_only",
    },
    question_count: competition.question_count,
    per_card_limit_ms: competition.per_card_limit_ms,
    entry: {
      mode: "practice_preview",
      country_code: competition.country_code,
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
      places: [],
      configured_place_count: prizes.length,
      status: "not_prize_eligible",
      exact_ties: "share_affected_place_pool",
    },
    leaderboard_order: [
      "correct_count_desc",
      "adjusted_total_ms_asc",
      "hard_card_ms_asc",
    ],
  };
}

async function currentCompetition(env: ApiEnv): Promise<Response> {
  const db = database(env);
  const competition = await getActiveCompetition(db);
  if (!competition) {
    throw new ApiError(404, "no_active_competition", "There is no open competition right now.");
  }
  const prizes = await prizePayload(db, competition.id);
  if (
    !CASH_PRIZE_ATTEMPTS_AVAILABLE
    && (prizes.length > 0 || competition.entry_mode !== "guest")
  ) {
    throw new ApiError(
      503,
      "cash_competition_unavailable",
      "Prize competition is unavailable while phone verification, device attestation, and trusted timing are incomplete.",
      { mode: "practice", prize_eligible: false },
    );
  }
  await validatedCompetitionPack(db, competition);
  return json({ competition: competitionPayload(competition, prizes) });
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

  const isolationIssues = validateCompetitionIsolation(
    cards,
    await loadPublicContentSources(db),
  );
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
  const db = database(env);
  const player = await authenticate(request, db);
  const competition = await getActiveCompetition(db, competitionId);
  if (!competition) {
    throw new ApiError(404, "competition_not_open", "This competition is not open.");
  }

  const configuredPrizes = await prizePayload(db, competition.id);
  const isCashAttempt =
    configuredPrizes.length > 0 || competition.entry_mode !== "guest";
  if (
    !CASH_PRIZE_ATTEMPTS_AVAILABLE
    && isCashAttempt
  ) {
    throw new ApiError(
      503,
      "cash_competition_unavailable",
      "Prize attempts remain in practice mode until device attestation and trusted timing are available.",
      {
        mode: "practice",
        phone_verification_required: true,
        device_attestation_required: true,
        trusted_timing_required: true,
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
        started_at: startedAt,
        play_deadline_at: playDeadlineAt,
        submit_deadline_at: submitDeadlineAt,
        // Practice intentionally keeps its existing batch flow. A cash
        // attempt returns only card one; later cards are issued by the
        // cash-only endpoint after each recorded answer.
        cards: isCashAttempt
          ? []
          : cards.map((card) =>
              publicCompetitionCard(card, competition.per_card_limit_ms),
            ),
        card: isCashAttempt
          ? publicCompetitionCard(cards[0], competition.per_card_limit_ms)
          : undefined,
      },
    },
    201,
  );
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

/**
 * Cash-only answer boundary. It deliberately has no `response_ms` input:
 * response time is derived from rows written by this service. The route is
 * currently unreachable because CASH_PRIZE_ATTEMPTS_AVAILABLE is hard-off.
 */
async function answerCashAttempt(
  request: Request,
  env: ApiEnv,
  attemptId: string,
): Promise<Response> {
  if (!CASH_PRIZE_ATTEMPTS_AVAILABLE) {
    throw new ApiError(
      503,
      "cash_competition_unavailable",
      "Cash attempts remain unavailable until every integrity launch gate is complete.",
      { mode: "practice", prize_eligible: false },
    );
  }
  const db = database(env);
  const player = await authenticate(request, db);
  const attemptToken = request.headers.get("x-wbd-attempt-token") ?? "";
  if (!/^wbd_a_[A-Za-z0-9_-]{40,80}$/.test(attemptToken)) {
    throw new ApiError(401, "attempt_token_required", "The signed attempt token is required.");
  }

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

  const selectedOptionID = cashSelectedOption(await readJsonObject(request));
  const cards = await loadCompetitionPack(db, attempt.competition_id);
  const packIssues = validateCompetitionPack(cards, attempt.question_count);
  const isolationIssues = validateCompetitionIsolation(
    cards,
    await loadPublicContentSources(db),
  );
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
    });
  }

  const answerRows = await db
    .prepare(
      `SELECT i.ordinal, i.card_id, i.issued_at, i.answered_at, a.selected_option_id
       FROM attempt_card_issues i
       JOIN attempt_answers a
         ON a.attempt_id = i.attempt_id AND a.card_id = i.card_id
       WHERE i.attempt_id = ?1
       ORDER BY i.ordinal ASC`,
    )
    .bind(attempt.id)
    .all<ServerTimedAttemptAnswerRow>();
  const serverTimedAnswers: ServerTimedAnswer[] = (answerRows.results ?? []).map((row) => ({
    cardId: row.card_id,
    position: row.ordinal,
    selectedOptionId:
      row.selected_option_id === "__timeout__" ? null : row.selected_option_id,
    issuedAtMs: row.issued_at,
    answeredAtMs: row.answered_at ?? row.issued_at,
  }));
  const score = scoreServerTimedSubmission({
    cards,
    answers: serverTimedAnswers,
    perCardLimitMs: attempt.per_card_limit_ms,
  });
  const integrityFlags = ["server_timed_pending_integrity_review"];
  const submissionHash = await sha256Hex(canonicalSubmission(attempt.id, score.answers));
  await db
    .prepare(
      `UPDATE attempts SET
        status = 'submitted', submitted_at = ?2,
        client_active_ms = ?3, server_elapsed_ms = ?4,
        adjusted_total_ms = ?5, correct_count = ?6, hard_card_ms = ?7,
        integrity_status = 'review', integrity_flags_json = ?8,
        submission_hash = ?9, score_status = 'provisional', updated_at = ?2
       WHERE id = ?1 AND status = 'started'`,
    )
    .bind(
      attempt.id,
      now,
      score.clientActiveMs,
      now - attempt.started_at,
      score.adjustedTotalMs,
      score.correctCount,
      score.hardCardMs,
      JSON.stringify(integrityFlags),
      submissionHash,
    )
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO competition_reviews (
        id, attempt_id, competition_id, player_id, status, risk_score,
        flags_json, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6, ?7, ?7)`,
    )
    .bind(
      crypto.randomUUID(),
      attempt.id,
      attempt.competition_id,
      player.id,
      50,
      JSON.stringify(integrityFlags),
      now,
    )
    .run();

  return json({
    score: {
      attempt_id: attempt.id,
      correct_count: score.correctCount,
      question_count: attempt.question_count,
      adjusted_total_ms: score.adjustedTotalMs,
      hard_card_ms: score.hardCardMs,
      status: "provisional",
      integrity_status: "review",
      integrity_flags: integrityFlags,
      prize_eligible: true,
      timing_trust: "server_authoritative",
      ranking_order: [
        "correct_count_desc",
        "adjusted_total_ms_asc",
        "hard_card_ms_asc",
      ],
    },
  });
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

  const configuredPrizes = await prizePayload(db, competition.id);
  if (
    !CASH_PRIZE_ATTEMPTS_AVAILABLE
    && (configuredPrizes.length > 0 || competition.entry_mode !== "guest")
  ) {
    throw new ApiError(
      503,
      "cash_competition_unavailable",
      "Prize ranking is unavailable until every cash-integrity control is active.",
      { mode: "practice", prize_eligible: false },
    );
  }

  const practiceOnly = competition.entry_mode === "guest";
  const integrityPredicate = practiceOnly
    ? "a.integrity_status != 'failed'"
    : "a.integrity_status = 'passed'";
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
      score_status: "provisional" | "confirmed";
    }>();

  const scores: LeaderboardScore[] = (result.results ?? []).map((row) => ({
    attemptId: row.attempt_id,
    publicHandle: row.public_handle,
    correctCount: row.correct_count,
    adjustedTotalMs: row.adjusted_total_ms,
    hardCardMs: row.hard_card_ms,
    scoreStatus: row.score_status,
  }));
  const ranked = rankLeaderboard(scores);
  const viewerEntry = viewer
    ? ranked.find((entry) => entry.publicHandle === viewer.publicHandle) ?? null
    : null;

  return json({
    competition: {
      id: competition.id,
      slug: competition.slug,
      question_count: competition.question_count,
      scoring_version: competition.scoring_version,
      mode: practiceOnly ? "practice" : "prize",
      prize_eligible: false,
      ranking_scope: practiceOnly ? "practice" : "integrity_passed_only",
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
        sponsor_kind, sponsor_name, sponsor_message,
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
          sponsor_kind, sponsor_name, sponsor_message,
          published_by, published_at, created_at
        ) VALUES (?1, ?2, ?3, 'published', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`,
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
  if (!env.DB) {
    const config = safeDefaultAppConfig();
    return cacheableJsonResponse(request, config, { etag: appConfigETag(config), cacheControl: "no-store" });
  }
  const row = await env.DB.prepare(
    `SELECT config_json FROM app_config_revisions
     WHERE status = 'published' ORDER BY revision DESC LIMIT 1`,
  ).first<{ config_json: string }>();
  let config = safeDefaultAppConfig();
  if (row) {
    try {
      const parsed = JSON.parse(row.config_json) as unknown;
      const validation = validateAppConfig(parsed);
      if (validation.config && validation.issues.length === 0) config = validation.config;
    } catch {
      // Fail closed to the safe defaults rather than serving corrupt controls.
    }
  }
  return cacheableJsonResponse(request, config, {
    etag: appConfigETag(config),
    cacheControl: `public, max-age=${config.cache_ttl_seconds}, must-revalidate`,
    lastModifiedMs: Date.parse(config.published_at),
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
  try {
    await db.batch([
      db.prepare(`INSERT INTO app_config_revisions (id, revision, status, config_json, created_by, reason, created_at) VALUES (?1, ?2, 'draft', ?3, ?4, ?5, ?6)`).bind(id, result.config.revision, JSON.stringify(result.config), authorization.publishedBy, reason, now),
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
    const category = typeof card.Category === "string" ? card.Category.trim() : "";
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
    if (!PARTY_DECK_EDITOR_CATEGORIES.has(category)) issues.push(`${path}.Category:invalid`);
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

function capabilities(env: ApiEnv): Response {
  const phone = getPhoneVerificationProvider().capability;
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
        available: CASH_PRIZE_ATTEMPTS_AVAILABLE,
        reason: "phone_device_attestation_and_trusted_timing_required",
        phone_verification_required: true,
        device_attestation_required: true,
        trusted_timing_required: true,
      },
    },
  });
}

type CashReviewStatus = "queued" | "in_review" | "cleared" | "voided";
type CashPayoutStatus = "pending" | "approved" | "sent" | "failed" | "cancelled";

function cashReviewStatus(value: unknown): CashReviewStatus {
  if (value === "queued" || value === "in_review" || value === "cleared" || value === "voided") return value;
  throw new ApiError(400, "invalid_review_status", "Use queued, in_review, cleared, or voided.");
}

function cashPayoutStatus(value: unknown): CashPayoutStatus {
  if (value === "pending" || value === "approved" || value === "sent" || value === "failed" || value === "cancelled") return value;
  throw new ApiError(400, "invalid_payout_status", "Use pending, approved, sent, failed, or cancelled.");
}

async function listCashReviews(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const url = new URL(request.url);
  const competitionID = url.searchParams.get("competition_id")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const db = database(env);
  const where: string[] = [];
  const values: string[] = [];
  if (competitionID) { where.push("r.competition_id = ?"); values.push(competitionID); }
  if (status) { where.push("r.status = ?"); values.push(cashReviewStatus(status)); }
  const query = `SELECT r.id, r.attempt_id, r.competition_id, r.player_id, p.public_handle,
    r.status, r.risk_score, r.flags_json, r.note, r.reviewer, r.reviewed_at, r.created_at, r.updated_at
    FROM competition_reviews r JOIN players p ON p.id = r.player_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY r.created_at ASC LIMIT 500`;
  const result = await db.prepare(query).bind(...values).all();
  return json({ reviews: result.results ?? [] });
}

async function updateCashReview(request: Request, env: ApiEnv, reviewID: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: 32_000, requireApplicationJSON: true });
  const status = cashReviewStatus(payload.status);
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2_000) : "";
  if (!note) throw new ApiError(400, "review_note_required", "A review decision note is required.");
  const db = database(env);
  const row = await db.prepare(`SELECT id, attempt_id FROM competition_reviews WHERE id = ?1 LIMIT 1`).bind(reviewID).first<{ id: string; attempt_id: string }>();
  if (!row) throw new ApiError(404, "review_not_found", "The cash review was not found.");
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE competition_reviews SET status = ?1, note = ?2, reviewer = ?3, reviewed_at = ?4, updated_at = ?4 WHERE id = ?5`).bind(status, note, authorization.publishedBy, now, reviewID),
    db.prepare(`UPDATE attempts SET integrity_status = ?1, score_status = CASE WHEN ?1 = 'cleared' THEN 'confirmed' WHEN ?1 = 'voided' THEN 'voided' ELSE score_status END, status = CASE WHEN ?1 = 'voided' THEN 'voided' ELSE status END, updated_at = ?2 WHERE id = ?3`).bind(status === "cleared" ? "passed" : status === "voided" ? "failed" : "review", now, row.attempt_id),
  ]);
  return json({ updated: true, review_id: reviewID, status });
}

async function listCashPayouts(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const competitionID = new URL(request.url).searchParams.get("competition_id")?.trim() ?? "";
  const db = database(env);
  const result = await db.prepare(`SELECT p.*, pl.public_handle
    FROM competition_payouts p JOIN players pl ON pl.id = p.player_id
    ${competitionID ? "WHERE p.competition_id = ?1" : ""}
    ORDER BY p.place ASC, p.created_at ASC LIMIT 500`).bind(...(competitionID ? [competitionID] : [])).all();
  return json({ payouts: result.results ?? [] });
}

async function createCashPayout(request: Request, env: ApiEnv): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
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
    cp.amount_minor AS configured_amount
    FROM attempts a JOIN competition_reviews r ON r.attempt_id = a.id
    JOIN competition_prizes cp ON cp.competition_id = a.competition_id AND cp.place = ?3
    WHERE a.id = ?1 AND a.competition_id = ?2 LIMIT 1`).bind(attemptID, competitionID, place).first<{ player_id: string; competition_id: string; status: string; score_status: string; review_status: CashReviewStatus; configured_amount: number }>();
  if (!row || row.status === "voided" || row.score_status !== "confirmed" || row.review_status !== "cleared") throw new ApiError(409, "payout_not_ready", "Only a confirmed, cleared winner can receive a payout record.");
  if (row.configured_amount !== amountMinor) throw new ApiError(409, "payout_amount_mismatch", "The payout amount does not match the published prize configuration.");
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO competition_payouts (id, competition_id, attempt_id, player_id, place, amount_minor, currency, status, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?9)`).bind(id, competitionID, attemptID, row.player_id, place, amountMinor, currency, authorization.publishedBy, now),
    db.prepare(`INSERT INTO competition_payout_audit (id, payout_id, action, actor, note, details_json, changed_at) VALUES (?1, ?2, 'created', ?3, ?4, '{}', ?5)`).bind(crypto.randomUUID(), id, authorization.publishedBy, "Payout record created after winner review.", now),
  ]);
  return json({ created: true, payout_id: id, status: "pending" }, 201);
}

async function updateCashPayout(request: Request, env: ApiEnv, payoutID: string): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  assertContentAdminOrigin(request, authorization);
  const payload = await readJsonObject(request, { maximumBytes: 16_000, requireApplicationJSON: true });
  const status = cashPayoutStatus(payload.status);
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 2_000) : "";
  if (!note) throw new ApiError(400, "payout_note_required", "A payout status note is required.");
  const transferReference = typeof payload.transfer_reference === "string" ? payload.transfer_reference.trim().slice(0, 160) : null;
  if (status === "sent" && !transferReference) throw new ApiError(400, "transfer_reference_required", "A completed transfer requires its provider reference.");
  const db = database(env);
  const row = await db.prepare(`SELECT id, status, created_by, approved_by FROM competition_payouts WHERE id = ?1 LIMIT 1`).bind(payoutID).first<{ id: string; status: CashPayoutStatus; created_by: string; approved_by: string | null }>();
  if (!row) throw new ApiError(404, "payout_not_found", "The payout record was not found.");
  if (status === "approved" && row.created_by === authorization.publishedBy) throw new ApiError(409, "second_approver_required", "A different authorized operator must approve the payout.");
  if (status === "sent" && row.approved_by === authorization.publishedBy) throw new ApiError(409, "different_sender_required", "A different authorized operator must release the approved payout.");
  const now = Date.now();
  const approvedAt = status === "approved" ? now : null;
  const sentAt = status === "sent" ? now : null;
  await db.batch([
    db.prepare(`UPDATE competition_payouts SET status = ?1, transfer_reference = COALESCE(?2, transfer_reference), failure_reason = CASE WHEN ?1 = 'failed' THEN ?3 ELSE failure_reason END, approved_by = CASE WHEN ?1 = 'approved' THEN ?4 ELSE approved_by END, approved_at = CASE WHEN ?1 = 'approved' THEN ?5 ELSE approved_at END, sent_by = CASE WHEN ?1 = 'sent' THEN ?4 ELSE sent_by END, sent_at = CASE WHEN ?1 = 'sent' THEN ?5 ELSE sent_at END, updated_at = ?5 WHERE id = ?6`).bind(status, transferReference, note, authorization.publishedBy, approvedAt ?? sentAt ?? now, payoutID),
    db.prepare(`INSERT INTO competition_payout_audit (id, payout_id, action, actor, note, details_json, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`).bind(crypto.randomUUID(), payoutID, status, authorization.publishedBy, note, JSON.stringify(transferReference ? { transfer_reference: transferReference } : {}), now),
  ]);
  return json({ updated: true, payout_id: payoutID, status });
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
  if (path === "/api/v1/app-config") {
    assertMethod(request, "GET");
    return currentAppConfig(request, env);
  }
  if (path === "/api/v1/admin/content/session") {
    assertMethod(request, "GET");
    return contentAdminSession(request, env);
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
  const cashReviewMatch = /^\/api\/v1\/admin\/cash\/reviews\/([^/]+)$/.exec(path);
  if (cashReviewMatch) {
    assertMethod(request, "POST");
    return updateCashReview(request, env, decodeURIComponent(cashReviewMatch[1]));
  }
  if (path === "/api/v1/admin/cash/payouts" && request.method === "GET") {
    return listCashPayouts(request, env);
  }
  if (path === "/api/v1/admin/cash/payouts" && request.method === "POST") {
    return createCashPayout(request, env);
  }
  const cashPayoutMatch = /^\/api\/v1\/admin\/cash\/payouts\/([^/]+)\/status$/.exec(path);
  if (cashPayoutMatch) {
    assertMethod(request, "POST");
    return updateCashPayout(request, env, decodeURIComponent(cashPayoutMatch[1]));
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
    return currentCompetition(env);
  }

  const startMatch = /^\/api\/v1\/competitions\/([^/]+)\/attempts$/.exec(path);
  if (startMatch) {
    assertMethod(request, "POST");
    return startAttempt(request, env, decodeURIComponent(startMatch[1]));
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
  const cashAnswerMatch = /^\/api\/v1\/attempts\/([^/]+)\/cash-answer$/.exec(path);
  if (cashAnswerMatch) {
    assertMethod(request, "POST");
    return answerCashAttempt(request, env, decodeURIComponent(cashAnswerMatch[1]));
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
