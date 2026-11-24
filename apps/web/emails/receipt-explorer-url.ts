import { explorerTxUrl, type StellarNetwork } from '../src/lib/explorer';

export function receiptExplorerUrl(txHash: string, network?: StellarNetwork): string {
  return explorerTxUrl(txHash, network);
}
