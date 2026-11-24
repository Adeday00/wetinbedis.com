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

export const ownerCardPreviewTokens = sqliteTable(
  "owner_card_preview_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (table) => [index("owner_card_preview_tokens_active_idx").on(table.revokedAt, table.createdAt)],
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
 * A privacy request is a workflow record, not the underlying identity or
 * payout evidence. Completion is an operator decision because prize, fraud,
 * dispute, and accounting holds can lawfully delay a deletion.
 */
export const privacyRequests = sqliteTable(
  "privacy_requests",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    requestType: text("request_type").notNull(),
    status: text("status").notNull().default("queued"),
    statement: text("statement").notNull(),
    operatorNote: text("operator_note"),
    handledBy: text("handled_by"),
    handledAt: integer("handled_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("privacy_requests_player_idx").on(table.playerId, table.createdAt),
    index("privacy_requests_status_idx").on(table.status, table.createdAt),
    check(
      "privacy_requests_type_check",
      sql`${table.requestType} in ('access', 'correction', 'deletion')`,
    ),
    check(
      "privacy_requests_status_check",
      sql`${table.status} in ('queued', 'in_review', 'completed', 'denied', 'withdrawn')`,
    ),
  ],
);

/**
 * Restricted operational decisions. A verified phone and player attestation
 * place a player in `pending`; only a documented review can grant cash
 * eligibility. Identity and payout documents never belong in this database.
 */
export const playerEligibilityReviews = sqliteTable(
  "player_eligibility_reviews",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    rulesVersion: text("rules_version").notNull(),
    countryCode: text("country_code").notNull(),
    note: text("note").notNull(),
    reviewer: text("reviewer").notNull(),
    reviewedAt: integer("reviewed_at").notNull(),
  },
  (table) => [
    index("player_eligibility_reviews_player_idx").on(table.playerId, table.reviewedAt),
    check(
      "player_eligibility_reviews_status_check",
      sql`${table.status} in ('eligible', 'ineligible', 'suspended')`,
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
    /** ISO-3166 alpha-2 countries allowed to enter; legacy countryCode is retained for compatibility. */
    eligibleCountriesJson: text("eligible_countries_json").notNull().default('["NG"]'),
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
    check("competition_payouts_currency_check", sql`${table.currency} = 'NGN'`),
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

/**
 * A deliberately non-payable record used only by the private League rehearsal.
 * It keeps enough information to QA the winner handoff without retaining an
 * account number or creating a record the payout operations flow can process.
 */
export const rehearsalPayoutPreviews = sqliteTable(
  "rehearsal_payout_previews",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "restrict" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    rankAtSubmission: integer("rank_at_submission").notNull(),
    displayName: text("display_name").notNull(),
    bankLabel: text("bank_label").notNull(),
    accountLast4: text("account_last4").notNull(),
    countryCode: text("country_code").notNull(),
    submittedAt: integer("submitted_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("rehearsal_payout_previews_player_unique").on(table.competitionId, table.playerId),
    index("rehearsal_payout_previews_queue_idx").on(table.competitionId, table.rankAtSubmission, table.submittedAt),
    check("rehearsal_payout_previews_rank_check", sql`${table.rankAtSubmission} between 1 and 3`),
    check("rehearsal_payout_previews_last4_check", sql`length(${table.accountLast4}) = 4`),
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
    sponsorCampaignTitle: text("sponsor_campaign_title"),
    sponsorLogoUrl: text("sponsor_logo_url"),
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

/**
 * Cash cannot be enabled by a single flag. Each required launch gate needs a
 * reviewed evidence reference before the Worker will accept a public cash
 * attempt. References must point to restricted evidence, never contain it.
 */
export const cashLaunchGates = sqliteTable(
  "cash_launch_gates",
  {
    gateKey: text("gate_key").primaryKey(),
    status: text("status").notNull().default("pending"),
    evidenceReference: text("evidence_reference"),
    note: text("note"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: integer("reviewed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "cash_launch_gates_status_check",
      sql`${table.status} in ('pending', 'passed', 'failed')`,
    ),
  ],
);

/** Immutable history of every cash-launch gate decision. */
export const cashLaunchGateAudit = sqliteTable(
  "cash_launch_gate_audit",
  {
    id: text("id").primaryKey(),
    gateKey: text("gate_key").notNull(),
    status: text("status").notNull(),
    evidenceReference: text("evidence_reference"),
    note: text("note").notNull(),
    reviewedBy: text("reviewed_by").notNull(),
    changedAt: integer("changed_at").notNull(),
  },
  (table) => [
    index("cash_launch_gate_audit_gate_changed_idx").on(table.gateKey, table.changedAt),
    check(
      "cash_launch_gate_audit_status_check",
      sql`${table.status} in ('pending', 'passed', 'failed')`,
    ),
  ],
);

export const competitionEligibilityPolicyAudit = sqliteTable(
  "competition_eligibility_policy_audit",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id").notNull().references(() => competitions.id, { onDelete: "restrict" }),
    eligibleCountriesJson: text("eligible_countries_json").notNull(),
    actor: text("actor").notNull(),
    note: text("note").notNull(),
    changedAt: integer("changed_at").notNull(),
  },
  (table) => [index("competition_eligibility_policy_audit_competition_idx").on(table.competitionId, table.changedAt)],
);

export const googleReviewAccess = sqliteTable("google_review_access", {
  playerId: text("player_id").primaryKey().references(() => players.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  grantedAt: integer("granted_at").notNull(),
});

export const googlePlayPurchases = sqliteTable(
  "google_play_purchases",
  {
    tokenHash: text("token_hash").primaryKey(),
    playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    packageName: text("package_name").notNull(),
    orderId: text("order_id"),
    purchaseState: integer("purchase_state").notNull(),
    acknowledgedAt: integer("acknowledged_at"),
    verifiedAt: integer("verified_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("google_play_purchases_player_idx").on(table.playerId, table.productId),
    uniqueIndex("google_play_purchases_order_unique").on(table.orderId),
  ],
);

export const playerEntitlements = sqliteTable(
  "player_entitlements",
  {
    playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    source: text("source").notNull(),
    active: integer("active").notNull().default(1),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.playerId, table.productId] }),
    index("player_entitlements_active_idx").on(table.playerId, table.active),
    check("player_entitlements_active_check", sql`${table.active} in (0, 1)`),
  ],
);

/**
 * Verified App Attest public keys. The private key never leaves the iPhone;
 * the server persists only the public key material and monotonic assertion
 * counter.
 */
export const appAttestKeys = sqliteTable(
  "app_attest_keys",
  {
    keyId: text("key_id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    appId: text("app_id").notNull(),
    environment: text("environment").notNull(),
    publicKeyPem: text("public_key_pem").notNull(),
    assertionCounter: integer("assertion_counter").notNull().default(0),
    receiptB64: text("receipt_b64"),
    attestedAt: integer("attested_at").notNull(),
    lastVerifiedAt: integer("last_verified_at").notNull(),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("app_attest_keys_player_idx").on(table.playerId, table.revokedAt),
    index("app_attest_keys_active_idx").on(
      table.appId,
      table.environment,
      table.revokedAt,
      table.lastVerifiedAt,
    ),
    check(
      "app_attest_keys_environment_check",
      sql`${table.environment} in ('development', 'production')`,
    ),
    check("app_attest_keys_counter_check", sql`${table.assertionCounter} >= 0`),
  ],
);

/**
 * Short-lived, single-use nonces for App Attest registration and cash answers.
 * The Worker derives every protected request binding itself; the app never
 * chooses a challenge or its expiry.
 */
export const appAttestChallenges = sqliteTable(
  "app_attest_challenges",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    keyId: text("key_id").references(() => appAttestKeys.keyId, {
      onDelete: "restrict",
    }),
    purpose: text("purpose").notNull(),
    challengeB64: text("challenge_b64").notNull(),
    requestBindingHash: text("request_binding_hash"),
    cardOrdinal: integer("card_ordinal"),
    issuedAt: integer("issued_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("app_attest_challenges_active_idx").on(
      table.attemptId,
      table.purpose,
      table.cardOrdinal,
      table.expiresAt,
      table.consumedAt,
    ),
    index("app_attest_challenges_expiry_idx").on(
      table.expiresAt,
      table.consumedAt,
    ),
    check(
      "app_attest_challenges_purpose_check",
      sql`${table.purpose} in ('registration', 'cash_answer')`,
    ),
    check(
      "app_attest_challenges_expiry_check",
      sql`${table.expiresAt} > ${table.issuedAt}`,
    ),
    check(
      "app_attest_challenges_ordinal_check",
      sql`${table.cardOrdinal} is null or ${table.cardOrdinal} > 0`,
    ),
  ],
);

export const attemptDeviceBindings = sqliteTable("attempt_device_bindings", {
  attemptId: text("attempt_id").primaryKey().references(() => attempts.id, { onDelete: "cascade" }),
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), registeredAt: integer("registered_at").notNull(),
}, (t) => [check("attempt_device_binding_platform_check", sql`${t.platform} in ('ios-app-attest', 'android-play-integrity')`)]);

export const androidIntegrityChallenges = sqliteTable("android_integrity_challenges", {
  id: text("id").primaryKey(), playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  attemptId: text("attempt_id").notNull().references(() => attempts.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), nonce: text("nonce").notNull(), requestHash: text("request_hash").notNull(),
  cardOrdinal: integer("card_ordinal"), selectedOptionId: text("selected_option_id"), issuedAt: integer("issued_at").notNull(),
  expiresAt: integer("expires_at").notNull(), consumedAt: integer("consumed_at"), tokenHash: text("token_hash"),
}, (t) => [index("android_integrity_challenges_active_idx").on(t.attemptId, t.purpose, t.cardOrdinal, t.expiresAt, t.consumedAt),
  uniqueIndex("android_integrity_token_replay_idx").on(t.tokenHash).where(sql`${t.tokenHash} is not null`),
  check("android_integrity_purpose_check", sql`${t.purpose} in ('registration', 'cash_answer')`),
  check("android_integrity_expiry_check", sql`${t.expiresAt} > ${t.issuedAt}`),
  check("android_integrity_ordinal_check", sql`(${t.purpose} = 'registration' and ${t.cardOrdinal} is null and ${t.selectedOptionId} is null) or (${t.purpose} = 'cash_answer' and ${t.cardOrdinal} > 0)`)]);

export const androidIntegrityVerifications = sqliteTable("android_integrity_verifications", {
  attemptId: text("attempt_id").primaryKey().references(() => attempts.id, { onDelete: "cascade" }),
  playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  packageName: text("package_name").notNull(), versionCode: text("version_code").notNull(), certificatesJson: text("certificates_json").notNull(),
  registeredAt: integer("registered_at").notNull(), lastVerifiedAt: integer("last_verified_at").notNull(),
});

export const picsPackState = sqliteTable("pics_pack_state", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull(),
  contentVersion: text("content_version").notNull(),
  packJson: text("pack_json").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  check("pics_pack_state_id_check", sql`${table.id} = 'current'`),
  check("pics_pack_state_revision_check", sql`${table.revision} > 0`),
]);
