/**
 * Shared, platform-neutral room contract for Play on a Call.
 *
 * Discord, WhatsApp, FaceTime audio, or another calling app carries the
 * conversation. This protocol carries only Wetin Be Dis room state. Keep it
 * deliberately free of call-app APIs, card text, League scoring, purchases,
 * advertising identifiers, email, and phone data so iOS and Android can use
 * the exact same native contract.
 */

export const PLAY_ON_CALL_PROTOCOL_VERSION = 2;
export const PLAY_ON_CALL_ROOM_TTL_MS = 4 * 60 * 60 * 1000;
export const PLAY_ON_CALL_TICKET_TTL_MS = 2 * 60 * 1000;
export const PLAY_ON_CALL_MAX_PARTICIPANTS = 12;
// Match House Party: every new room uses a four-digit numeric code. Keep
// accepting the previous six- and eight-character formats so an app update
// never strands a room that was already open.
export const PLAY_ON_CALL_ROOM_CODE_LENGTH = 4;
export const PLAY_ON_CALL_LEGACY_ROOM_CODE_LENGTHS = [6, 8] as const;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DISPLAY_NAME_MAX_LENGTH = 24;
// A game configuration carries stable card IDs (never card text). The larger
// bound is enough for the reviewed deck while remaining safely below the
// Durable Object WebSocket frame limit.
const MAX_CLIENT_EVENT_BYTES = 64 * 1024;

export type PlayOnCallMode = "hot_seat" | "everybody_guess" | "team_battle";

export type PlayOnCallParticipant = {
  playerID: string;
  displayName: string;
  joinedAt: number;
  team: 0 | 1 | null;
};

export type PlayOnCallRoomSnapshot = {
  protocolVersion: number;
  roomCode: string;
  hostPlayerID: string;
  mode: PlayOnCallMode;
  phase: "lobby" | "playing" | "ended";
  createdAt: number;
  expiresAt: number;
  participants: PlayOnCallParticipant[];
};

export type PlayOnCallEvent =
  | { type: "set_display_name"; display_name: string }
  | { type: "select_team"; team: 0 | 1 }
  | { type: "assign_team"; player_id: string; team: 0 | 1 }
  | { type: "game_event"; event_type: "configure_game"; payload: { mode: PlayOnCallMode; round_seconds: number; turns_each: number; deck_ids: string[]; uses_companion_phone: boolean; full_gist_enabled: boolean } }
  | { type: "game_event"; event_type: "round_start"; payload: { round_id: string; round_number: number; turn_player_id: string; start_card_index: number } }
  | { type: "game_event"; event_type: "round_reassign"; payload: { round_id: string; turn_player_id: string; start_card_index: number } }
  | { type: "game_event"; event_type: "guesser_ready"; payload: { round_id: string; deadline_ms: number } }
  | { type: "game_event"; event_type: "card_action"; payload: { round_id: string; card_index: number; action: "correct" | "skip" } }
  | { type: "game_event"; event_type: "award"; payload: { round_id: string; card_index: number; winner_player_id: string } }
  | { type: "game_event"; event_type: "reaction_checkpoint"; payload: { checkpoint_id: string; round_number: number; recorder_player_id: string; required_player_ids: string[]; expires_at: number } }
  | { type: "game_event"; event_type: "reaction_consent"; payload: { checkpoint_id: string; accept: boolean } }
  | { type: "game_event"; event_type: "reaction_resolution"; payload: { checkpoint_id: string; kept: boolean; accepted_player_ids: string[] } }
  | { type: "game_event"; event_type: "post_game_ad_break"; payload: { active: boolean } }
  | { type: "game_event"; event_type: "game_over"; payload: Record<string, never> }
  | { type: "game_event"; event_type: "return_to_lobby"; payload: Record<string, never> }
  | { type: "leave_room" }
  | { type: "end_room" };

export type PlayOnCallClientFrame = {
  type: "event";
  event_id: string;
  event: PlayOnCallEvent;
};

export type PlayOnCallServerFrame =
  | { type: "room_snapshot"; room: PlayOnCallRoomSnapshot }
  | { type: "participant_joined"; participant: PlayOnCallParticipant }
  | { type: "participant_left"; player_id: string; reason: "left" | "replaced" }
  | { type: "room_event"; sender_player_id: string; event_id: string; event: PlayOnCallEvent }
  | { type: "room_ended"; reason: "host_ended" | "expired" }
  | { type: "error"; code: string; message: string };

export function normalizePlayOnCallRoomCode(value: string): string | null {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/^WBD-/, "")
    .replace(/\s+/g, "");
  const legacyFormats = PLAY_ON_CALL_LEGACY_ROOM_CODE_LENGTHS
    .map((length) => `[${ROOM_CODE_ALPHABET}]{${length}}`)
    .join("|");
  const expression = new RegExp(`^(?:\\d{${PLAY_ON_CALL_ROOM_CODE_LENGTH}}|${legacyFormats})$`);
  return expression.test(normalized) ? normalized : null;
}

