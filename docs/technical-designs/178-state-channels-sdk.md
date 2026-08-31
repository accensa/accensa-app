# Issue #178: High-Performance State Channel SDK for Micro-transactions

## Overview

Implement off-chain state channels in `@accensa/sdk` to enable sub-cent micro-transactions (pay-per-article, streaming payments) without on-chain latency and fees. Batch thousands of off-chain updates before final settlement to Soroban.

## Problem

On-chain transaction model:

- **Latency**: 5-6 seconds per Soroban transaction (ledger close time)
- **Fees**: 0.00001 XLM base fee + contract execution costs
- **Throughput**: Limited by network TPS (~1000/sec globally)
- **UX**: Waiting 5s per $0.01 article purchase is unacceptable

State channels solve this:

- **Latency**: <50ms for off-chain signature exchange
- **Fees**: Zero until channel closes (one on-chain settlement)
- **Throughput**: Unlimited off-chain (CPU-bound only)
- **UX**: Instant confirmations for micro-transactions

## State Channel Protocol

### Lifecycle

```
1. OPEN: Merchant and buyer deploy channel contract on-chain
   - Both deposit initial balances (e.g., merchant: 0, buyer: 10 XLM)
   - Channel ID = contract address
   - Timeout = 7 days (dispute window)

2. UPDATE (off-chain, repeated 1000s of times):
   - Buyer reads article ($0.10 XLM)
   - Both parties sign new state: { nonce: 1, buyer: 9.9, merchant: 0.1 }
   - Buyer reads another article
   - Both parties sign: { nonce: 2, buyer: 9.8, merchant: 0.2 }
   - ... (continues off-chain)

3. CLOSE (on-chain, cooperative):
   - Both parties agree on final state: { nonce: 1000, buyer: 0, merchant: 10 }
   - Submit to contract with dual signatures
   - Contract disburses balances
   - Gas cost: ~1 transaction

4. DISPUTE (on-chain, non-cooperative):
   - If merchant disappears, buyer submits latest signed state
   - Timeout period starts (7 days)
   - If merchant has newer state, they can challenge
   - After timeout, contract disburses per latest state
```

### State Format

```typescript
interface ChannelState {
  channelId: string; // Contract address
  nonce: number; // Monotonically increasing
  balances: {
    buyer: string; // Decimal XLM amount
    merchant: string;
  };
  timeout: number; // Unix timestamp for disputes
}

interface SignedState {
  state: ChannelState;
  buyerSignature: string; // Ed25519 signature
  merchantSignature: string;
}
```

## SDK Architecture

### File: `packages/sdk/state-channel.ts`

```typescript
export class StateChannel {
  private channelId: string;
  private currentState: SignedState;
  private buyerKeypair: Keypair;
  private merchantPublicKey: string;

  // Open a new channel (on-chain)
  static async open(params: {
    buyer: Keypair;
    merchant: string;
    buyerDeposit: string;
    merchantDeposit: string;
    timeout: number;
  }): Promise<StateChannel>;

  // Create and sign new state (off-chain)
  async proposeUpdate(delta: { buyer: string; merchant: string }): Promise<SignedState>;

  // Verify counterparty signature
  verifyCounterpartySignature(state: SignedState): boolean;

  // Accept counterparty's proposed state
  async acceptUpdate(state: SignedState): Promise<SignedState>;

  // Close channel cooperatively (on-chain)
  async close(): Promise<string>; // Returns txHash

  // Submit dispute (on-chain)
  async dispute(): Promise<string>;

  // Challenge a dispute with newer state (on-chain)
  async challenge(newerState: SignedState): Promise<string>;
}
```

### Example Usage

```typescript
import { StateChannel } from '@accensa/sdk';

// Buyer opens channel with 10 XLM deposit
const channel = await StateChannel.open({
  buyer: buyerKeypair,
  merchant: merchantAddress,
  buyerDeposit: '10.0',
  merchantDeposit: '0',
  timeout: 604800, // 7 days
});

// Buyer purchases article (off-chain, instant)
const newState = await channel.proposeUpdate({
  buyer: '9.9',
  merchant: '0.1',
});

// Merchant verifies and signs
if (channel.verifyCounterpartySignature(newState)) {
  const dualSigned = await channel.acceptUpdate(newState);
  // Grant access to article
}

// After many purchases, close channel
const txHash = await channel.close();
```

