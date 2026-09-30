'use client';

export interface OnboardingStep {
  title: string;
  complete: boolean;
}

export function OnboardingStepper({
  steps,
  activeStep,
  onSelect,
}: {
  steps: OnboardingStep[];
  activeStep: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="grid gap-3 sm:grid-cols-4" aria-label="Merchant setup progress">
      {steps.map((step, index) => (
        <li key={step.title}>
          <button
            type="button"
            onClick={() => onSelect(index)}
            aria-current={activeStep === index ? 'step' : undefined}
            className={`flex min-h-14 w-full items-center gap-3 border px-3 py-2 text-left text-sm ${
              activeStep === index
                ? 'border-emerald-600 bg-emerald-50 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-200'
                : 'border-slate-200 bg-white/50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
            }`}
          >
            <span className="grid size-7 shrink-0 place-items-center border border-current font-mono text-xs">
              {step.complete ? '✓' : index + 1}
            </span>
            <span className="font-semibold">{step.title}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