export function createPlayOnCallRoomCode(random: () => number = Math.random): string {
  // 1000...9999 avoids codes that appear shorter after numeric keyboards or
  // accessibility tools remove a leading zero.
  return String(1_000 + Math.floor(random() * 9_000));
}

export function normalizePlayOnCallDisplayName(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value : fallback;
  const normalized = candidate
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .split("")
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join("")
    .slice(0, DISPLAY_NAME_MAX_LENGTH);
  return normalized || fallback.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

export function newPlayOnCallRoom(
  roomCode: string,
  host: PlayOnCallParticipant,
  mode: PlayOnCallMode,
  now = Date.now(),
): PlayOnCallRoomSnapshot {
  return {
    protocolVersion: PLAY_ON_CALL_PROTOCOL_VERSION,
    roomCode,
    hostPlayerID: host.playerID,
    mode,
    phase: "lobby",
    createdAt: now,
    expiresAt: now + PLAY_ON_CALL_ROOM_TTL_MS,
    participants: [host],
  };
}

export function isRoomJoinable(room: PlayOnCallRoomSnapshot, now = Date.now()): boolean {
  // A new player joining mid-round would not have the round configuration
  // that existing devices already used to select their local reviewed deck.
  // Reconnects are handled separately by the Durable Object for a participant
  // already in the roster, so closing new admission at play start never
  // strands someone who briefly lost signal.
  return room.phase === "lobby"
    && room.expiresAt > now
    && room.participants.length < PLAY_ON_CALL_MAX_PARTICIPANTS;
}

export function parsePlayOnCallClientFrame(value: string): PlayOnCallClientFrame | null {
  if (new TextEncoder().encode(value).byteLength > MAX_CLIENT_EVENT_BYTES) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!hasExactKeys(parsed, ["type", "event_id", "event"])
      || parsed.type !== "event" || typeof parsed.event_id !== "string"
      || !/^[A-Za-z0-9_-]{8,96}$/.test(parsed.event_id)) return null;
    if (!parsed.event || Array.isArray(parsed.event) || typeof parsed.event !== "object") return null;
    const event = parsed.event as Record<string, unknown>;
    if (event.type === "set_display_name"
      && hasExactKeys(event, ["type", "display_name"])
      && typeof event.display_name === "string") {
      return { type: "event", event_id: parsed.event_id, event: { type: "set_display_name", display_name: event.display_name } };
    }
    if (event.type === "select_team"
      && hasExactKeys(event, ["type", "team"])
      && (event.team === 0 || event.team === 1)) {
      return { type: "event", event_id: parsed.event_id, event: { type: "select_team", team: event.team } };
    }
    if (event.type === "assign_team"
      && hasExactKeys(event, ["type", "player_id", "team"])
      && validPlayerID(event.player_id)
      && (event.team === 0 || event.team === 1)) {
      return { type: "event", event_id: parsed.event_id, event: { type: "assign_team", player_id: event.player_id, team: event.team } };
    }
    if (event.type === "leave_room" && hasExactKeys(event, ["type"])) {
      return { type: "event", event_id: parsed.event_id, event: { type: "leave_room" } };
    }
    if (event.type === "end_room" && hasExactKeys(event, ["type"])) {
      return { type: "event", event_id: parsed.event_id, event: { type: "end_room" } };
    }
    if (event.type === "game_event"
      && hasExactKeys(event, ["type", "event_type", "payload"])
      && typeof event.event_type === "string"
      && event.payload
      && !Array.isArray(event.payload)
      && typeof event.payload === "object") {
      const typedEvent = parseTypedGameEvent(
        event.event_type,
        event.payload as Record<string, unknown>,
      );
      if (typedEvent) return { type: "event", event_id: parsed.event_id, event: typedEvent };
    }
  } catch {
    // A malformed or oversized frame is not a reason to end someone else's room.
  }
  return null;
}

