import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    publicHandle: text("public_handle").notNull(),
    accountState: text("account_state").notNull().default("guest"),
    phoneLookupHash: text("phone_lookup_hash"),
    phoneVerifiedAt: integer("phone_verified_at"),
    eligibilityStatus: text("eligibility_status").notNull().default("guest"),
    acceptedRulesVersion: text("accepted_rules_version"),
    eligibilityAttestedAt: integer("eligibility_attested_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("players_public_handle_unique").on(table.publicHandle),
    uniqueIndex("players_phone_lookup_hash_unique").on(table.phoneLookupHash),
    check(
      "players_account_state_check",
      sql`${table.accountState} in ('guest', 'phone_verified', 'suspended')`,
    ),
    check(
      "players_eligibility_status_check",
      sql`${table.eligibilityStatus} in ('guest', 'pending', 'eligible', 'ineligible', 'suspended')`,
    ),
  ],
);

export const playerSessions = sqliteTable(
  "player_sessions",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    platform: text("platform").notNull(),
    appVersion: text("app_version"),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    lastSeenAt: integer("last_seen_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("player_sessions_token_hash_unique").on(table.tokenHash),
    index("player_sessions_player_id_idx").on(table.playerId),
    index("player_sessions_expiry_idx").on(table.expiresAt),
    check(
      "player_sessions_platform_check",
      sql`${table.platform} in ('ios', 'android', 'web', 'unknown')`,
    ),
  ],
);

export const competitions = sqliteTable(
  "competitions",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    contentStatus: text("content_status").notNull().default("draft"),
    rulesVersion: text("rules_version").notNull(),
    packVersion: text("pack_version").notNull(),
    scoringVersion: text("scoring_version").notNull().default("accuracy-time-v1"),
    questionCount: integer("question_count").notNull().default(12),
    perCardLimitMs: integer("per_card_limit_ms").notNull().default(12000),
    uploadGraceMs: integer("upload_grace_ms").notNull().default(15000),
    entryMode: text("entry_mode").notNull().default("phone_verified"),
    countryCode: text("country_code").notNull().default("NG"),
    minimumAge: integer("minimum_age").notNull().default(18),
    currency: text("currency").notNull().default("NGN"),
    opensAt: integer("opens_at").notNull(),
    closesAt: integer("closes_at").notNull(),
    scoreReviewClosesAt: integer("score_review_closes_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("competitions_slug_unique").on(table.slug),
    index("competitions_current_idx").on(
      table.status,
      table.contentStatus,
      table.opensAt,
      table.closesAt,
    ),
    check(
      "competitions_status_check",
      sql`${table.status} in ('draft', 'scheduled', 'open', 'locked', 'final', 'cancelled')`,
    ),
    check(
      "competitions_content_status_check",
      sql`${table.contentStatus} in ('draft', 'in_review', 'approved', 'published')`,
    ),
    check(
      "competitions_entry_mode_check",
      sql`${table.entryMode} in ('guest', 'account', 'phone_verified')`,
    ),
    check("competitions_question_count_check", sql`${table.questionCount} > 0`),
    check("competitions_card_limit_check", sql`${table.perCardLimitMs} > 0`),
    check("competitions_schedule_check", sql`${table.closesAt} > ${table.opensAt}`),
  ],
);

export const competitionPrizes = sqliteTable(
  "competition_prizes",
  {
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    place: integer("place").notNull(),
    amountMinor: integer("amount_minor").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.competitionId, table.place] }),
    check("competition_prizes_place_check", sql`${table.place} > 0`),
    check("competition_prizes_amount_check", sql`${table.amountMinor} > 0`),
  ],
);

export const competitionCards = sqliteTable(
  "competition_cards",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    sourceCardId: text("source_card_id").notNull(),
    position: integer("position").notNull(),
    contentVersion: text("content_version").notNull(),
    category: text("category").notNull(),
    answerFamily: text("answer_family").notNull(),
    cluesJson: text("clues_json").notNull(),
    correctOptionId: text("correct_option_id").notNull(),
    difficulty: text("difficulty").notNull().default("standard"),
    editorialStatus: text("editorial_status").notNull().default("draft"),
    verificationNote: text("verification_note"),
    sourceUrlsJson: text("source_urls_json").notNull().default("[]"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: integer("reviewed_at"),
    voidedAt: integer("voided_at"),
    voidReason: text("void_reason"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("competition_cards_position_unique").on(
      table.competitionId,
      table.position,
    ),
    uniqueIndex("competition_cards_source_unique").on(
      table.competitionId,
      table.sourceCardId,
    ),
    index("competition_cards_pack_idx").on(
      table.competitionId,
      table.editorialStatus,
      table.position,
    ),
    check("competition_cards_position_check", sql`${table.position} > 0`),
    check(
      "competition_cards_difficulty_check",
      sql`${table.difficulty} in ('standard', 'hard')`,
    ),
    check(
      "competition_cards_editorial_status_check",
      sql`${table.editorialStatus} in ('draft', 'in_review', 'approved', 'rejected', 'voided')`,
    ),
  ],
);

export const competitionCardOptions = sqliteTable(
  "competition_card_options",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => competitionCards.id, { onDelete: "cascade" }),
    optionId: text("option_id").notNull(),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    category: text("category").notNull(),
    answerFamily: text("answer_family").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.optionId] }),
    uniqueIndex("competition_card_options_position_unique").on(
      table.cardId,
      table.position,
    ),
    check("competition_card_options_position_check", sql`${table.position} > 0`),
  ],
);

