const SESSION_TOKEN_BYTES = 32;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** A raw, URL-safe nonce for a server-owned challenge. */
export function createBase64UrlNonce(byteCount = SESSION_TOKEN_BYTES): string {
  if (!Number.isSafeInteger(byteCount) || byteCount < 16 || byteCount > 128) {
    throw new Error("invalid_nonce_length");
  }
  return base64Url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function createOpaqueToken(prefix: string): string {
  return `${prefix}_${createBase64UrlNonce()}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const PUSH_TOKEN_AAD = "wetin-be-dis-push-token-v1";
const PAYOUT_DATA_AAD = "wetin-be-dis-payout-data-v1";

function base64UrlToString(bytes: Uint8Array): string {
  return base64Url(bytes);
}

function detachedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * Encrypt a device token before it is persisted. The deployment secret never
 * leaves the Worker and the token is never returned by the notification API.
 * A missing secret is deliberately an error: plaintext push tokens do not
 * belong in D1 merely because remote delivery has not launched yet.
 */
export async function encryptPushToken(
  token: string,
  encryptionSecret: string | undefined,
): Promise<string> {
  const secret = encryptionSecret?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("push_token_encryption_unavailable");
  }

  const keyMaterial = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(PUSH_TOKEN_AAD),
    },
    key,
    new TextEncoder().encode(token),
  );
  return `v1.${base64UrlToString(iv)}.${base64UrlToString(new Uint8Array(ciphertext))}`;
}

export async function decryptPushToken(
  ciphertext: string,
  encryptionSecret: string | undefined,
): Promise<string> {
  const secret = encryptionSecret?.trim();
  const parts = ciphertext.split(".");
  if (!secret || secret.length < 32 || parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("push_token_decryption_unavailable");
  }
  const iv = base64UrlDecode(parts[1]);
  const encrypted = base64UrlDecode(parts[2]);
  if (!iv || !encrypted) throw new Error("push_token_ciphertext_invalid");
  const keyMaterial = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: detachedArrayBuffer(iv),
      additionalData: new TextEncoder().encode(PUSH_TOKEN_AAD),
    },
    key,
    detachedArrayBuffer(encrypted),
  );
  return new TextDecoder().decode(plaintext);
}

export async function encryptConfidentialPayload(
  payload: string,
  encryptionSecret: string | undefined,
): Promise<string> {
  const secret = encryptionSecret?.trim();
  if (!secret || secret.length < 32) throw new Error("payout_data_encryption_unavailable");
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(PAYOUT_DATA_AAD) },
    key,
    new TextEncoder().encode(payload),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptConfidentialPayload(
  ciphertext: string,
  encryptionSecret: string | undefined,
): Promise<string> {
  const secret = encryptionSecret?.trim();
  const parts = ciphertext.split(".");
  if (!secret || secret.length < 32 || parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("payout_data_decryption_unavailable");
  }
  const iv = base64UrlDecode(parts[1]);
  const encrypted = base64UrlDecode(parts[2]);
  if (!iv || !encrypted) throw new Error("payout_data_ciphertext_invalid");
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: detachedArrayBuffer(iv), additionalData: new TextEncoder().encode(PAYOUT_DATA_AAD) },
    key,
    detachedArrayBuffer(encrypted),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}

export type PlayOnCallTicket = {
  roomCode: string;
  playerID: string;
  displayName: string;
  expiresAt: number;
};

const PLAY_ON_CALL_TICKET_VERSION = "wbd_room_v1";

async function ticketSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function validPlayOnCallTicket(value: unknown): value is PlayOnCallTicket {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const ticket = value as Record<string, unknown>;
  return typeof ticket.roomCode === "string"
    && typeof ticket.playerID === "string"
    && typeof ticket.displayName === "string"
    && typeof ticket.expiresAt === "number"
    && Number.isSafeInteger(ticket.expiresAt);
}

/**
 * A short-lived room ticket is a capability for a single anonymous player to
 * open one WebSocket. It is signed by the Worker, never persisted, and is
 * intentionally unrelated to a purchase, League attempt, or phone number.
 */
export async function signPlayOnCallTicket(
  ticket: PlayOnCallTicket,
  signingSecret: string | undefined,
): Promise<string> {
  const secret = signingSecret?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("play_on_call_ticket_signing_unavailable");
  }
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(ticket)));
  const signedValue = `${PLAY_ON_CALL_TICKET_VERSION}.${payload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await ticketSigningKey(secret), new TextEncoder().encode(signedValue)),
  );
  return `${signedValue}.${base64Url(signature)}`;
}

export async function verifyPlayOnCallTicket(
  token: string,
  signingSecret: string | undefined,
  now = Date.now(),
): Promise<PlayOnCallTicket | null> {
  const secret = signingSecret?.trim();
  if (!secret || secret.length < 32) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PLAY_ON_CALL_TICKET_VERSION) return null;
  const [version, payload, signature] = parts;
  const signatureBytes = base64UrlDecode(signature);
  const payloadBytes = base64UrlDecode(payload);
  if (!signatureBytes || !payloadBytes) return null;
  const signedValue = `${version}.${payload}`;
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    await ticketSigningKey(secret),
    signatureBytes.buffer.slice(
      signatureBytes.byteOffset,
      signatureBytes.byteOffset + signatureBytes.byteLength,
    ) as ArrayBuffer,
    new TextEncoder().encode(signedValue),
  );
  if (!validSignature) return null;
  try {
    const ticket = JSON.parse(new TextDecoder().decode(payloadBytes)) as unknown;
    if (!validPlayOnCallTicket(ticket)) return null;
    if (ticket.expiresAt <= now) return null;
    return ticket;
  } catch {
    return null;
  }
}