function parseTypedGameEvent(
  eventType: string,
  payload: Record<string, unknown>,
): PlayOnCallEvent | null {
  switch (eventType) {
  case "configure_game": {
    if (!hasExactKeys(payload, ["mode", "round_seconds", "turns_each", "deck_ids", "uses_companion_phone", "full_gist_enabled"])
      || !validMode(payload.mode)
      || !boundedInteger(payload.round_seconds, 30, 180)
      || !boundedInteger(payload.turns_each, 1, 5)
      || !validDeckIDs(payload.deck_ids)
      || typeof payload.uses_companion_phone !== "boolean"
      || typeof payload.full_gist_enabled !== "boolean") return null;
    return { type: "game_event", event_type: eventType, payload: payload as { mode: PlayOnCallMode; round_seconds: number; turns_each: number; deck_ids: string[]; uses_companion_phone: boolean; full_gist_enabled: boolean } };
  }
  case "round_start":
    if (!hasExactKeys(payload, ["round_id", "round_number", "turn_player_id", "start_card_index"])
      || !validSafeID(payload.round_id) || !positiveInteger(payload.round_number)
      || !validPlayerID(payload.turn_player_id) || !nonNegativeInteger(payload.start_card_index)) return null;
    return {
      type: "game_event",
      event_type: eventType,
      payload: payload as {
        round_id: string;
        round_number: number;
        turn_player_id: string;
        start_card_index: number;
      },
    };
  case "round_reassign":
    if (!hasExactKeys(payload, ["round_id", "turn_player_id", "start_card_index"])
      || !validSafeID(payload.round_id) || !validPlayerID(payload.turn_player_id)
      || !nonNegativeInteger(payload.start_card_index)) return null;
    return { type: "game_event", event_type: eventType, payload: payload as { round_id: string; turn_player_id: string; start_card_index: number } };
  case "guesser_ready":
    if (!hasExactKeys(payload, ["round_id", "deadline_ms"]) || !validSafeID(payload.round_id)
      || !positiveInteger(payload.deadline_ms)) return null;
    return { type: "game_event", event_type: eventType, payload: payload as { round_id: string; deadline_ms: number } };
  case "card_action":
    if (!hasExactKeys(payload, ["round_id", "card_index", "action"])
      || !validSafeID(payload.round_id) || !nonNegativeInteger(payload.card_index)
      || (payload.action !== "correct" && payload.action !== "skip")) return null;
    return { type: "game_event", event_type: eventType, payload: payload as { round_id: string; card_index: number; action: "correct" | "skip" } };
  case "award":
    if (!hasExactKeys(payload, ["round_id", "card_index", "winner_player_id"])
      || !validSafeID(payload.round_id) || !nonNegativeInteger(payload.card_index)
      || !validPlayerID(payload.winner_player_id)) return null;
    return { type: "game_event", event_type: eventType, payload: payload as { round_id: string; card_index: number; winner_player_id: string } };
  case "reaction_checkpoint": {
    if (!hasExactKeys(payload, ["checkpoint_id", "round_number", "recorder_player_id", "required_player_ids", "expires_at"])
      || !validSafeID(payload.checkpoint_id) || !positiveInteger(payload.round_number)
      || !validPlayerID(payload.recorder_player_id) || !validPlayerIDs(payload.required_player_ids, false)
      || !nonNegativeInteger(payload.expires_at)) return null;
    return { type: "game_event", event_type: eventType, payload: payload as { checkpoint_id: string; round_number: number; recorder_player_id: string; required_player_ids: string[]; expires_at: number } };
  }
  case "reaction_consent":
    if (!hasExactKeys(payload, ["checkpoint_id", "accept"])
      || !validSafeID(payload.checkpoint_id) || typeof payload.accept !== "boolean") return null;
    return { type: "game_event", event_type: eventType, payload: payload as { checkpoint_id: string; accept: boolean } };
  case "reaction_resolution":
    if (!hasExactKeys(payload, ["checkpoint_id", "kept", "accepted_player_ids"])
      || !validSafeID(payload.checkpoint_id) || typeof payload.kept !== "boolean"
      || !validPlayerIDs(payload.accepted_player_ids, true)) return null;
    return { type: "game_event", event_type: eventType, payload: payload as { checkpoint_id: string; kept: boolean; accepted_player_ids: string[] } };
  case "post_game_ad_break":
    if (!hasExactKeys(payload, ["active"]) || typeof payload.active !== "boolean") return null;
    return { type: "game_event", event_type: eventType, payload: payload as { active: boolean } };
  case "game_over":
  case "return_to_lobby":
    if (!hasExactKeys(payload, [])) return null;
    return { type: "game_event", event_type: eventType, payload: {} };
  default:
    return null;
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function validSafeID(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(value);
}

function validPlayerID(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function validDeckIDs(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1_000) return false;
  if (value.some((id) => typeof id !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(id))) return false;
  return new Set(value).size === value.length;
}

function validMode(value: unknown): value is PlayOnCallMode {
  return value === "hot_seat" || value === "everybody_guess" || value === "team_battle";
}

function validPlayerIDs(value: unknown, mayBeEmpty: boolean): value is string[] {
  if (!Array.isArray(value) || value.length > PLAY_ON_CALL_MAX_PARTICIPANTS
    || (!mayBeEmpty && value.length === 0) || value.some((id) => !validPlayerID(id))) return false;
  return new Set(value).size === value.length;
}

export function serverFrame(value: PlayOnCallServerFrame): string {
  return JSON.stringify(value);
}
