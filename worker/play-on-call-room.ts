import {
  isRoomJoinable,
  newPlayOnCallRoom,
  normalizePlayOnCallDisplayName,
  normalizePlayOnCallRoomCode,
  parsePlayOnCallClientFrame,
  serverFrame,
  type PlayOnCallMode,
  type PlayOnCallEvent,
  type PlayOnCallParticipant,
  type PlayOnCallRoomSnapshot,
  type PlayOnCallServerFrame,
} from "./play-on-call-protocol.ts";
import {
  reactionResolutionIsValid,
  reactionRosterIsValid,
  reservePlayOnCallEventID,
  cardActionIsAllowed,
  postGameAdBreakIsAllowed,
  turnControlIsAllowed,
  type PlayOnCallGameAuthority,
  type PlayOnCallReactionAuthority,
} from "./play-on-call-authority.ts";

const ROOM_STATE_KEY = "play_on_call_room_v1";
const GAME_AUTHORITY_KEY = "play_on_call_game_authority_v1";
const GAME_SETTINGS_KEY = "play_on_call_game_settings_v1";
const REACTION_AUTHORITY_KEY = "play_on_call_reaction_authority_v1";
const SEEN_EVENT_IDS_KEY = "play_on_call_seen_event_ids_v1";
const GAME_EVENT_LOG_KEY = "play_on_call_game_event_log_v2";
const ROOM_PROXY_HEADER = "x-wbd-call-room-proxy";
const PLAYER_ID_HEADER = "x-wbd-call-room-player-id";
const DISPLAY_NAME_HEADER = "x-wbd-call-room-display-name";
const TV_STATE_KEY = "project_to_tv_state_v1";
const TV_EXPIRY_MS = 2 * 60 * 60 * 1000;
const TV_PAIRING_RATE_LIMIT_KEY = "project_to_tv_pairing_rate_limit_v1";
const TV_PAIRING_RATE_WINDOW_MS = 60 * 1000;
const TV_PAIRING_RATE_LIMIT = 10;

type TVPairingRateLimit = { resetAt: number; failures: number };
type ProjectToTVTeamResult = { name: string; score: number };
type ProjectToTVCardHistoryItem = {
  team: string;
  round: number;
  category: string;
  answer: string;
  forbiddenWords: string[];
  result: "correct" | "skipped" | "timed_out";
};

type ProjectToTVState = {
  phase: "waiting" | "placement" | "countdown" | "playing" | "round_end" | "game_over";
  team: string;
  round: number;
  roundDuration: number;
  secondsRemaining: number;
  countdownRemaining: number;
  score: number;
  teams: ProjectToTVTeamResult[];
  category: string | null;
  difficulty: string | null;
  answer: string | null;
  forbiddenWords: string[];
  cardHistory: ProjectToTVCardHistoryItem[];
  cardHistoryTruncated: boolean;
  updatedAt: number;
};

type ProjectToTVSession = {
  ownerHash: string;
  viewerHash: string;
  expiresAt: number;
  viewerConnectedAt: number | null;
  state: ProjectToTVState;
};

