# Accessibility Architecture & Axe Verification Mapping

This document formalizes the mapping between Accensa's design principles in [`DESIGN.md`](../DESIGN.md) and automated axe verification checks executed via `@axe-core/playwright` in `apps/web/e2e/a11y.spec.ts`.

## 1. Contrast Floors & Palette Pairs

Automated Rule: **`color-contrast`** (WCAG 1.4.3 Level AA for text, WCAG 1.4.11 for non-text UI)

Contrast calculation formula:
$$\text{Ratio} = \frac{L_1 + 0.05}{L_2 + 0.05}$$
where $L_1$ is the relative luminance of the lighter color and $L_2$ is the relative luminance of the darker color.

### Verified Palette Pairs (Over Background Surfaces)

| Mode            | Foreground Color                          | Background Surface                     | Measured Ratio | Pass Threshold            | Axe Rule Status       |
| --------------- | ----------------------------------------- | -------------------------------------- | -------------- | ------------------------- | --------------------- |
| Dark            | `text-slate-100` (`#f1f5f9`, $L=0.887$)   | `bg-slate-950` (`#020617`, $L=0.003$)  | **17.7:1**     | $\ge 4.5:1$ (Body)        | Pass                  |
| Dark            | `text-slate-300` (`#cbd5e1`, $L=0.667$)   | `bg-slate-950` (`#020617`, $L=0.003$)  | **13.5:1**     | $\ge 4.5:1$ (Body)        | Pass                  |
| Dark            | `text-emerald-400` (`#34d399`, $L=0.534$) | `bg-slate-950` (`#020617`, $L=0.003$)  | **11.0:1**     | $\ge 3.0:1$ (UI / Accent) | Pass                  |
| Light           | `text-slate-900` (`#0f172a`, $L=0.010$)   | `bg-white` (`#ffffff`, $L=1.000$)      | **17.5:1**     | $\ge 4.5:1$ (Body)        | Pass                  |
| Light           | `text-emerald-950` (`#022c22`, $L=0.021$) | `bg-emerald-50` (`#ecfdf5`, $L=0.957$) | **14.2:1**     | $\ge 4.5:1$ (Body)        | Pass                  |
| Light (Failing) | `text-slate-400` (`#94a3b8`, $L=0.354$)   | `bg-white` (`#ffffff`, $L=1.000$)      | **2.6:1**      | $< 4.5:1$ (FAIL)          | Rejected / Prohibited |

_Note_: As specified in `apps/web/e2e/a11y.spec.ts:28`, the legacy light theme stat card finding is allowlisted under issue #190, but all newly authored components must strictly satisfy the 4.5:1 floor.

## 2. Focus-Visible Indicators

Automated Rule: **`focus-order-semantics`**, **`tabindex`**

Interactive components must never remove outlines without supplying the standardized visible focus ring:

```tsx
focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950
```

- Ring thickness: 2px.
- Highlight color: Emerald 500 (`#10b981`), providing unmistakable contrast against both white and dark slate backgrounds.
- Behavior: Active strictly during keyboard interaction via `:focus-visible`, avoiding visual distraction during mouse clicks.

## 3. Touch and Pointer Target Size

Automated Rule: **`target-size`** (WCAG 2.5.8 Level AA, minimum 24x24px; Accensa Design standard $\ge 44\times 44\text{px}$)

To prevent mis-taps on mobile and touch devices:

- Minimum height utility: `min-h-[44px]` (or `min-h-11`).
- Stepper and navigation standard: `min-h-14` ($56\text{px}$), as seen in `apps/web/src/components/onboarding/OnboardingStepper.tsx:25`:
  ```tsx
  className = 'flex min-h-14 w-full items-center gap-3 border px-3 py-2 text-left text-sm ...';
  ```

## 4. Keyboard Sequence and DOM Navigation

Automated Rule: **`document-title`**, **`bypass`**, **`landmark-one-main`**, **`region`**

- Semantic landmarks (`<main>`, `<nav>`, `<header>`, `<footer>`) must define page layout.
- Dialog and modal flows must implement focus trapping on mount and restore focus to trigger elements upon dismissal.
- Avoid positive `tabindex` values; rely on natural DOM ordering.

## 5. Reduced Motion

Media query specification:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

All UI animations must utilize Tailwind `motion-reduce:transition-none` and `motion-reduce:animate-none` to protect users with vestibular motion sensitivities.
