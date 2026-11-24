/** Google Play Standard Integrity boundary. No client verdict, score or timing is trusted. */
export interface PlayIntegrityEnv {
  WBD_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON?: string;
  WBD_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER?: string;
  WBD_PLAY_INTEGRITY_CERTIFICATE_SHA256?: string;
  WBD_PLAY_INTEGRITY_MIN_VERSION_CODE?: string;
}
export class PlayIntegrityError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) { super(message); this.name = "PlayIntegrityError"; this.code = code; this.status = status; }
}
export const PLAY_INTEGRITY_PACKAGE = "com.davidadekanbi.wetinbedis";
export interface PlayIntegrityConfiguration {
  packageName: string; cloudProjectNumber: number; certificates: string[]; minimumVersionCode: bigint;
  clientEmail: string; privateKey: string;
}
const encoder = new TextEncoder();
function base64url(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
function encoded(value: unknown): string { return base64url(encoder.encode(JSON.stringify(value))); }
export function normalizeSigningDigest(value: string): string | null {
  const hex = value.replaceAll(":", "");
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return base64url(Uint8Array.from(hex.match(/../g)!, (part) => parseInt(part, 16)));
  if (!/^[A-Za-z0-9_-]{43}=?$/.test(value)) return null;
  try {
    const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/").replace(/=+$/, "") + "="), (char) => char.charCodeAt(0));
    return bytes.length === 32 ? base64url(bytes) : null;
  } catch { return null; }
}
function misconfigured(): never { throw new PlayIntegrityError("play_integrity_misconfigured", 503, "Android device verification is not configured for this environment."); }
export function playIntegrityConfiguration(env: PlayIntegrityEnv): PlayIntegrityConfiguration {
  let account: Record<string, unknown>;
  try { account = JSON.parse(env.WBD_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON ?? ""); } catch { return misconfigured(); }
  const project = env.WBD_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER ?? "";
  const minimum = env.WBD_PLAY_INTEGRITY_MIN_VERSION_CODE ?? "5";
  if (!account || typeof account !== "object" || typeof account.client_email !== "string" || typeof account.private_key !== "string"
    || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(account.client_email) || !account.private_key.includes("-----BEGIN PRIVATE KEY-----")
    || !/^[1-9][0-9]{0,14}$/.test(project) || !Number.isSafeInteger(Number(project)) || !/^[1-9][0-9]{0,18}$/.test(minimum)) misconfigured();
  const supplied = (env.WBD_PLAY_INTEGRITY_CERTIFICATE_SHA256 ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const certificates = supplied.map(normalizeSigningDigest);
  if (certificates.length === 0 || certificates.some((value) => value === null)) misconfigured();
  return { packageName: PLAY_INTEGRITY_PACKAGE, cloudProjectNumber: Number(project), certificates: [...new Set(certificates as string[])], minimumVersionCode: BigInt(minimum), clientEmail: account.client_email, privateKey: account.private_key };
}
export interface PlayIntegrityBinding {
  purpose: "registration" | "cash_answer"; challengeId: string; nonce: string;
  playerId: string; attemptId: string; ordinal: number | null; selectedOptionId: string | null;
}
export async function playIntegrityRequestHash(binding: PlayIntegrityBinding): Promise<string> {
  if (!["registration", "cash_answer"].includes(binding.purpose) || !binding.challengeId || !binding.nonce || !binding.playerId || !binding.attemptId
    || (binding.purpose === "registration" && (binding.ordinal !== null || binding.selectedOptionId !== null))
    || (binding.purpose === "cash_answer" && (!Number.isSafeInteger(binding.ordinal) || (binding.ordinal ?? 0) < 1))) {
    throw new PlayIntegrityError("play_integrity_binding_invalid", 403, "This device proof does not match the active request.");
  }
  const canonical = JSON.stringify(["wbd-play-integrity-v1", binding.purpose, binding.challengeId, binding.nonce, binding.playerId, binding.attemptId, binding.ordinal, binding.selectedOptionId]);
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonical))));
}
function invalid(code = "play_integrity_verdict_invalid"): never { throw new PlayIntegrityError(code, 403, "This Android installation could not be verified. Install the current Google Play version on a supported device and try again."); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(); return value as Record<string, unknown>; }
function decimal(value: unknown): bigint | null { return typeof value === "string" && /^[0-9]{1,19}$/.test(value) ? BigInt(value) : null; }
export interface VerifiedPlayIntegrity { packageName: string; versionCode: string; certificates: string[]; tokenTimestampMs: number }
export function validatePlayIntegrityVerdict(payload: unknown, expected: {
  config: PlayIntegrityConfiguration; requestHash: string; issuedAt: number; expiresAt: number; now: number;
}): VerifiedPlayIntegrity {
  const { config, requestHash, issuedAt, expiresAt, now } = expected;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || issuedAt > now || expiresAt <= now || expiresAt <= issuedAt) invalid("play_integrity_challenge_expired");
  const root = object(payload);
  const request = object(root.requestDetails);
  const timestamp = decimal(request.timestampMillis);
  if (request.requestPackageName !== config.packageName || request.requestHash !== requestHash || timestamp === null
    || timestamp > BigInt(now + 5000) || timestamp < BigInt(issuedAt - 5000) || timestamp > BigInt(expiresAt)
    || BigInt(now) - timestamp > BigInt(120000)) invalid("play_integrity_request_mismatch");
  const app = object(root.appIntegrity);
  const version = decimal(app.versionCode);
  if (app.appRecognitionVerdict !== "PLAY_RECOGNIZED" || app.packageName !== config.packageName || version === null || version < config.minimumVersionCode) invalid();
  if (!Array.isArray(app.certificateSha256Digest) || app.certificateSha256Digest.length === 0 || app.certificateSha256Digest.length > 8) invalid();
  const certificates = app.certificateSha256Digest.map((entry) => typeof entry === "string" ? normalizeSigningDigest(entry) : null);
  if (certificates.some((entry) => entry === null || !config.certificates.includes(entry))) invalid();
  if (object(root.accountDetails).appLicensingVerdict !== "LICENSED") invalid();
  const devices = object(root.deviceIntegrity).deviceRecognitionVerdict;
  if (!Array.isArray(devices) || !devices.includes("MEETS_DEVICE_INTEGRITY")) invalid();
  if (root.testingDetails !== undefined) {
    const testing = object(root.testingDetails).isTestingResponse;
    if (testing !== undefined && testing !== false) invalid("play_integrity_test_response_rejected");
  }
  return { packageName: config.packageName, versionCode: version.toString(), certificates: certificates as string[], tokenTimestampMs: Number(timestamp) };
}
async function issuePlayIntegrityAccessToken(config: PlayIntegrityConfiguration, fetcher: typeof fetch): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encoded({ alg: "RS256", typ: "JWT" })}.${encoded({ iss: config.clientEmail, scope: "https://www.googleapis.com/auth/playintegrity", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  let key: CryptoKey;
  try {
    const raw = config.privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
    key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(raw), (char) => char.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch { return misconfigured(); }
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  let response: Response;
  try {
    response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(new Uint8Array(signature))}` }) });
    if (response.ok) {
      const result = await response.json() as { access_token?: unknown };
      if (typeof result.access_token === "string" && result.access_token.length > 0 && result.access_token.length <= 8192 && !/[\r\n]/.test(result.access_token)) {
        const lifetime = Number((result as { expires_in?: unknown }).expires_in ?? 300);
        if (Number.isFinite(lifetime) && lifetime > 0) return { token: result.access_token, expiresAt: Date.now() + Math.max(0, Math.min(3600, lifetime) - 60) * 1000 };
      }
    }
  } catch { /* Do not expose Google responses, tokens or private-key errors. */ }
  throw new PlayIntegrityError("play_integrity_unavailable", 503, "Android device verification is temporarily unavailable. Try again.");
}
export async function playIntegrityAccessToken(config: PlayIntegrityConfiguration, fetcher: typeof fetch = fetch): Promise<string> {
  return (await issuePlayIntegrityAccessToken(config, fetcher)).token;
}
// Cache only short-lived OAuth authorization. Every integrity token is still decoded and
// checked against its own challenge. Credential rotation changes the cache identity.
let cachedAuthorization: { identity: string; fetcher: typeof fetch; token: string; expiresAt: number } | null = null;
async function cachedPlayIntegrityAccessToken(config: PlayIntegrityConfiguration, fetcher: typeof fetch): Promise<string> {
  const identity = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${config.clientEmail}\n${config.privateKey}`))));
  if (cachedAuthorization?.identity === identity && cachedAuthorization.fetcher === fetcher && cachedAuthorization.expiresAt > Date.now()) return cachedAuthorization.token;
  const issued = await issuePlayIntegrityAccessToken(config, fetcher);
  cachedAuthorization = { identity, fetcher, ...issued };
  return issued.token;
}
export async function verifyPlayIntegrityToken(input: {
  config: PlayIntegrityConfiguration; token: string; requestHash: string; issuedAt: number; expiresAt: number; now?: number;
}, fetcher: typeof fetch = fetch): Promise<VerifiedPlayIntegrity> {
  const now = input.now ?? Date.now();
  if (![now, input.issuedAt, input.expiresAt].every(Number.isSafeInteger) || input.expiresAt <= now || input.issuedAt > now || input.expiresAt <= input.issuedAt) invalid("play_integrity_challenge_expired");
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.requestHash)) invalid("play_integrity_request_mismatch");
  if (typeof input.token !== "string" || input.token.length < 20 || input.token.length > 65536 || /[\s\x00-\x1f]/.test(input.token)) invalid("play_integrity_token_invalid");
  const accessToken = await cachedPlayIntegrityAccessToken(input.config, fetcher);
  let response: Response;
  try {
    response = await fetcher(`https://playintegrity.googleapis.com/v1/${input.config.packageName}:decodeIntegrityToken`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ integrity_token: input.token }),
    });
  } catch { throw new PlayIntegrityError("play_integrity_unavailable", 503, "Android device verification is temporarily unavailable. Try again."); }
  if (!response.ok) {
    if (response.status === 401 && cachedAuthorization?.token === accessToken) cachedAuthorization = null;
    if (response.status === 400) invalid("play_integrity_token_invalid");
    throw new PlayIntegrityError("play_integrity_unavailable", 503, "Android device verification is temporarily unavailable. Try again.");
  }
  let decoded: unknown;
  try { decoded = await response.json(); } catch { return invalid(); }
  return validatePlayIntegrityVerdict(object(decoded).tokenPayloadExternal, { ...input, now: input.now ?? Date.now() });
}