async function secretHash(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseTVState(value: unknown): Omit<ProjectToTVState, "updatedAt"> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  const teams = state.teams ?? [];
  const countdownRemaining = state.countdown_remaining ?? 0;
  const cardHistory = state.card_history ?? [];
  const cardHistoryTruncated = state.card_history_truncated ?? false;
  if (!("phase" in state) || !("team" in state) || !("round" in state)
    || !("round_duration" in state) || !("seconds_remaining" in state) || !("score" in state)
    || !("category" in state) || !("difficulty" in state)
    || !("answer" in state) || !("forbidden_words" in state)
    || Object.keys(state).some((key) => !["phase", "team", "round", "round_duration", "seconds_remaining", "countdown_remaining", "score", "teams", "category", "difficulty", "answer", "forbidden_words", "card_history", "card_history_truncated"].includes(key))) return null;
  const valid = ["waiting", "placement", "countdown", "playing", "round_end", "game_over"].includes(String(state.phase))
    && typeof state.team === "string" && state.team.length <= 40
    && Number.isInteger(state.round) && Number(state.round) >= 0 && Number(state.round) <= 99
    && Number.isInteger(state.round_duration) && Number(state.round_duration) >= 1 && Number(state.round_duration) <= 3600
    && Number.isInteger(state.seconds_remaining) && Number(state.seconds_remaining) >= 0 && Number(state.seconds_remaining) <= 3600
    && Number.isInteger(countdownRemaining) && Number(countdownRemaining) >= 0 && Number(countdownRemaining) <= 3
    && Number.isInteger(state.score) && Number(state.score) >= 0 && Number(state.score) <= 999
    && Array.isArray(teams) && teams.length <= 20
    && teams.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
      && typeof (entry as Record<string, unknown>).name === "string"
      && ((entry as Record<string, unknown>).name as string).length <= 40
      && Number.isInteger((entry as Record<string, unknown>).score)
      && Number((entry as Record<string, unknown>).score) >= 0
      && Number((entry as Record<string, unknown>).score) <= 999)
    && (state.category === null || (typeof state.category === "string" && state.category.length <= 40))
    && (state.difficulty === null || (typeof state.difficulty === "string" && state.difficulty.length <= 20))
    && (state.answer === null || (typeof state.answer === "string" && state.answer.length <= 100))
    && Array.isArray(state.forbidden_words) && state.forbidden_words.length <= 5
    && state.forbidden_words.every((word) => typeof word === "string" && word.length <= 60)
    && Array.isArray(cardHistory) && cardHistory.length <= 240
    && typeof cardHistoryTruncated === "boolean"
    && cardHistory.every((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const item = entry as Record<string, unknown>;
      return Object.keys(item).every((key) => ["team", "round", "category", "answer", "forbidden_words", "result"].includes(key))
        && typeof item.team === "string" && item.team.length <= 40
        && Number.isInteger(item.round) && Number(item.round) >= 0 && Number(item.round) <= 99
        && typeof item.category === "string" && item.category.length <= 40
        && typeof item.answer === "string" && item.answer.length <= 100
        && Array.isArray(item.forbidden_words) && item.forbidden_words.length <= 5
        && item.forbidden_words.every((word) => typeof word === "string" && word.length <= 60)
        && ["correct", "skipped", "timed_out"].includes(String(item.result));
    });
  if (!valid) return null;
  return {
    phase: state.phase as ProjectToTVState["phase"], team: state.team as string,
    round: state.round as number, roundDuration: state.round_duration as number,
    secondsRemaining: state.seconds_remaining as number,
    countdownRemaining: countdownRemaining as number,
    score: state.score as number, teams: teams as ProjectToTVTeamResult[], category: state.category as string | null,
    difficulty: state.difficulty as string | null, answer: state.answer as string | null,
    forbiddenWords: state.forbidden_words as string[],
    cardHistory: (cardHistory as Record<string, unknown>[]).map((entry) => ({
      team: entry.team as string,
      round: entry.round as number,
      category: entry.category as string,
      answer: entry.answer as string,
      forbiddenWords: entry.forbidden_words as string[],
      result: entry.result as ProjectToTVCardHistoryItem["result"],
    })),
    cardHistoryTruncated: cardHistoryTruncated as boolean,
  };
}

const HOST_GAME_EVENTS = new Set([
  "configure_game",
  "round_start",
  "round_reassign",
  "post_game_ad_break",
  "game_over",
  "return_to_lobby",
]);
const PARTICIPANT_GAME_EVENTS = new Set([
  "guesser_ready",
  "card_action",
  "award",
  "reaction_checkpoint",
  "reaction_consent",
  "reaction_resolution",
]);

type LoggedGameEvent = {
  senderPlayerID: string;
  eventID: string;
  event: Extract<PlayOnCallEvent, { type: "game_event" }>;
};