export const attempts = sqliteTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "restrict" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    attemptTokenHash: text("attempt_token_hash").notNull(),
    status: text("status").notNull().default("started"),
    rulesVersion: text("rules_version").notNull(),
    packVersion: text("pack_version").notNull(),
    packHash: text("pack_hash"),
    scoringVersion: text("scoring_version").notNull(),
    startedAt: integer("started_at").notNull(),
    playDeadlineAt: integer("play_deadline_at").notNull(),
    submitDeadlineAt: integer("submit_deadline_at").notNull(),
    submittedAt: integer("submitted_at"),
    clientActiveMs: integer("client_active_ms"),
    serverElapsedMs: integer("server_elapsed_ms"),
    adjustedTotalMs: integer("adjusted_total_ms"),
    correctCount: integer("correct_count"),
    hardCardMs: integer("hard_card_ms"),
    integrityStatus: text("integrity_status").notNull().default("pending"),
    integrityFlagsJson: text("integrity_flags_json").notNull().default("[]"),
    submissionHash: text("submission_hash"),
    scoreStatus: text("score_status").notNull().default("unscored"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("attempts_one_per_player_competition").on(
      table.competitionId,
      table.playerId,
    ),
    uniqueIndex("attempts_token_hash_unique").on(table.attemptTokenHash),
    index("attempts_player_idx").on(table.playerId, table.createdAt),
    index("attempts_leaderboard_idx").on(
      table.competitionId,
      table.scoreStatus,
      table.correctCount,
      table.adjustedTotalMs,
      table.hardCardMs,
    ),
    check(
      "attempts_status_check",
      sql`${table.status} in ('started', 'submitted', 'expired', 'voided')`,
    ),
    check(
      "attempts_integrity_status_check",
      sql`${table.integrityStatus} in ('pending', 'review', 'passed', 'failed')`,
    ),
    check(
      "attempts_score_status_check",
      sql`${table.scoreStatus} in ('unscored', 'provisional', 'confirmed', 'voided')`,
    ),
  ],
);

export const attemptAnswers = sqliteTable(
  "attempt_answers",
  {
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    cardId: text("card_id")
      .notNull()
      .references(() => competitionCards.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    selectedOptionId: text("selected_option_id").notNull(),
    clientResponseMs: integer("client_response_ms").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
    answerVersion: text("answer_version").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.attemptId, table.cardId] }),
    uniqueIndex("attempt_answers_ordinal_unique").on(
      table.attemptId,
      table.ordinal,
    ),
    index("attempt_answers_card_idx").on(table.cardId),
    check("attempt_answers_ordinal_check", sql`${table.ordinal} > 0`),
    check("attempt_answers_response_ms_check", sql`${table.clientResponseMs} >= 0`),
  ],
);

export const scoreChallenges = sqliteTable(
  "score_challenges",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "restrict" }),
    cardId: text("card_id").references(() => competitionCards.id, {
      onDelete: "restrict",
    }),
    kind: text("kind").notNull(),
    statement: text("statement").notNull(),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    resolvedBy: text("resolved_by"),
    resolvedAt: integer("resolved_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("score_challenges_queue_idx").on(
      table.competitionId,
      table.status,
      table.createdAt,
    ),
    index("score_challenges_player_idx").on(table.playerId, table.createdAt),
    check(
      "score_challenges_kind_check",
      sql`${table.kind} in ('card_answer', 'timer', 'score', 'other')`,
    ),
    check(
      "score_challenges_status_check",
      sql`${table.status} in ('open', 'under_review', 'upheld', 'rejected', 'withdrawn')`,
    ),
  ],
);

export const contentReleases = sqliteTable(
  "content_releases",
  {
    id: text("id").primaryKey(),
    revision: integer("revision").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    status: text("status").notNull().default("published"),
    effectiveWeekWat: text("effective_week_wat").notNull(),
    effectiveFromMs: integer("effective_from_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    minimumAppVersion: text("minimum_app_version").notNull().default("1.0.0"),
    sponsorKind: text("sponsor_kind"),
    sponsorName: text("sponsor_name"),
    sponsorMessage: text("sponsor_message"),
    publishedBy: text("published_by").notNull(),
    publishedAt: integer("published_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("content_releases_revision_unique").on(table.revision),
    index("content_releases_active_idx").on(
      table.status,
      table.effectiveFromMs,
      table.expiresAtMs,
      table.revision,
    ),
    index("content_releases_week_idx").on(
      table.effectiveWeekWat,
      table.status,
      table.revision,
    ),
    check("content_releases_revision_check", sql`${table.revision} > 0`),
    check("content_releases_schema_check", sql`${table.schemaVersion} > 0`),
    check(
      "content_releases_status_check",
      sql`${table.status} in ('published', 'superseded', 'revoked')`,
    ),
    check(
      "content_releases_schedule_check",
      sql`${table.expiresAtMs} > ${table.effectiveFromMs}`,
    ),
    check(
      "content_releases_sponsor_kind_check",
      sql`${table.sponsorKind} is null or ${table.sponsorKind} in ('commercial', 'prizeFunding')`,
    ),
  ],
);

export const contentAssets = sqliteTable(
  "content_assets",
  {
    releaseId: text("release_id")
      .notNull()
      .references(() => contentReleases.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    contentVersion: text("content_version").notNull(),
    sha256: text("sha256").notNull(),
    byteCount: integer("byte_count").notNull(),
    itemCount: integer("item_count").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.releaseId, table.kind] }),
    index("content_assets_hash_idx").on(table.sha256),
    index("content_assets_release_idx").on(table.releaseId, table.kind),
    check(
      "content_assets_kind_check",
      sql`${table.kind} in ('party_deck', 'solo_gist')`,
    ),
    check("content_assets_bytes_check", sql`${table.byteCount} > 0`),
    check("content_assets_items_check", sql`${table.itemCount} > 0`),
  ],
);
