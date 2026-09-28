export type PlayOnCallGameAuthority = { roundID: string; turnPlayerID: string };
export type PlayOnCallReactionAuthority = { checkpointID: string; requiredPlayerIDs: string[] };

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