type PlayOnCallGameSettings = {
  mode: PlayOnCallMode;
  usesCompanionPhone: boolean;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return value && !Array.isArray(value) && typeof value === "object"
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function validPlayerID(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function validMode(value: unknown): value is PlayOnCallMode {
  return value === "hot_seat" || value === "everybody_guess" || value === "team_battle";
}

function participant(playerID: string, displayName: string, now = Date.now()): PlayOnCallParticipant {
  return {
    playerID,
    displayName: normalizePlayOnCallDisplayName(displayName, "Player"),
    joinedAt: now,
    team: null,
  };
}

function attachmentPlayerID(socket: WebSocket): string | null {
  const value = (socket as unknown as HibernatableWebSocket).deserializeAttachment();
  return validPlayerID(value) ? value : null;
}

/**
 * One room is one Durable Object. It stores only an ephemeral social-game
 * lobby and relays whitelisted game messages; it does not contain call audio,
 * video, contacts, Full Gist entitlements, cash League data, or card banks.
 */
export class PlayOnCallRoom {
  private readonly state: DurableObjectState;

  constructor(
    state: DurableObjectState,
    environment: unknown,
  ) {
    this.state = state;
    void environment;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get(ROOM_PROXY_HEADER) !== "1") {
      return json({ error: { code: "room_proxy_required" } }, 403);
    }
    const path = new URL(request.url).pathname;
    if (path === "/tv/create" && request.method === "POST") return this.createTVDisplay(request);
    if (path === "/tv/rate-limit" && request.method === "POST") return this.recordTVPairingFailure();
    if (path === "/tv/state" && request.method === "PUT") return this.publishTVState(request);
    if (path === "/tv/state" && request.method === "GET") return this.readTVState(request);
    if (path === "/tv/state" && request.method === "DELETE") return this.endTVDisplay(request);
    if (path === "/create" && request.method === "POST") return this.create(request);
    if (path === "/join" && request.method === "POST") return this.join(request);
    if (path === "/status" && request.method === "GET") return this.status();
    // The public Worker forwards its original `/api/v1/call-rooms/.../socket`
    // path to the object, whereas internal tests can use `/socket` directly.
    if ((path === "/socket" || path.endsWith("/socket")) && request.method === "GET") {
      return this.connect(request);
    }
    return json({ error: { code: "room_endpoint_not_found" } }, 404);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const playerID = attachmentPlayerID(socket);
    if (!playerID) return socket.close(4001, "Room identity missing.");
    if (typeof message !== "string") return this.send(socket, { type: "error", code: "text_frame_required", message: "Room events must be text." });

    const room = await this.activeRoom();
    if (!room) return this.endExpiredRoom();
    const frame = parsePlayOnCallClientFrame(message);
    if (!frame) return this.send(socket, { type: "error", code: "invalid_room_event", message: "That room update is not valid." });

    const currentParticipant = room.participants.find((entry) => entry.playerID === playerID);
    if (!currentParticipant) return socket.close(4001, "You are no longer in this room.");
    const seenEventIDs = await this.state.storage.get<string[]>(SEEN_EVENT_IDS_KEY) ?? [];
    const reservation = reservePlayOnCallEventID(seenEventIDs, frame.event_id);
    if (!reservation.accepted) {
      const message = reservation.code === "duplicate_event"
        ? "That room update was already handled."
        : "This room has reached its safe event limit.";
      return this.send(socket, { type: "error", code: reservation.code, message });
    }
    await this.state.storage.put(SEEN_EVENT_IDS_KEY, reservation.next);

    switch (frame.event.type) {
    case "set_display_name": {
      currentParticipant.displayName = normalizePlayOnCallDisplayName(frame.event.display_name, currentParticipant.displayName);
      await this.save(room);
      this.broadcast({ type: "room_event", sender_player_id: playerID, event_id: frame.event_id, event: { type: "set_display_name", display_name: currentParticipant.displayName } });
      return;
    }
    case "select_team": {
      if (room.phase !== "lobby") {
        return this.send(socket, { type: "error", code: "teams_locked", message: "Teams lock when the game begins." });
      }
      currentParticipant.team = frame.event.team;
      await this.save(room);
      this.broadcast({ type: "room_event", sender_player_id: playerID, event_id: frame.event_id, event: frame.event });
      return;
    }
    case "assign_team": {
      if (room.hostPlayerID !== playerID) {
        return this.send(socket, { type: "error", code: "host_only", message: "Only the Chairman can assign teams." });
      }
      if (room.phase !== "lobby") {
        return this.send(socket, { type: "error", code: "teams_locked", message: "Teams lock when the game begins." });
      }
      const assignedPlayerID = frame.event.player_id;
      const assignedParticipant = room.participants.find((entry) => entry.playerID === assignedPlayerID);
      if (!assignedParticipant) {
        return this.send(socket, { type: "error", code: "unknown_player", message: "That player is no longer in the room." });
      }
      assignedParticipant.team = frame.event.team;
      await this.save(room);
      this.broadcast({ type: "room_event", sender_player_id: playerID, event_id: frame.event_id, event: frame.event });
      return;
    }
    case "leave_room":
      await this.removeParticipant(room, playerID, "left");
      socket.close(1000, "You left the room.");
      return;
    case "end_room":
      if (room.hostPlayerID !== playerID) {
        return this.send(socket, { type: "error", code: "host_only", message: "Only the room host can end the game." });
      }
      await this.endRoom(room, "host_ended");
      return;
    case "game_event": {
      const isHost = room.hostPlayerID === playerID;
      const allowed = isHost
        ? HOST_GAME_EVENTS.has(frame.event.event_type) || PARTICIPANT_GAME_EVENTS.has(frame.event.event_type)
        : PARTICIPANT_GAME_EVENTS.has(frame.event.event_type);
      if (!allowed) {
        return this.send(socket, { type: "error", code: "room_event_not_allowed", message: "That control is not available to this player." });
      }
      const authority = await this.state.storage.get<PlayOnCallGameAuthority>(GAME_AUTHORITY_KEY);
      if (frame.event.event_type === "configure_game") {
        if (!isHost || room.phase !== "lobby") {
          return this.send(socket, { type: "error", code: "game_configuration_not_allowed", message: "Only the Chairman can set up a new game from the lobby." });
        }
        await this.state.storage.put(GAME_EVENT_LOG_KEY, []);
        await this.state.storage.delete(GAME_AUTHORITY_KEY);
        await this.state.storage.delete(REACTION_AUTHORITY_KEY);
        await this.state.storage.put<PlayOnCallGameSettings>(GAME_SETTINGS_KEY, {
          mode: frame.event.payload.mode,
          usesCompanionPhone: frame.event.payload.uses_companion_phone,
        });
        room.mode = frame.event.payload.mode;
      }
      if (frame.event.event_type === "round_start") {
        const payload = frame.event.payload;
        if (!isHost || !room.participants.some((entry) => entry.playerID === payload.turn_player_id)) {
          return this.send(socket, { type: "error", code: "invalid_round_authority", message: "That round owner is not available." });
        }
        room.phase = "playing";
        const settings = await this.state.storage.get<PlayOnCallGameSettings>(GAME_SETTINGS_KEY);
        await this.state.storage.put<PlayOnCallGameAuthority>(GAME_AUTHORITY_KEY, {
          roundID: payload.round_id,
          turnPlayerID: payload.turn_player_id,
          mode: settings?.mode ?? room.mode,
          usesCompanionPhone: settings?.usesCompanionPhone ?? false,
        });
      }
      if (frame.event.event_type === "round_reassign") {
        const payload = frame.event.payload;
        if (!isHost || authority?.roundID !== payload.round_id
          || !room.participants.some((entry) => entry.playerID === payload.turn_player_id)) {
          return this.send(socket, { type: "error", code: "invalid_round_reassignment", message: "That turn cannot be reassigned." });
        }
        await this.state.storage.put<PlayOnCallGameAuthority>(GAME_AUTHORITY_KEY, {
          roundID: payload.round_id,
          turnPlayerID: payload.turn_player_id,
          mode: authority.mode,
          usesCompanionPhone: authority.usesCompanionPhone,
        });
      }
      if (frame.event.event_type === "post_game_ad_break") {
        const log = await this.state.storage.get<LoggedGameEvent[]>(GAME_EVENT_LOG_KEY) ?? [];
        const previous = log.at(-1)?.event;
        const active = frame.event.payload.active;
        if (!postGameAdBreakIsAllowed(active, previous && { type: previous.event_type, payload: previous.payload })) {
          return this.send(socket, { type: "error", code: "post_game_ad_break_not_allowed", message: "A post-game break is only available after a completed game." });
        }
      }
      if (frame.event.event_type === "guesser_ready") {
        const payload = frame.event.payload;
        if (!turnControlIsAllowed(authority, payload.round_id, playerID)) {
          return this.send(socket, { type: "error", code: "turn_owner_required", message: "Only the current turn owner can send that control." });
        }
      }
      if (frame.event.event_type === "card_action") {
        const payload = frame.event.payload;
        if (!cardActionIsAllowed(authority, payload.round_id, playerID, room.participants.map((entry) => entry.playerID))) {
          return this.send(socket, { type: "error", code: "scorekeeper_required", message: "Only the player who can see this card can keep score." });
        }
      }
      if (frame.event.event_type === "guesser_ready") {
        const deadline = frame.event.payload.deadline_ms;
        if (deadline <= Date.now() || deadline > Date.now() + 3 * 60 * 1000) {
          return this.send(socket, { type: "error", code: "invalid_round_deadline", message: "That round clock is not valid." });
        }
      }
      if (frame.event.event_type === "award") {
        const payload = frame.event.payload;
        if (!turnControlIsAllowed(authority, payload.round_id, playerID)
          || !room.participants.some((entry) => entry.playerID === payload.winner_player_id)) {
          return this.send(socket, { type: "error", code: "award_not_allowed", message: "That award is not valid for this round." });
        }
      }
      if (frame.event.event_type === "reaction_checkpoint") {
        const payload = frame.event.payload;
        const roster = [...payload.required_player_ids];
        const participants = room.participants.map((entry) => entry.playerID);
        if (payload.recorder_player_id !== playerID
          || !turnControlIsAllowed(authority, `round_${String(payload.round_number).padStart(4, "0")}`, playerID)
          || !reactionRosterIsValid(participants, payload.recorder_player_id, roster)) {
          return this.send(socket, { type: "error", code: "invalid_reaction_roster", message: "Reaction consent must include everyone in the room." });
        }
        await this.state.storage.put<PlayOnCallReactionAuthority>(REACTION_AUTHORITY_KEY, {
          checkpointID: payload.checkpoint_id,
          recorderPlayerID: payload.recorder_player_id,
          requiredPlayerIDs: roster,
        });
      }
      if (frame.event.event_type === "reaction_consent") {
        const payload = frame.event.payload;
        const checkpoint = await this.state.storage.get<PlayOnCallReactionAuthority>(REACTION_AUTHORITY_KEY);
        if (!checkpoint || checkpoint.checkpointID !== payload.checkpoint_id
          || !checkpoint.requiredPlayerIDs.includes(playerID)) {
          return this.send(socket, { type: "error", code: "reaction_consent_not_allowed", message: "That reaction checkpoint is no longer active." });
        }
      }
      if (frame.event.event_type === "reaction_resolution") {
        const payload = frame.event.payload;
        const checkpoint = await this.state.storage.get<PlayOnCallReactionAuthority>(REACTION_AUTHORITY_KEY);
        if (!checkpoint || checkpoint.recorderPlayerID !== playerID || !reactionResolutionIsValid(
          checkpoint,
          payload.checkpoint_id,
          payload.kept,
          payload.accepted_player_ids,
        )) {
          return this.send(socket, { type: "error", code: "invalid_reaction_resolution", message: "That reaction result is not valid." });
        }
        await this.state.storage.delete(REACTION_AUTHORITY_KEY);
      }
      if (frame.event.event_type === "return_to_lobby") {
        if (!isHost) {
          return this.send(socket, { type: "error", code: "host_only", message: "Only the Chairman can restart the room." });
        }
        room.phase = "lobby";
        await this.state.storage.delete(GAME_AUTHORITY_KEY);
        await this.state.storage.delete(GAME_SETTINGS_KEY);
        await this.state.storage.delete(REACTION_AUTHORITY_KEY);
      }
      await this.save(room);
      const outbound: PlayOnCallServerFrame = { type: "room_event", sender_player_id: playerID, event_id: frame.event_id, event: frame.event };
      this.broadcast(outbound);
      if (frame.event.event_type === "return_to_lobby") {
        await this.state.storage.put(GAME_EVENT_LOG_KEY, []);
      } else {
        const log = await this.state.storage.get<LoggedGameEvent[]>(GAME_EVENT_LOG_KEY) ?? [];
        log.push({ senderPlayerID: playerID, eventID: frame.event_id, event: frame.event });
        await this.state.storage.put(GAME_EVENT_LOG_KEY, log.slice(-2_048));
      }
    }
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    // A dropped connection is not an affirmative leave. The participant stays
    // in the snapshot during the room's short lifetime so either native app
    // can reconnect without changing teams or ending a live round.
    void socket;
  }

  async alarm(): Promise<void> {
    const tvDisplay = await this.state.storage.get<ProjectToTVSession>(TV_STATE_KEY);
    if (tvDisplay) {
      if (tvDisplay.expiresAt <= Date.now()) {
        await this.state.storage.delete(TV_STATE_KEY);
        return;
      }
      await this.state.storage.setAlarm(tvDisplay.expiresAt);
      return;
    }
    const pairingLimit = await this.state.storage.get<TVPairingRateLimit>(TV_PAIRING_RATE_LIMIT_KEY);
    if (pairingLimit) {
      if (pairingLimit.resetAt <= Date.now()) {
        await this.state.storage.delete(TV_PAIRING_RATE_LIMIT_KEY);
        return;
      }
      await this.state.storage.setAlarm(pairingLimit.resetAt);
      return;
    }
    const room = await this.load();
    if (!room || room.phase === "ended") return;
    if (room.expiresAt > Date.now()) {
      // A newer room snapshot can only arise during local development or a
      // future TTL extension. Preserve the expiry guarantee in either case.
      await this.state.storage.setAlarm(room.expiresAt);
      return;
    }
    await this.endRoom(room, "expired");
  }

  private async create(request: Request): Promise<Response> {
    const body = await readJson(request);
    const roomCode = normalizePlayOnCallRoomCode(String(body?.room_code ?? ""));
    if (!roomCode || !validPlayerID(body?.host_player_id) || !validMode(body?.mode)) {
      return json({ error: { code: "invalid_room_create" } }, 400);
    }
    const existing = await this.load();
    if (existing && existing.expiresAt > Date.now() && existing.phase !== "ended") {
      return json({ error: { code: "room_code_collision" } }, 409);
    }
    const room = newPlayOnCallRoom(
      roomCode,
      participant(body.host_player_id, String(body.host_display_name ?? "Player")),
      body.mode,
    );
    await this.save(room);
    return json({ room }, 201);
  }

  private async createTVDisplay(request: Request): Promise<Response> {
    const body = await readJson(request);
    if (typeof body?.owner_token !== "string" || typeof body?.viewer_token !== "string") {
      return json({ error: { code: "invalid_tv_display" } }, 400);
    }
    const existing = await this.state.storage.get<ProjectToTVSession>(TV_STATE_KEY);
    if (existing && existing.expiresAt > Date.now()) return json({ error: { code: "tv_display_exists" } }, 409);
    const expiresAt = Date.now() + TV_EXPIRY_MS;
    await this.state.storage.put<ProjectToTVSession>(TV_STATE_KEY, {
      ownerHash: await secretHash(body.owner_token),
      viewerHash: await secretHash(body.viewer_token),
      expiresAt,
      viewerConnectedAt: null,
      state: { phase: "waiting", team: "", round: 0, roundDuration: 60, secondsRemaining: 0, countdownRemaining: 0, score: 0, teams: [], category: null, difficulty: null, answer: null, forbiddenWords: [], cardHistory: [], cardHistoryTruncated: false, updatedAt: Date.now() },
    });
    await this.state.storage.setAlarm(expiresAt);
    return json({ expires_at: expiresAt }, 201);
  }

  private async recordTVPairingFailure(): Promise<Response> {
    const now = Date.now();
    const current = await this.state.storage.get<TVPairingRateLimit>(TV_PAIRING_RATE_LIMIT_KEY);
    const limit = current && current.resetAt > now
      ? current
      : { resetAt: now + TV_PAIRING_RATE_WINDOW_MS, failures: 0 };
    limit.failures += 1;
    await this.state.storage.put(TV_PAIRING_RATE_LIMIT_KEY, limit);
    await this.state.storage.setAlarm(limit.resetAt);
    return json({ allowed: limit.failures <= TV_PAIRING_RATE_LIMIT, retry_after_seconds: Math.max(1, Math.ceil((limit.resetAt - now) / 1000)) });
  }

  private async publishTVState(request: Request): Promise<Response> {
    const session = await this.state.storage.get<ProjectToTVSession>(TV_STATE_KEY);
    if (!session || session.expiresAt <= Date.now()) return json({ error: { code: "tv_display_expired" } }, 410);
    const ownerToken = request.headers.get("x-wbd-tv-owner-token") ?? "";
    if (!ownerToken || await secretHash(ownerToken) !== session.ownerHash) return json({ error: { code: "tv_display_forbidden" } }, 403);
    const body = await readJson(request);
    const nextState = parseTVState(body);
    if (!nextState) return json({ error: { code: "invalid_tv_state" } }, 400);
    session.state = { ...nextState, updatedAt: Date.now() };
    await this.state.storage.put(TV_STATE_KEY, session);
    const viewerConnected = typeof session.viewerConnectedAt === "number"
      && Date.now() - session.viewerConnectedAt < 5_000;
    return json({ ok: true, display_connected: viewerConnected });
  }

  private async readTVState(request: Request): Promise<Response> {
    const session = await this.state.storage.get<ProjectToTVSession>(TV_STATE_KEY);
    if (!session || session.expiresAt <= Date.now()) return json({ error: { code: "tv_display_expired" } }, 410);
    const viewerToken = new URL(request.url).searchParams.get("key") ?? "";
    if (!viewerToken || await secretHash(viewerToken) !== session.viewerHash) return json({ error: { code: "tv_display_forbidden" } }, 403);
    const now = Date.now();
    if (typeof session.viewerConnectedAt !== "number" || now - session.viewerConnectedAt >= 1_000) {
      session.viewerConnectedAt = now;
      await this.state.storage.put(TV_STATE_KEY, session);
    }
    return json({ state: session.state, expires_at: session.expiresAt });
  }

  private async endTVDisplay(request: Request): Promise<Response> {
    const session = await this.state.storage.get<ProjectToTVSession>(TV_STATE_KEY);
    if (!session) return json({ ok: true });
    const ownerToken = request.headers.get("x-wbd-tv-owner-token") ?? "";
    if (!ownerToken || await secretHash(ownerToken) !== session.ownerHash) return json({ error: { code: "tv_display_forbidden" } }, 403);
    await this.state.storage.delete(TV_STATE_KEY);
    return json({ ok: true });
  }

  private async join(request: Request): Promise<Response> {
    const room = await this.activeRoom();
    if (!room) return json({ error: { code: "room_unavailable" } }, 410);
    const body = await readJson(request);
    if (!validPlayerID(body?.player_id)) return json({ error: { code: "invalid_room_player" } }, 400);
    const existing = room.participants.find((entry) => entry.playerID === body.player_id);
    if (!existing && !isRoomJoinable(room)) {
      return json({ error: { code: "room_full_or_closed" } }, 409);
    }
    return json({ room });
  }

  private async status(): Promise<Response> {
    const room = await this.activeRoom();
    return room ? json({ room }) : json({ error: { code: "room_unavailable" } }, 410);
  }

  private async connect(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: { code: "websocket_upgrade_required" } }, 426);
    }
    const playerID = request.headers.get(PLAYER_ID_HEADER);
    const displayName = request.headers.get(DISPLAY_NAME_HEADER);
    if (!validPlayerID(playerID) || !displayName) return json({ error: { code: "invalid_room_socket" } }, 400);
    const room = await this.activeRoom();
    if (!room) return json({ error: { code: "room_unavailable" } }, 410);

    let joined = room.participants.find((entry) => entry.playerID === playerID);
    if (!joined) {
      if (!isRoomJoinable(room)) return json({ error: { code: "room_full_or_closed" } }, 409);
      joined = participant(playerID, displayName);
      room.participants.push(joined);
      await this.save(room);
      this.broadcast({ type: "participant_joined", participant: joined });
    }

    for (const existingSocket of this.socketsForPlayer(playerID)) {
      existingSocket.close(4002, "Connected from another device.");
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1] as unknown as HibernatableWebSocket;
    server.serializeAttachment(playerID);
    this.state.acceptWebSocket(server);
    this.send(server, { type: "room_snapshot", room });
    const gameEvents = await this.state.storage.get<LoggedGameEvent[]>(GAME_EVENT_LOG_KEY) ?? [];
    for (const event of gameEvents) {
      this.send(server, {
        type: "room_event",
        sender_player_id: event.senderPlayerID,
        event_id: event.eventID,
        event: event.event,
      });
    }
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  private async removeParticipant(
    room: PlayOnCallRoomSnapshot,
    playerID: string,
    reason: "left" | "replaced",
  ): Promise<void> {
    if (room.hostPlayerID === playerID) {
      await this.endRoom(room, "host_ended");
      return;
    }
    room.participants = room.participants.filter((entry) => entry.playerID !== playerID);
    await this.save(room);
    this.broadcast({ type: "participant_left", player_id: playerID, reason });
  }

  private async endRoom(
    room: PlayOnCallRoomSnapshot,
    reason: "host_ended" | "expired",
  ): Promise<void> {
    room.phase = "ended";
    await this.save(room);
    this.broadcast({ type: "room_ended", reason });
    for (const socket of this.state.getWebSockets()) socket.close(4000, "Room ended.");
  }

  private async endExpiredRoom(): Promise<void> {
    const room = await this.load();
    if (room && room.phase !== "ended") await this.endRoom(room, "expired");
  }

  private async load(): Promise<PlayOnCallRoomSnapshot | undefined> {
    return this.state.storage.get<PlayOnCallRoomSnapshot>(ROOM_STATE_KEY);
  }

  private async activeRoom(): Promise<PlayOnCallRoomSnapshot | undefined> {
    const room = await this.load();
    if (!room || room.phase === "ended" || room.expiresAt <= Date.now()) return undefined;
    return room;
  }

  private async save(room: PlayOnCallRoomSnapshot): Promise<void> {
    await this.state.storage.put(ROOM_STATE_KEY, room);
    await this.state.storage.setAlarm(room.expiresAt);
  }

  private socketsForPlayer(playerID: string): WebSocket[] {
    return this.state.getWebSockets().filter((socket) => attachmentPlayerID(socket) === playerID);
  }

  private send(socket: WebSocket, frame: PlayOnCallServerFrame): void {
    socket.send(serverFrame(frame));
  }

  private broadcast(frame: PlayOnCallServerFrame): void {
    const encoded = serverFrame(frame);
    for (const socket of this.state.getWebSockets()) socket.send(encoded);
  }
}
