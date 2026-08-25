export type PhoneVerificationCapability = {
  available: boolean;
  provider: string | null;
  reason: string;
};

export interface PhoneVerificationProvider {
  readonly capability: PhoneVerificationCapability;
  start(): Promise<never>;
  verify(): Promise<never>;
}

class DisabledPhoneVerificationProvider implements PhoneVerificationProvider {
  readonly capability: PhoneVerificationCapability = {
    available: false,
    provider: null,
    reason: "provider_not_configured",
  };

  async start(): Promise<never> {
    throw new Error("phone_verification_unavailable");
  }

  async verify(): Promise<never> {
    throw new Error("phone_verification_unavailable");
  }
}

// Production deliberately defaults to disabled. A real SMS provider must be
// selected, configured with secrets, rate-limited, and wired here before cash
// entry can be enabled. There is intentionally no fixed or HTTP-exposed dev OTP.
export function getPhoneVerificationProvider(): PhoneVerificationProvider {
  return new DisabledPhoneVerificationProvider();
}