## Soroban Contract Design

### File: `contracts/state-channel/src/lib.rs`

```rust
pub struct ChannelState {
    pub nonce: u64,
    pub balances: Map<Address, i128>,
    pub timeout: u64,
    pub status: ChannelStatus,
}

pub enum ChannelStatus {
    Open,
    Disputed,
    Closed,
}

pub trait StateChannelTrait {
    // Open channel with initial deposits
    fn open(env: Env, parties: Vec<Address>, deposits: Vec<i128>) -> BytesN<32>;

    // Cooperative close with dual signatures
    fn close(env: Env, channel_id: BytesN<32>, state: ChannelState, sigs: Vec<BytesN<64>>);

    // Initiate dispute with latest state
    fn dispute(env: Env, channel_id: BytesN<32>, state: ChannelState, sigs: Vec<BytesN<64>>);

    // Challenge dispute with newer state
    fn challenge(env: Env, channel_id: BytesN<32>, newer_state: ChannelState, sigs: Vec<BytesN<64>>);

    // Finalize after timeout
    fn finalize(env: Env, channel_id: BytesN<32>);
}
```

**Contract Deployment**: Deploy to Stellar testnet first, mainnet after audit

## Implementation Plan

### Phase 1: Contract Development (Weeks 1-2)

- [ ] Write Soroban state channel contract
- [ ] Implement signature verification (Ed25519)
- [ ] Add dispute resolution logic
- [ ] Write contract tests (100% coverage)
- [ ] Deploy to testnet

### Phase 2: SDK Core (Weeks 3-4)

- [ ] Implement `StateChannel` class
- [ ] Add signature generation/verification
- [ ] Add state serialization (deterministic)
- [ ] Add nonce management
- [ ] Unit tests for SDK

### Phase 3: Integration (Week 5)

- [ ] Add channel opening to merchant dashboard
- [ ] Add payment flow to demo-merchant
- [ ] Build buyer SDK example
- [ ] E2E test: open → 1000 updates → close

### Phase 4: Production Hardening (Week 6)

- [ ] Add error handling (network failures, timeout)
- [ ] Add state persistence (IndexedDB for buyer)
- [ ] Add reconnection logic
- [ ] Security audit (external firm)
- [ ] Mainnet deployment

## Security Considerations

### Signature Verification

- Use `stellar-sdk` for Ed25519 signature generation
- Verify both signatures before accepting state
- Prevent signature replay attacks (nonce must increase)

### Nonce Management

- Client MUST reject state with non-increasing nonce
- Nonce gaps are acceptable (e.g., 1 → 5) but not reversals

### Dispute Window

- 7 days default (configurable per channel)
- Balance: Long enough for merchant to respond, short enough for UX
- Alert mechanisms: Email/webhook when dispute initiated

### Griefing Attacks

- Buyer can spam dispute with old state (gas cost attack)
- Mitigation: Require dispute bond (e.g., 0.1 XLM) returned only if dispute is valid

## Performance Targets

- **Channel opening**: <10s (one on-chain transaction)
- **Off-chain update**: <50ms (sign + verify)
- **Channel closing**: <10s (one on-chain transaction)
- **Throughput**: 1000+ updates/sec per channel (CPU-bound)

## Cost Analysis

### Without State Channels

- 1000 micro-transactions × 0.00001 XLM = 0.01 XLM (~$0.002)
- 1000 transactions × 5s latency = 5000s wait time

### With State Channels

- Channel open: 0.00001 XLM
- 1000 off-chain updates: 0 XLM
- Channel close: 0.00001 XLM
- **Total: 0.00002 XLM (~$0.000004)** — 500x cheaper
- **Total latency: 20s** (open + close) — 250x faster

## Success Metrics

- [ ] 1000 off-chain updates in <60 seconds
- [ ] Channel opening/closing success rate >99%
- [ ] Dispute resolution works correctly in test scenarios
- [ ] Zero loss of funds in security audit
- [ ] Production usage: 10+ channels with 100+ updates each

## References

- Lightning Network (Bitcoin): https://lightning.network/
- Raiden Network (Ethereum): https://raiden.network/
- State Channels Explained: https://statechannels.org/
- Stellar Soroban Docs: https://soroban.stellar.org/
