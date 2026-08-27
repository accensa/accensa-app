import { x402Client, x402HTTPClient } from '@x402/core/client';
import { createEd25519Signer, getNetworkPassphrase } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

export const NETWORK = 'stellar:testnet';
export const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';

/**
 * Builds a payer from the stock x402 client — no bespoke payer here.
 *
 * The whole point of the x402 conformance story is that unmodified clients
 * work, so the demo inherits that property: `x402Client` + `x402HTTPClient`
 * are the official client classes, and the Stellar `ExactStellarScheme` does
 * the signing. This demo only wires them together.
 *
 * @param {string} privateKey Ed25519 secret key (S... seed) of the payer.
 * @param {string} [rpcUrl] Soroban RPC URL; defaults to the testnet endpoint.
 */
export function createPayer(privateKey, rpcUrl = DEFAULT_RPC_URL) {
  const signer = createEd25519Signer(privateKey, NETWORK);
  const client = new x402Client().register(
    'stellar:*',
    new ExactStellarScheme(signer, rpcUrl ? { url: rpcUrl } : undefined),
  );
  const httpClient = new x402HTTPClient(client);
  return { client, httpClient, signer };
}

/**
 * Pays one x402-protected resource end to end and returns everything a caller
 * needs to report or verify the payment.
 *
 * Steps, in protocol order:
 *   1. GET the resource with no payment headers → the server answers 402 with
 *      a `PaymentRequired` declaration.
 *   2. The stock client selects an acceptable payment requirement and builds a
 *      signed payment payload.
 *   3. The payload is encoded into the `payment-signature` request header.
 *   4. The original request is retried with that header → 200 with the
 *      resource, plus a settlement response header.
 *
 * @param {import('@x402/core/client').x402Client} client
 * @param {import('@x402/core/client').x402HTTPClient} httpClient
 * @param {string} url Absolute URL of the resource to pay for.
 * @param {(step: string, detail?: unknown) => void} [log] Step logger; defaults
 *   to silent so the driver script can print its own summary.
 */
export async function payForResource(client, httpClient, url, log = () => {}) {
  // Step 1 — ask without paying.
  const firstTry = await fetch(url);
  log(`1. GET ${url} → ${firstTry.status}`);
  if (firstTry.status !== 402) {
    // Not an x402-gated route (the demo's free route), or already paid.
    const body = await firstTry.text();
    return { status: firstTry.status, body, paymentRequired: null, settlement: null, paid: false };
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse((name) =>
    firstTry.headers.get(name),
  );
  log(`2. 402 Payment Required — ${paymentRequired.accepts.length} option(s)`);

  // Step 2 — build and sign the payment payload with the stock client.
  let paymentPayload = await client.createPaymentPayload(paymentRequired);
  log(`3. Signed payment payload for ${paymentPayload.accepted?.network ?? NETWORK}`);

  // Step 3 — fee adjustment. The testnet facilitator rejects transactions
  // whose fee exceeds 1 stroop, so the transaction is rebuilt with that fee.
  // This matches the documented x402 Stellar quickstart.
  const networkPassphrase = getNetworkPassphrase(NETWORK);
  const tx = new Transaction(paymentPayload.payload.transaction, networkPassphrase);
  const sorobanData = tx.toEnvelope().v1()?.tx()?.ext()?.sorobanData();
  if (sorobanData) {
    paymentPayload = {
      ...paymentPayload,
      payload: {
        ...paymentPayload.payload,
        transaction: TransactionBuilder.cloneFrom(tx, {
          fee: '1',
          sorobanData,
          networkPassphrase,
        })
          .build()
          .toXDR(),
      },
    };
  }

  // Step 4 — retry with the payment header.
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  log(`4. Retrying with payment-signature header`);
  const paidResponse = await fetch(url, { method: 'GET', headers: paymentHeaders });
  const body = await paidResponse.text();
  const settlement = httpClient.getPaymentSettleResponse((name) => paidResponse.headers.get(name));
  log(`5. GET ${url} → ${paidResponse.status}`);
  if (settlement) {
    log(`6. Settlement: success=${settlement.success} tx=${settlement.transaction}`);
  }

  return {
    status: paidResponse.status,
    body,
    paymentRequired,
    settlement,
    paid: true,
  };
}
