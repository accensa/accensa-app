export interface IpReputation {
  countryCode?: string;
  isTor?: boolean;
  isDatacenterProxy?: boolean;
  isSuspiciousVpn?: boolean;
}

export interface RiskSignals {
  ipCountryCode?: string;
  billingCountryCode?: string;
  failedAttemptsInWindow?: number;
  windowMinutes?: number;
  reputation?: IpReputation;
}

export interface RiskRules {
  manualReviewAbove: number;
  velocityLimit: number;
  velocityWindowMinutes: number;
}

export interface RiskEvaluation {
  score: number;
  countryCode?: string;
  requiresManualReview: boolean;
  reasons: string[];
}

export interface IpReputationProvider {
  lookup(ipAddress: string): Promise<IpReputation>;
}

export const DEFAULT_RISK_RULES: RiskRules = {
  manualReviewAbove: 75,
  velocityLimit: 5,
  velocityWindowMinutes: 15,
};

export function evaluatePaymentRisk(
  signals: RiskSignals,
  rules: RiskRules = DEFAULT_RISK_RULES,
): RiskEvaluation {
  let score = 0;
  const reasons: string[] = [];
  const ipCountryCode = signals.ipCountryCode?.toUpperCase();
  const billingCountryCode = signals.billingCountryCode?.toUpperCase();

  if (signals.reputation?.isTor) {
    score += 50;
    reasons.push('Tor exit node');
  }
  if (signals.reputation?.isDatacenterProxy) {
    score += 35;
    reasons.push('Data center proxy');
  }
  if (signals.reputation?.isSuspiciousVpn) {
    score += 20;
    reasons.push('Suspicious VPN');
  }
  if (ipCountryCode && billingCountryCode && ipCountryCode !== billingCountryCode) {
    score += 25;
    reasons.push('IP and billing countries differ');
  }

  const failedAttempts = signals.failedAttemptsInWindow ?? 0;
  const windowMinutes = signals.windowMinutes ?? rules.velocityWindowMinutes;
  if (
    Number.isFinite(failedAttempts) &&
    failedAttempts > rules.velocityLimit &&
    windowMinutes > 0 &&
    windowMinutes <= rules.velocityWindowMinutes
  ) {
    score += 20;
    reasons.push(
      `More than ${rules.velocityLimit} failed attempts in ${rules.velocityWindowMinutes} minutes`,
    );
  }

  const boundedScore = Math.min(100, Math.max(0, Math.round(score)));
  return {
    score: boundedScore,
    countryCode: ipCountryCode ?? signals.reputation?.countryCode?.toUpperCase(),
    requiresManualReview: boundedScore > rules.manualReviewAbove,
    reasons,
  };
}

export function createCachedIpReputationProvider(
  provider: IpReputationProvider,
  ttlMs = 5 * 60_000,
): IpReputationProvider {
  const cache = new Map<string, { value: IpReputation; expiresAt: number }>();

  return {
    async lookup(ipAddress) {
      const cached = cache.get(ipAddress);
      if (cached && cached.expiresAt > Date.now()) return cached.value;

      const value = await provider.lookup(ipAddress);
      cache.set(ipAddress, { value, expiresAt: Date.now() + ttlMs });
      return value;
    },
  };
}
