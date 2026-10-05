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

/**
 * A device-level delivery registration, not a marketing profile. The raw APNs
 * or FCM token is encrypted before it reaches D1; its hash supports idempotent
 * upserts and deletion without returning the token to a client.
 */
export const notificationDevices = sqliteTable(
  "notification_devices",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    leagueUpdatesEnabled: integer("league_updates_enabled")
      .notNull()
      .default(0),
    friendInvitesEnabled: integer("friend_invites_enabled")
      .notNull()
      .default(0),
    offersEnabled: integer("offers_enabled").notNull().default(0),
    consentedAt: integer("consented_at").notNull(),
    lastRegisteredAt: integer("last_registered_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("notification_devices_platform_token_unique").on(
      table.platform,
      table.tokenHash,
    ),
    index("notification_devices_player_idx").on(table.playerId, table.updatedAt),
    check(
      "notification_devices_platform_check",
      sql`${table.platform} in ('ios', 'android')`,
    ),
    check(
      "notification_devices_preference_check",
      sql`${table.leagueUpdatesEnabled} in (0, 1)
        and ${table.friendInvitesEnabled} in (0, 1)
        and ${table.offersEnabled} in (0, 1)`,
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
    // Practice may receive the full preview pack. A future cash attempt must
    // be explicitly created with the sequential protocol below; it may never
    // inherit the practice batch behaviour by accident.
    deliveryProtocol: text("delivery_protocol")
      .notNull()
      .default("practice_batch_v1"),
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
    check(
      "attempts_delivery_protocol_check",
      sql`${table.deliveryProtocol} in ('practice_batch_v1', 'cash_sequential_v1')`,
    ),
  ],
);

/**
 * Immutable audit trail for a future cash attempt's one-at-a-time card
 * delivery. The service writes these times; the player never submits them.
 * This table intentionally holds no card text or answer key.
 */
export const attemptCardIssues = sqliteTable(
  "attempt_card_issues",
  {
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    cardId: text("card_id")
      .notNull()
      .references(() => competitionCards.id, { onDelete: "restrict" }),
    issuedAt: integer("issued_at").notNull(),
    answeredAt: integer("answered_at"),
  },
  (table) => [
    primaryKey({ columns: [table.attemptId, table.ordinal] }),
    uniqueIndex("attempt_card_issues_card_unique").on(table.attemptId, table.cardId),
    index("attempt_card_issues_attempt_idx").on(table.attemptId, table.issuedAt),
    check("attempt_card_issues_ordinal_check", sql`${table.ordinal} > 0`),
    check(
      "attempt_card_issues_answer_time_check",
      sql`${table.answeredAt} is null or ${table.answeredAt} >= ${table.issuedAt}`,
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

export const competitionReviews = sqliteTable(
  "competition_reviews",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "restrict" }),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "restrict" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("queued"),
    riskScore: integer("risk_score").notNull().default(0),
    flagsJson: text("flags_json").notNull().default("[]"),
    note: text("note"),
    reviewer: text("reviewer"),
    reviewedAt: integer("reviewed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("competition_reviews_attempt_unique").on(table.attemptId),
    index("competition_reviews_queue_idx").on(table.competitionId, table.status, table.createdAt),
    check("competition_reviews_status_check", sql`${table.status} in ('queued', 'in_review', 'cleared', 'voided')`),
    check("competition_reviews_risk_score_check", sql`${table.riskScore} between 0 and 100`),
  ],
);

export const partyDeckEditorState = sqliteTable(
  "party_deck_editor_state",
  {
    id: text("id").primaryKey(),
    cardsJson: text("cards_json").notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
);

export const competitionPayouts = sqliteTable(
  "competition_payouts",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "restrict" }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "restrict" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    place: integer("place").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("pending"),
    transferReference: text("transfer_reference"),
    failureReason: text("failure_reason"),
    createdBy: text("created_by").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: integer("approved_at"),
    sentBy: text("sent_by"),
    sentAt: integer("sent_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("competition_payouts_attempt_unique").on(table.attemptId),
    uniqueIndex("competition_payouts_place_unique").on(table.competitionId, table.place),
    index("competition_payouts_status_idx").on(table.competitionId, table.status, table.createdAt),
    check("competition_payouts_place_check", sql`${table.place} > 0`),
    check("competition_payouts_amount_check", sql`${table.amountMinor} > 0`),
    check("competition_payouts_status_check", sql`${table.status} in ('pending', 'approved', 'sent', 'failed', 'cancelled')`),
  ],
);

export const competitionPayoutAudit = sqliteTable(
  "competition_payout_audit",
  {
    id: text("id").primaryKey(),
    payoutId: text("payout_id")
      .notNull()
      .references(() => competitionPayouts.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    note: text("note").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
    changedAt: integer("changed_at").notNull(),
  },
  (table) => [index("competition_payout_audit_idx").on(table.payoutId, table.changedAt)],
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

export const contentReleaseAudit = sqliteTable(
  "content_release_audit",
  {
    id: text("id").primaryKey(),
    releaseId: text("release_id").notNull().references(() => contentReleases.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    changedAt: integer("changed_at").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
  },
  (table) => [index("content_release_audit_release_idx").on(table.releaseId, table.changedAt)],
);

export const appConfigRevisions = sqliteTable(
  "app_config_revisions",
  {
    id: text("id").primaryKey(),
    revision: integer("revision").notNull(),
    status: text("status").notNull().default("draft"),
    configJson: text("config_json").notNull(),
    createdBy: text("created_by").notNull(),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
    publishedAt: integer("published_at"),
  },
  (table) => [
    uniqueIndex("app_config_revisions_revision_unique").on(table.revision),
    index("app_config_revisions_public_idx").on(table.status, table.revision),
    check("app_config_revisions_status_check", sql`${table.status} in ('draft', 'review', 'published', 'rolled_back', 'revoked', 'disabled')`),
  ],
);

export const appConfigAudit = sqliteTable(
  "app_config_audit",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id").notNull().references(() => appConfigRevisions.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    changedAt: integer("changed_at").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
  },
  (table) => [index("app_config_audit_revision_idx").on(table.revisionId, table.changedAt)],
);
