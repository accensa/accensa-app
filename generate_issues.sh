#!/bin/bash

# Create labels for complexity
gh label create "complexity: 100" --color "0075ca" --description "Trivial: Small, clearly bounded changes" || true
gh label create "complexity: 150" --color "a2eeef" --description "Medium: Standard features or logic touching multiple parts" || true
gh label create "complexity: 200" --color "d73a4a" --description "High: Complex engineering work such as integrations" || true
gh label create "area: contracts" --color "bfd4f2" || true
gh label create "area: indexer" --color "bfd4f2" || true
gh label create "area: web" --color "bfd4f2" || true
gh label create "area: sdk" --color "bfd4f2" || true

# Issue 1: M2 Route Attribution Hook
gh issue create \
  --title "feat(sdk): implement Express middleware hook for Path B route attribution" \
  --label "complexity: 150","area: sdk" \
  --body "## Summary
We need to implement a small middleware hook that plugs into the existing x402 server middleware. It will POST \`(tx_hash, route, method, price, request_id)\` to our indexer after each settle confirmation.

## Acceptance Criteria
- [ ] Implement \`attachAccensaHook(app, opts)\` in \`packages/sdk\`.
- [ ] Send POST request to indexer's \`/hook/settle\` endpoint upon settlement.
- [ ] Authenticate request with \`HOOK_API_KEY\` from environment.
- [ ] Include unit tests.

## Tech Stack
TypeScript, Express, Node.js fetch API"

# Issue 2: M3 Receipts Contract
cd ../accensa-contracts
gh label create "complexity: 200" --color "d73a4a" --description "High: Complex engineering work such as integrations" || true
gh label create "area: contracts" --color "bfd4f2" || true
gh issue create \
  --title "feat(contracts): implement ReceiptAnchor Soroban contract" \
  --label "complexity: 200","area: contracts" \
  --body "## Summary
Create the \`ReceiptAnchor\` contract in Rust/Soroban. Its sole responsibility is to store batch commitments (Merkle roots) of payment receipts, anchored by the merchant.

## Acceptance Criteria
- [ ] Implement \`initialize(merchant: Address)\` storing merchant address and version.
- [ ] Implement \`anchor_batch(root: BytesN<32>, count: u32, period_start: u64, period_end: u64)\` (must require auth from merchant).
- [ ] Implement \`get_batch(batch_id: u64) -> BatchRecord\`.
- [ ] Implement \`verify_receipt(batch_id: u64, leaf: BytesN<32>, proof: Vec<BytesN<32>>)\`.
- [ ] Comprehensive unit tests using \`soroban-sdk\` testing utilities.

## Tech Stack
Rust, soroban-sdk"

# Issue 3: M4 Refund Vault Contract
gh issue create \
  --title "feat(contracts): implement RefundVault Soroban contract" \
  --label "complexity: 200","area: contracts" \
  --body "## Summary
Create the \`RefundVault\` contract. It will hold the merchant's USDC refund float and execute refunds within a declared policy window.

## Acceptance Criteria
- [ ] Implement \`initialize(merchant, token, refund_window_ledgers: u32)\`.
- [ ] Implement \`deposit(amount: i128)\` requiring merchant auth.
- [ ] Implement \`refund(payment_ref: BytesN<32>, recipient: Address, amount: i128, paid_at_ledger: u32)\` with double-refund guards and window checks.
- [ ] Implement \`withdraw(amount: i128, to: Address)\`.
- [ ] Comprehensive tests for success and failure cases (expired window, already refunded, insufficient float).

## Tech Stack
Rust, soroban-sdk"

# Issue 4: M3 Receipts SDK Verification
cd ../accensa-app
gh issue create \
  --title "feat(sdk): add off-chain receipt verification utility" \
  --label "complexity: 100","area: sdk" \
  --body "## Summary
Agent operators need a way to verify a receipt against an anchored batch without hitting the chain. Add a utility to the SDK to verify Merkle proofs for payments.

## Acceptance Criteria
- [ ] Implement \`verifyReceipt(receipt, proof, batchRoot)\` in \`packages/sdk\`.
- [ ] Ensure byte-exact canonical serialization for \`tx_hash || route || amount || payer || ledger\`.
- [ ] Include test vectors matching the Rust contract.

## Tech Stack
TypeScript"

echo "Issues generated successfully."
