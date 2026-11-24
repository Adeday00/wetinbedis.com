type IntegrityAttestModule = typeof import("@bradford-tech/supabase-integrity-attest");

let integrityAttestModule: Promise<IntegrityAttestModule> | undefined;

function loadIntegrityAttest(): Promise<IntegrityAttestModule> {
  // Keep this dependency lazy. Besides reducing the normal request bundle,
  // this lets CommonJS-based maintenance/test tooling load the router without
  // eagerly resolving the package's ESM-only entry point.
  integrityAttestModule ??= import("@bradford-tech/supabase-integrity-attest");
  return integrityAttestModule;
}

export type AppAttestEnvironment = "development" | "production";

/// Web Crypto's TypeScript definition requires an ArrayBuffer-backed view.
/// Copying also keeps an offset/sliced view from accidentally changing the
/// bytes included in an integrity digest.
function cryptoBytes(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function uint32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("app_attest_invalid_uint32");
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function lengthPrefixed(domain: string, fields: Uint8Array[]): Uint8Array {
  return concatenate([
    utf8(domain),
    new Uint8Array([0]),
    ...fields.flatMap((field) => [uint32(field.byteLength), field]),
  ]);
}

export function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function base64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function registrationClientData(challenge: Uint8Array): Uint8Array {
  return lengthPrefixed("wbd.app-attest.registration.v1", [challenge]);
}

export function cashAnswerBinding(
  attemptID: string,
  ordinal: number,
  selectedOptionID: string | null,
): Uint8Array {
  const selected = selectedOptionID === null
    ? new Uint8Array([0])
    : concatenate([new Uint8Array([1]), utf8(selectedOptionID)]);
  return lengthPrefixed("wbd.cash-answer.binding.v1", [
    utf8(attemptID),
    uint32(ordinal),
    selected,
  ]);
}

export function assertionClientData(
  challenge: Uint8Array,
  canonicalRequest: Uint8Array,
): Uint8Array {
  return lengthPrefixed("wbd.app-attest.assertion.v1", [challenge, canonicalRequest]);
}

export async function sha256HexBytes(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", cryptoBytes(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyAppAttestRegistration(input: {
  appID: string;
  environment: AppAttestEnvironment;
  keyID: string;
  challenge: Uint8Array;
  attestationObject: string;
}) {
  const { verifyAttestation } = await loadIntegrityAttest();
  const clientData = registrationClientData(input.challenge);
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", cryptoBytes(clientData)),
  );
  return verifyAttestation(
    {
      appId: input.appID,
      developmentEnv: input.environment === "development",
    },
    input.keyID,
    clientDataHash,
    input.attestationObject,
  );
}

export async function verifyAppAttestCashAnswer(input: {
  appID: string;
  assertion: string;
  challenge: Uint8Array;
  canonicalRequest: Uint8Array;
  publicKeyPem: string;
  previousSignCount: number;
}) {
  const { verifyAssertion } = await loadIntegrityAttest();
  return verifyAssertion(
    { appId: input.appID },
    input.assertion,
    assertionClientData(input.challenge, input.canonicalRequest),
    input.publicKeyPem,
    input.previousSignCount,
  );
}
