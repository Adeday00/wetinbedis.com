export type PlayOnCallGameAuthority = {
  roundID: string;
  turnPlayerID: string;
  mode: "hot_seat" | "everybody_guess" | "team_battle";
  usesCompanionPhone: boolean;
};
export type PlayOnCallReactionAuthority = { checkpointID: string; recorderPlayerID: string; requiredPlayerIDs: string[] };

export function postGameAdBreakIsAllowed(
  active: boolean,
  previous: { type: string; payload?: unknown } | undefined,
): boolean {
  const payload = previous?.payload;
  const wasActive = typeof payload === "object" && payload !== null && "active" in payload
    && (payload as { active?: unknown }).active === true;
  return active
    ? previous?.type === "game_over"
    : previous?.type === "post_game_ad_break" && wasActive;
}

export function reservePlayOnCallEventID(
  seenEventIDs: string[],
  eventID: string,
  maximum = 4_096,
): { accepted: true; next: string[] } | { accepted: false; code: "duplicate_event" | "room_event_limit_reached" } {
  if (seenEventIDs.includes(eventID)) return { accepted: false, code: "duplicate_event" };
  if (seenEventIDs.length >= maximum) return { accepted: false, code: "room_event_limit_reached" };
  return { accepted: true, next: [...seenEventIDs, eventID] };
}

export function turnControlIsAllowed(
  authority: PlayOnCallGameAuthority | undefined,
  roundID: string,
  senderPlayerID: string,
): boolean {
  return authority?.roundID === roundID && authority.turnPlayerID === senderPlayerID;
}

/**
 * Hot Seat has two deliberately different controllers. In a nearby House
 * Party the blind player wears the companion phone and records by tilt. In a
 * Call room, the blind player guesses while the next connected player sees
 * the cards and keeps score. Every other mode has the active presenter
 * control the card.
 */
export function cardActionIsAllowed(
  authority: PlayOnCallGameAuthority | undefined,
  roundID: string,
  senderPlayerID: string,
  participantIDs: string[],
): boolean {
  if (!authority || authority.roundID !== roundID) return false;
  if (authority.mode !== "hot_seat" || authority.usesCompanionPhone) {
    return authority.turnPlayerID === senderPlayerID;
  }

  const order = [...participantIDs].sort();
  const guesserIndex = order.indexOf(authority.turnPlayerID);
  if (guesserIndex < 0 || order.length < 2) return false;
  const scorekeeperID = order[(guesserIndex + 1) % order.length];
  return scorekeeperID === senderPlayerID;
}

export function reactionRosterIsValid(
  participantIDs: string[],
  recorderPlayerID: string,
  requiredPlayerIDs: string[],
): boolean {
  const roster = [...new Set(requiredPlayerIDs)];
  return roster.length === requiredPlayerIDs.length
    && roster.includes(recorderPlayerID)
    && roster.slice().sort().join("|") === participantIDs.slice().sort().join("|");
}

export function reactionResolutionIsValid(
  authority: PlayOnCallReactionAuthority | undefined,
  checkpointID: string,
  kept: boolean,
  acceptedPlayerIDs: string[],
): boolean {
  if (!authority || authority.checkpointID !== checkpointID) return false;
  const accepted = [...new Set(acceptedPlayerIDs)];
  if (accepted.length !== acceptedPlayerIDs.length
    || accepted.some((id) => !authority.requiredPlayerIDs.includes(id))) return false;
  return !kept || accepted.length === authority.requiredPlayerIDs.length;
}
