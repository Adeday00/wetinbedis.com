import {
  API_VERSION,
  CompetitionDomainError,
  canonicalCompetitionPack,
  canonicalSubmission,
  publicCompetitionCard,
  rankLeaderboard,
  scoreSubmission,
  validateCompetitionPack,
  type CompetitionCard,
  type LeaderboardScore,
  type SubmittedAnswer,
} from "./domain";
import { createOpaqueToken, sha256Hex } from "./crypto";
import { getPhoneVerificationProvider } from "./phone-verification";
import bundledPublicRelease from "../../content/releases/2026-W35-r1.json";
import bundledCompetitionPractice from "../../content/competition-practice-fixture.json";
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

export interface ApiEnv {
  DB?: D1Database;
  WBD_CONTENT_ADMIN_TOKEN?: string;
  WBD_CONTENT_ADMIN_USER_IDS?: string;
  WBD_CONTENT_ADMIN_EMAILS?: string;
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
  if (
    !CASH_PRIZE_ATTEMPTS_AVAILABLE
    && (configuredPrizes.length > 0 || competition.entry_mode !== "guest")
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
  const startedAt = Date.now();
  const playDeadlineAt =
    startedAt + competition.question_count * competition.per_card_limit_ms;
  const submitDeadlineAt = playDeadlineAt + competition.upload_grace_ms;

  try {
    await db
      .prepare(
        `INSERT INTO attempts (
          id, competition_id, player_id, attempt_token_hash, status,
          rules_version, pack_version, pack_hash, scoring_version,
          started_at, play_deadline_at, submit_deadline_at,
          integrity_status, score_status, created_at, updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, 'started',
          ?5, ?6, ?7, ?8,
          ?9, ?10, ?11,
          'pending', 'unscored', ?9, ?9
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
        startedAt,
        playDeadlineAt,
        submitDeadlineAt,
      )
      .run();
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
        started_at: startedAt,
        play_deadline_at: playDeadlineAt,
        submit_deadline_at: submitDeadlineAt,
        cards: cards.map((card) =>
          publicCompetitionCard(card, competition.per_card_limit_ms),
        ),
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
        a.pack_hash, a.scoring_version,
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

async function leaderboard(env: ApiEnv, competitionId: string): Promise<Response> {
  const db = database(env);
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
  return json({ valid: true, release: contentReleaseSummary(validation.release) });
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

async function contentAdminSession(
  request: Request,
  env: ApiEnv,
): Promise<Response> {
  const authorization = await authorizeContentAdmin(request, env);
  return json({ authorized: true, method: authorization.method });
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
  if (path === "/api/v1/admin/content/session") {
    assertMethod(request, "GET");
    return contentAdminSession(request, env);
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
    return leaderboard(env, decodeURIComponent(leaderboardMatch[1]));
  }
  const submitMatch = /^\/api\/v1\/attempts\/([^/]+)\/submit$/.exec(path);
  if (submitMatch) {
    assertMethod(request, "POST");
    return submitAttempt(request, env, decodeURIComponent(submitMatch[1]));
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
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
