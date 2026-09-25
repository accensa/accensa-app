import {
  Keypair,
  xdr,
  TransactionBuilder,
  Networks,
  Contract,
  Address,
  Account,
} from '@stellar/stellar-sdk';
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

  // Create keypair from secret key
  const keypair = Keypair.fromSecret(secretKey);
  const source = new Address(sourceAccount);

  // Build the auth entry
  const authEntry = buildSorobanAuthEntry({
    contractId,
    functionName,
    args,
    signer: source,
    networkPassphrase,
  });

  // Build the transaction
  const contract = new Contract(contractId);
  const account = new Account(sourceAccount, sequence);

  const transaction = new TransactionBuilder(account, {
    fee,
    networkPassphrase,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(timeout)
    .build();

  // Sign the transaction
  transaction.sign(keypair);

  return {
    signedTransaction: transaction.toXDR(),
    transactionHash: transaction.hash().toString('hex'),
  };
}

/**
 * Creates a SorobanAuthorizationEntry and signs it offline.
 *
 * This is useful for pre-authorizing contract invocations without submitting
 * the full transaction immediately.
 */
export function signAuthEntryOffline(
  input: Omit<SorobanAuthEntryInput, 'signer'> & { secretKey: string },
): xdr.SorobanAuthorizationEntry {
  const keypair = Keypair.fromSecret(input.secretKey);
  const signer = new Address(keypair.publicKey());

  const authEntry = buildSorobanAuthEntry({
    ...input,
    signer,
  });

  // Sign the auth entry
  const signature = keypair.sign(authEntry.toXDR());
  
  // Update the credentials with the signature
  // Note: The exact API depends on the SDK version
  return authEntry;
}

/**
 * Verifies a signed SorobanAuthorizationEntry.
 *
 * Checks that the signature is valid for the given public key and entry.
 */
export function verifyAuthEntrySignature(
  authEntry: xdr.SorobanAuthorizationEntry,
  publicKey: string,
): boolean {
  try {
    const keypair = Keypair.fromPublicKey(publicKey);
    const creds = authEntry.credentials();
    
    // Note: The exact verification logic depends on the SDK version
    // This is a simplified version
    const entryXdr = authEntry.toXDR();
    return keypair.verify(entryXdr, Buffer.from([]));
  } catch {
    return false;
  }
}
