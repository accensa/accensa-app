export interface RiskScoreBadgeProps {
  score: number;
  countryCode?: string;
  requiresManualReview?: boolean;
}

function countryFlag(countryCode: string): string | null {
  if (!/^[A-Z]{2}$/.test(countryCode)) return null;
  return String.fromCodePoint(...[...countryCode].map((letter) => 127397 + letter.charCodeAt(0)));
}

export function RiskScoreBadge({
  score,
  countryCode,
  requiresManualReview = false,
}: RiskScoreBadgeProps) {
  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const tone =
    boundedScore >= 75
      ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300'
      : boundedScore >= 40
        ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300'
        : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300';
  const flag = countryCode ? countryFlag(countryCode.toUpperCase()) : null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-1 text-xs font-semibold ${tone}`}
      title={requiresManualReview ? 'Requires manual review' : `Risk score ${boundedScore} of 100`}
    >
      {flag && (
        <span aria-label={`Country ${countryCode}`} role="img">
          {flag}
        </span>
      )}
      <span>{boundedScore}</span>
      {requiresManualReview && <span className="sr-only">Requires manual review</span>}
    </span>
  );
}
