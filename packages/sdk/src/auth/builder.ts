import { xdr, SorobanDataBuilder, Address } from '@stellar/stellar-sdk';

export interface SorobanAuthEntryInput {
  contractId: string;
  functionName: string;
  args: xdr.ScVal[];
  signer: Address;
  networkPassphrase: string;
}

/**
 * Builds a SorobanAuthorizationEntry for a contract invocation.
 *
 * Constructs a full address-credentials entry whose root invocation calls
 * `functionName` on `contractId` with `args`. The entry is returned unsigned:
 * the caller signs `rootInvocation().toXDR()` (see `signAuthEntryOffline`) and
 * places the signature into the credentials' signature vector.
 */
export function buildSorobanAuthEntry({
  contractId,
  functionName,
  args,
  signer,
}: SorobanAuthEntryInput): xdr.SorobanAuthorizationEntry {
  const invocationArgs = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contractId).toScAddress(),
    // InvokeContractArgs takes the raw symbol string in stellar-sdk v16.
    functionName,
    args,
  });

  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invocationArgs),
    subInvocations: [],
  });

  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: signer.toScAddress(),
      nonce: new xdr.Int64(0),
      signatureExpirationLedger: 0,
      signature: xdr.ScVal.scvVec([]),
    }),
  );

  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
}

/**
 * Parses Soroban simulation results to extract resource requirements.
 *
 * Returns the CPU instructions and memory footprint needed for the transaction,
 * which can be used to set precise resource bounds before signing.
 */
export interface ResourceRequirements {
  instructions: bigint;
  readBytes: bigint;
  writeBytes: bigint;
}

export function parseSimulationResources(
  simulationResult: xdr.SorobanTransactionData,
): ResourceRequirements {
  const resources = simulationResult.resources();
  return {
    instructions: BigInt(resources.instructions()),
    readBytes: BigInt(resources.diskReadBytes()),
    writeBytes: BigInt(resources.writeBytes()),
  };
}

/**
 * Injects resource bounds into a Soroban transaction based on simulation results.
 *
 * Rebuilds the transaction's ext v1 SorobanTransactionData with the given
 * resource bounds, so the transaction has sufficient resources to execute
 * successfully on the network.
 */
export function injectResourceBounds(
  transaction: xdr.Transaction,
  resources: ResourceRequirements,
): xdr.Transaction {
  const ext = transaction.ext();
  if (ext.switch() !== 1) {
    throw new Error('Transaction is not a Soroban transaction');
  }

  // js-xdr types `value()` as a union with `void`; the switch check above
  // guarantees the v1 arm (SorobanTransactionData) at runtime.
  const existingData = ext.value() as xdr.SorobanTransactionData;
  const sorobanData = new SorobanDataBuilder(existingData.toXDR())
    .setResources(
      Number(resources.instructions),
      Number(resources.readBytes),
      Number(resources.writeBytes),
    )
    .build();

  return new xdr.Transaction({
    sourceAccount: transaction.sourceAccount(),
    fee: transaction.fee(),
    seqNum: transaction.seqNum(),
    cond: transaction.cond(),
    memo: transaction.memo(),
    operations: transaction.operations(),
    ext: new xdr.TransactionExt(1, sorobanData),
  });
}

/**
 * Handles signature expiration sequence buffers to avoid transaction expiration
 * under network congestion.
 *
 * Adds a buffer to the min sequence age to ensure transactions remain valid
 * even if the network is congested and takes longer to process.
 */
export function calculateSequenceBuffer(
  currentSequence: bigint,
  bufferSeconds: number = 300,
): bigint {
  // Stellar time is in seconds, sequence numbers increment every ~5 seconds
  // Add buffer to account for network congestion
  const bufferSequence = BigInt(Math.ceil(bufferSeconds / 5));
  return currentSequence + bufferSequence;
}
