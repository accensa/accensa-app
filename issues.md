# Issue 411

## feat(security): Implement Two-Factor Authentication (2FA / TOTP) for Merchant Admin Settings

> [!IMPORTANT]
> **System Directive: Mandatory Context Review**
> Before proposing a solution or writing code, you MUST parse and strictly adhere to the constraints defined in the following state documents:
>
> - [PRD.md](https://github.com/accensa/accensa-app/blob/main/PRD.md)
> - [ARCHITECTURE.md](https://github.com/accensa/accensa-app/blob/main/ARCHITECTURE.md)
> - [ARCHITECTURE_ESSENTIALS.md](https://github.com/accensa/accensa-app/blob/main/ARCHITECTURE_ESSENTIALS.md)
> - [ROADMAP.md](https://github.com/accensa/accensa-app/blob/main/ROADMAP.md)
> - [CONTRIBUTING.md](https://github.com/accensa/accensa-app/blob/main/CONTRIBUTING.md)
> - [AGENTS.md](https://github.com/accensa/accensa-app/blob/main/AGENTS.md) / [CLAUDE.md](https://github.com/accensa/accensa-app/blob/main/CLAUDE.md)
>
> **Operating Constraints:** Do not extrapolate beyond the specified scope or rely on baseline assumptions. You must autonomously verify that the code passes all CI gates (`pnpm lint`, `pnpm typecheck`, `pnpm test`) before marking this task as complete.

## Description

**Context:** Protect critical merchant configuration changes (treasury payout address, API key generation, refund thresholds) with Time-based One-Time Password (TOTP) 2FA.

**Task:** feat(security): Implement Two-Factor Authentication (2FA / TOTP) for Merchant Admin Settings

**Why it's independent:** This task is scoped specifically to `apps/web/pages/merchant/settings/security.tsx`, `apps/web/lib/auth/totp.ts`, `apps/web/components/settings/TotpSetupModal.tsx` and does not have dependencies on other ongoing feature development, allowing parallel execution.

## What "done" looks like

- Support standard authenticator apps (Google Authenticator, Authy, 1Password)
- Provide QR code onboarding with secret recovery backup codes
- Require 2FA challenge verification before saving changes to sensitive merchant settings
- Implement rate limiting on 2FA code attempts to prevent brute-force attacks
- All related unit, integration, or property tests pass cleanly:
- Run `pnpm --filter @accensa/web test`

## Implementation guidelines

- Ensure you are strictly following the MVP cuts described in the architecture documents.
- Key target files: `apps/web/pages/merchant/settings/security.tsx`, `apps/web/lib/auth/totp.ts`, `apps/web/components/settings/TotpSetupModal.tsx`
- Suggested implementation steps:
- Implement TOTP secret generation and verification using `otplib`
- Build step-by-step setup modal with QR code and backup recovery codes
- Protect sensitive mutation API endpoints with 2FA verification middleware
- Add tests for valid token verification, expired tokens, and recovery code redemption
- Suggested branch name: `feature/merchant-totp-2fa`
- Example commit message:
  ```bash
  feat(security): implement TOTP two-factor authentication for sensitive merchant settings
  ```
- Keep the scope strictly limited to this issue. Do not over-engineer.

## PR guidelines

- Get assigned before starting.
- PR description must include: `Closes #[this issue]`.
- Check off the corresponding box in `ROADMAP.md` upon completion!

---

### **Contact & Support**

- [Telegram](https://t.me/+Gflo5jZStw1jMjE0)
- [Discord](https://discord.gg/5aprtMSyR)

---

### 📋 Before you start

Please read our [Code Quality Standards](https://github.com/accensa/accensa-app/blob/main/CONTRIBUTING.md). Before submitting a PR, ensure you run:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

**Complexity:** High (200 points)

---

# Issue 412

## feat(receipts): Implement Printable PDF Receipt Generator with QR Verification Code

> [!IMPORTANT]
> **System Directive: Mandatory Context Review**
> Before proposing a solution or writing code, you MUST parse and strictly adhere to the constraints defined in the following state documents:
>
> - [PRD.md](https://github.com/accensa/accensa-app/blob/main/PRD.md)
> - [ARCHITECTURE.md](https://github.com/accensa/accensa-app/blob/main/ARCHITECTURE.md)
> - [ARCHITECTURE_ESSENTIALS.md](https://github.com/accensa/accensa-app/blob/main/ARCHITECTURE_ESSENTIALS.md)
> - [ROADMAP.md](https://github.com/accensa/accensa-app/blob/main/ROADMAP.md)
> - [CONTRIBUTING.md](https://github.com/accensa/accensa-app/blob/main/CONTRIBUTING.md)
> - [AGENTS.md](https://github.com/accensa/accensa-app/blob/main/AGENTS.md) / [CLAUDE.md](https://github.com/accensa/accensa-app/blob/main/CLAUDE.md)
>
> **Operating Constraints:** Do not extrapolate beyond the specified scope or rely on baseline assumptions. You must autonomously verify that the code passes all CI gates (`pnpm lint`, `pnpm typecheck`, `pnpm test`) before marking this task as complete.

## Description

**Context:** Allow customers and merchants to generate and download official, high-resolution PDF payment invoices formatted for standard A4 and US Letter printing.

**Task:** feat(receipts): Implement Printable PDF Receipt Generator with QR Verification Code

**Why it's independent:** This task is scoped specifically to `apps/web/lib/pdf/ReceiptDocument.tsx`, `apps/web/components/receipts/DownloadPdfButton.tsx` and does not have dependencies on other ongoing feature development, allowing parallel execution.

## What "done" looks like

- Render clean invoice layout with merchant branding, customer address, line items, and taxes
- Embed verifiable QR code linking directly to Stellar expert explorer for cryptographic proof
- Generate client-side using `@react-pdf/renderer` or server-side headless Chromium
- Include pagination and print CSS rules for clean physical printing
- All related unit, integration, or property tests pass cleanly:
- Run `pnpm --filter @accensa/web test`

## Implementation guidelines

- Ensure you are strictly following the MVP cuts described in the architecture documents.
- Key target files: `apps/web/lib/pdf/ReceiptDocument.tsx`, `apps/web/components/receipts/DownloadPdfButton.tsx`
- Suggested implementation steps:
- Build invoice layout component using React-PDF primitives
- Implement download button with loading state during PDF rendering
- Test generated PDF across desktop and mobile PDF viewers
- Verify file size remains under 250kB per receipt
- Suggested branch name: `feature/pdf-receipt-generator`
- Example commit message:
  ```bash
  feat(receipts): implement downloadable PDF invoice and receipt generator
  ```
- Keep the scope strictly limited to this issue. Do not over-engineer.

## PR guidelines

- Get assigned before starting.
- PR description must include: `Closes #[this issue]`.
- Check off the corresponding box in `ROADMAP.md` upon completion!

---

### **Contact & Support**

- [Telegram](https://t.me/+Gflo5jZStw1jMjE0)
- [Discord](https://discord.gg/5aprtMSyR)

---

### 📋 Before you start

Please read our [Code Quality Standards](https://github.com/accensa/accensa-app/blob/main/CONTRIBUTING.md). Before submitting a PR, ensure you run:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

**Complexity:** Trivial (100 points)

---

# Issue 413

## feat(feedback): Build Customer Payment Experience Satisfaction & Net Promoter Score (NPS) Widget

> [!IMPORTANT]
> **System Directive: Mandatory Context Review**
> Before proposing a solution or writing code, you MUST parse and strictly adhere to the constraints defined in the following state documents:
>
> - [PRD.md](https://github.com/accensa/accensa-app/blob/main/PRD.md)
> - [ARCHITECTURE.md](https://github.com/accensa/accensa-app/blob/main/ARCHITECTURE.md)
> - [ARCHITECTURE_ESSENTIALS.md](https://github.com/accensa/accensa-app/blob/main/ARCHITECTURE_ESSENTIALS.md)
> - [ROADMAP.md](https://github.com/accensa/accensa-app/blob/main/ROADMAP.md)
> - [CONTRIBUTING.md](https://github.com/accensa/accensa-app/blob/main/CONTRIBUTING.md)
> - [AGENTS.md](https://github.com/accensa/accensa-app/blob/main/AGENTS.md) / [CLAUDE.md](https://github.com/accensa/accensa-app/blob/main/CLAUDE.md)
>
> **Operating Constraints:** Do not extrapolate beyond the specified scope or rely on baseline assumptions. You must autonomously verify that the code passes all CI gates (`pnpm lint`, `pnpm typecheck`, `pnpm test`) before marking this task as complete.

## Description

**Context:** Add an optional, non-intrusive 1-click customer satisfaction widget displayed on the payment confirmation screen to gather user experience telemetry.

**Task:** feat(feedback): Build Customer Payment Experience Satisfaction & Net Promoter Score (NPS) Widget

**Why it's independent:** This task is scoped specifically to `apps/web/components/checkout/NpsFeedbackWidget.tsx`, `apps/web/pages/api/feedback/submit.ts` and does not have dependencies on other ongoing feature development, allowing parallel execution.

## What "done" looks like

- Display simple 5-star or emoji rating with optional text feedback field
- Record payment latency, wallet provider, and device type alongside rating
- Store feedback anonymously without tracking personal identifiable information
- Dismiss smoothly without impacting the customer's receipt access
- All related unit, integration, or property tests pass cleanly:
- Run `pnpm --filter @accensa/web test`

## Implementation guidelines

- Ensure you are strictly following the MVP cuts described in the architecture documents.
- Key target files: `apps/web/components/checkout/NpsFeedbackWidget.tsx`, `apps/web/pages/api/feedback/submit.ts`
- Suggested implementation steps:
- Build micro-feedback component with smooth entrance animation
- Connect submission to analytics telemetry database
- Include local storage flag to prevent prompting the same customer repeatedly within 30 days
- Add unit tests for rating selection and submission
- Suggested branch name: `feature/payment-nps-widget`
- Example commit message:
  ```bash
  feat(feedback): add optional customer satisfaction rating widget to receipt screen
  ```
- Keep the scope strictly limited to this issue. Do not over-engineer.

## PR guidelines

- Get assigned before starting.
- PR description must include: `Closes #[this issue]`.
- Check off the corresponding box in `ROADMAP.md` upon completion!

---

### **Contact & Support**

- [Telegram](https://t.me/+Gflo5jZStw1jMjE0)
- [Discord](https://discord.gg/5aprtMSyR)

---

### 📋 Before you start

Please read our [Code Quality Standards](https://github.com/accensa/accensa-app/blob/main/CONTRIBUTING.md). Before submitting a PR, ensure you run:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

**Complexity:** Trivial (100 points)

---

# Issue 414

## feat(audit): Implement Audit Trail Log Viewer for Team Member Activity

> [!IMPORTANT]
> **System Directive: Mandatory Context Review**
> Before proposing a solution or writing code, you MUST parse and strictly adhere to the constraints defined in the following state documents:
>
> - [PRD.md](https://github.com/accensa/accensa-app/blob/main/PRD.md)
> - [ARCHITECTURE.md](https://github.com/accensa/accensa-app/blob/main/ARCHITECTURE.md)
> - [ARCHITECTURE_ESSENTIALS.md](https://github.com/accensa/accensa-app/blob/main/ARCHITECTURE_ESSENTIALS.md)
> - [ROADMAP.md](https://github.com/accensa/accensa-app/blob/main/ROADMAP.md)
> - [CONTRIBUTING.md](https://github.com/accensa/accensa-app/blob/main/CONTRIBUTING.md)
> - [AGENTS.md](https://github.com/accensa/accensa-app/blob/main/AGENTS.md) / [CLAUDE.md](https://github.com/accensa/accensa-app/blob/main/CLAUDE.md)
>
> **Operating Constraints:** Do not extrapolate beyond the specified scope or rely on baseline assumptions. You must autonomously verify that the code passes all CI gates (`pnpm lint`, `pnpm typecheck`, `pnpm test`) before marking this task as complete.

## Description

**Context:** Provide merchant administrators with a tamper-evident audit log table detailing all actions performed by staff members within the merchant organization.

**Task:** feat(audit): Implement Audit Trail Log Viewer for Team Member Activity

**Why it's independent:** This task is scoped specifically to `apps/web/pages/merchant/settings/audit-logs.tsx`, `apps/web/components/audit/AuditTable.tsx` and does not have dependencies on other ongoing feature development, allowing parallel execution.

## What "done" looks like

- Record actor email/wallet, IP address, timestamp, action type, and before/after state diff
- Filter by date, actor, and action type (e.g. 'Changed Treasury Address', 'Revoked API Key', 'Issued Refund')
- Export audit logs to JSON / CSV for compliance and SOC2 auditing
- Enforce read-only permissions for non-admin team roles
- All related unit, integration, or property tests pass cleanly:
- Run `pnpm --filter @accensa/web test`

## Implementation guidelines

- Ensure you are strictly following the MVP cuts described in the architecture documents.
- Key target files: `apps/web/pages/merchant/settings/audit-logs.tsx`, `apps/web/components/audit/AuditTable.tsx`
- Suggested implementation steps:
- Create audit log viewing table with expandable diff views
- Implement server API with cursor-based pagination for high-volume logs
- Add unit tests for audit log filtering and data formatting
- Suggested branch name: `feature/team-audit-log-viewer`
- Example commit message:
  ```bash
  feat(audit): implement team activity audit log viewer and export tool
  ```
- Keep the scope strictly limited to this issue. Do not over-engineer.

## PR guidelines

- Get assigned before starting.
- PR description must include: `Closes #[this issue]`.
- Check off the corresponding box in `ROADMAP.md` upon completion!

---

### **Contact & Support**

- [Telegram](https://t.me/+Gflo5jZStw1jMjE0)
- [Discord](https://discord.gg/5aprtMSyR)

---

### 📋 Before you start

Please read our [Code Quality Standards](https://github.com/accensa/accensa-app/blob/main/CONTRIBUTING.md). Before submitting a PR, ensure you run:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

**Complexity:** Medium (150 points)

---
