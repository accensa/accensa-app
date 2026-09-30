import { Keypair, xdr, TransactionBuilder, Contract, Account, Address } from '@stellar/stellar-sdk';
import { buildSorobanAuthEntry, type SorobanAuthEntryInput } from './builder';

export interface OfflineSigningInput {
  contractId: string;
  functionName: string;
  args: xdr.ScVal[];
  secretKey: string;
  networkPassphrase: string;
  sourceAccount: string;
  sequence: string;
  fee?: string;
  timeout?: number;
}

/**
 * Signs a Soroban transaction offline using a merchant keypair.
 *
 * This function operates without browser dependencies, making it suitable for
 * merchant daemon backends and automated signing workflows.
 */
export function signOfflineTransaction(input: OfflineSigningInput): {
  signedTransaction: string;
  transactionHash: string;
} {
  const {
    contractId,
    functionName,
    args,
    secretKey,
    networkPassphrase,
    sourceAccount,
    sequence,
    fee = '100',
    timeout = 30,
  } = input;

  const keypair = Keypair.fromSecret(secretKey);

  // Build and sign the transaction with the contract invocation.
  const account = new Account(sourceAccount, sequence);
  const transaction = new TransactionBuilder(account, { fee, networkPassphrase })
    .addOperation(new Contract(contractId).call(functionName, ...args))
    .setTimeout(timeout)
    .build();

  transaction.sign(keypair);

  // The transaction hash is the SHA-256 of the signature base (the bytes the
  // signatures are made over), matching what the network computes.
  const { createHash } = require('crypto') as typeof import('crypto');
  const transactionHash = createHash('sha256').update(transaction.signatureBase()).digest('hex');

  return {
    signedTransaction: transaction.toXDR(),
    transactionHash,
  };
}

/**
 * Creates a SorobanAuthorizationEntry and signs it offline.
 *
 * The signed payload is the XDR encoding of the entry's root invocation, and
 * the signature is stored in the address credentials' signature vector as an
 * `ScBytes` value (the shape the Soroban host expects from account
 * authorizations).
 */
export function signAuthEntryOffline(
  input: Omit<SorobanAuthEntryInput, 'signer'> & { secretKey: string },
): xdr.SorobanAuthorizationEntry {
  const keypair = Keypair.fromSecret(input.secretKey);

  const entry = buildSorobanAuthEntry({
    ...input,
    signer: new Address(keypair.publicKey()),
  });

  const payload = entry.rootInvocation().toXDR();
  const signature = keypair.sign(payload);

  // js-xdr types `value()` as a union with `void`; the entry was built with
  // address credentials, so the arm is SorobanAddressCredentials at runtime.
  const credentialsValue = entry.credentials().value() as xdr.SorobanAddressCredentials;
  const signedCredentials = new xdr.SorobanAddressCredentials({
    address: credentialsValue.address(),
    nonce: credentialsValue.nonce(),
    signatureExpirationLedger: credentialsValue.signatureExpirationLedger(),
    signature: xdr.ScVal.scvVec([xdr.ScVal.scvBytes(signature)]),
  });

  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(signedCredentials),
    rootInvocation: entry.rootInvocation(),
  });
}

/**
 * Verifies a signed SorobanAuthorizationEntry.
 *
 * Checks that the credentials' first signature verifies against the entry's
 * root invocation preimage for the given public key, and that the credentials
 * belong to that key.
 */
export function verifyAuthEntrySignature(
  authEntry: xdr.SorobanAuthorizationEntry,
  publicKey: string,
): boolean {
  try {
    const keypair = Keypair.fromPublicKey(publicKey);
    // js-xdr types `value()` as a union with `void`; if the credentials are
    // not address credentials the casts' members simply do not exist and the
    // catch below returns false.
    const credentialsValue = authEntry.credentials().value() as xdr.SorobanAddressCredentials;

    if (Address.fromScAddress(credentialsValue.address()).toString() !== publicKey) {
      return false;
    }

    // The signature field is an ScVal (an scvVec of ScBytes); js-xdr types
    // `value()` as the full ScVal payload union, so narrow it to the vec array.
    const signatures = credentialsValue.signature().value() as xdr.ScVal[];
    if (!signatures || signatures.length === 0) {
      return false;
    }

    const payload = authEntry.rootInvocation().toXDR();
    const signatureBytes = signatures[0].value() as Buffer;
    return keypair.verify(payload, signatureBytes);
  } catch {
    return false;
  }
}
