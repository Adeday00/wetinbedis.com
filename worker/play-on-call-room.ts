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
  turnControlIsAllowed,
  type PlayOnCallGameAuthority,
  type PlayOnCallReactionAuthority,
} from "./play-on-call-authority.ts";

const ROOM_STATE_KEY = "play_on_call_room_v1";
const GAME_AUTHORITY_KEY = "play_on_call_game_authority_v1";
const REACTION_AUTHORITY_KEY = "play_on_call_reaction_authority_v1";
const SEEN_EVENT_IDS_KEY = "play_on_call_seen_event_ids_v1";
const GAME_EVENT_LOG_KEY = "play_on_call_game_event_log_v2";
const ROOM_PROXY_HEADER = "x-wbd-call-room-proxy";
const PLAYER_ID_HEADER = "x-wbd-call-room-player-id";
const DISPLAY_NAME_HEADER = "x-wbd-call-room-display-name";

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
        room.mode = frame.event.payload.mode;
      }
      if (frame.event.event_type === "round_start") {
        const payload = frame.event.payload;
        if (!isHost || !room.participants.some((entry) => entry.playerID === payload.turn_player_id)) {
          return this.send(socket, { type: "error", code: "invalid_round_authority", message: "That round owner is not available." });
        }
        room.phase = "playing";
        await this.state.storage.put<PlayOnCallGameAuthority>(GAME_AUTHORITY_KEY, {
          roundID: payload.round_id,
          turnPlayerID: payload.turn_player_id,
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
        });
      }
      if (frame.event.event_type === "guesser_ready" || frame.event.event_type === "card_action") {
        const payload = frame.event.payload;
        if (!turnControlIsAllowed(authority, payload.round_id, playerID)) {
          return this.send(socket, { type: "error", code: "turn_owner_required", message: "Only the current turn owner can send that control." });
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
