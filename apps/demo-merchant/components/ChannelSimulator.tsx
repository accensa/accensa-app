import { useEffect, useState } from 'react';

interface ChannelSigners {
  merchant: CryptoKeyPair;
  customer: CryptoKeyPair;
}

interface SignedState {
  merchant: string;
  customer: string;
}

const initialMerchantBalance = 4.2;
const channelTotal = 10;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createSigner() {
  return (await window.crypto.subtle.generateKey({ name: 'Ed25519' } as AlgorithmIdentifier, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
}

async function signState(key: CryptoKey, message: string) {
  const signature = await window.crypto.subtle.sign(
    { name: 'Ed25519' } as AlgorithmIdentifier,
    key,
    new TextEncoder().encode(message),
  );
  return toHex(new Uint8Array(signature));
}

function shortKey(key: CryptoKey) {
  return window.crypto.subtle.exportKey('raw', key).then((value) => {
    const hex = toHex(new Uint8Array(value));
    return `${hex.slice(0, 12)}...${hex.slice(-8)}`;
  });
}

export default function ChannelSimulator() {
  const [signers, setSigners] = useState<ChannelSigners | null>(null);
  const [merchantBalance, setMerchantBalance] = useState(initialMerchantBalance);
  const [sequence, setSequence] = useState(0);
  const [signedState, setSignedState] = useState<SignedState | null>(null);
  const [publicKeys, setPublicKeys] = useState<{ merchant: string; customer: string } | null>(null);
  const [disputeStatus, setDisputeStatus] = useState<'idle' | 'resolved'>('idle');

  useEffect(() => {
    let active = true;
    Promise.all([createSigner(), createSigner()]).then(([merchant, customer]) => {
      if (active) setSigners({ merchant, customer });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!signers) return;
    let active = true;
    const payload = JSON.stringify({
      channelId: 'demo-channel-01',
      sequence,
      merchantBalance: merchantBalance.toFixed(2),
      customerBalance: (channelTotal - merchantBalance).toFixed(2),
      asset: 'XLM',
    });

    Promise.all([
      signState(signers.merchant.privateKey, payload),
      signState(signers.customer.privateKey, payload),
      shortKey(signers.merchant.publicKey),
      shortKey(signers.customer.publicKey),
    ]).then(([merchant, customer, merchantKey, customerKey]) => {
      if (!active) return;
      setSignedState({ merchant, customer });
      setPublicKeys({ merchant: merchantKey, customer: customerKey });
    });

    return () => {
      active = false;
    };
  }, [merchantBalance, sequence, signers]);

  const updateBalance = (value: number) => {
    setMerchantBalance(value);
    setSequence((current) => current + 1);
    setDisputeStatus('idle');
  };

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
              Channel 01 / Testnet demo
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">Payment state</h2>
          </div>
          <span className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
            Simulated, no funds move
          </span>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <div className="border-l-2 border-emerald-500 pl-4">
            <p className="text-sm text-slate-500">Merchant balance</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
              {merchantBalance.toFixed(2)} <span className="text-base font-medium">XLM</span>
            </p>
          </div>
          <div className="border-l-2 border-cyan-600 pl-4">
            <p className="text-sm text-slate-500">Customer balance</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
              {(channelTotal - merchantBalance).toFixed(2)}{' '}
              <span className="text-base font-medium">XLM</span>
            </p>
          </div>
        </div>

        <label className="mt-8 block text-sm font-medium text-slate-800" htmlFor="merchant-balance">
          Transfer value to merchant
        </label>
        <input
          id="merchant-balance"
          aria-label="Merchant balance in XLM"
          className="mt-3 w-full accent-emerald-600"
          type="range"
          min="0"
          max={channelTotal}
          step="0.1"
          value={merchantBalance}
          onChange={(event) => updateBalance(Number(event.target.value))}
        />
        <div className="mt-1 flex justify-between text-xs tabular-nums text-slate-500">
          <span>0 XLM</span>
          <span>10 XLM total</span>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
          <span className="text-slate-600">
            Latest state <strong className="font-semibold text-slate-950">#{sequence}</strong>
          </span>
          <span className="text-xs text-slate-500">
            {signedState ? 'Dual-signed locally' : 'Creating ephemeral signers...'}
          </span>
        </div>

        <div className="mt-5 rounded-md bg-slate-950 p-4 text-xs text-emerald-200">
          <div className="mb-2 flex justify-between gap-4 text-slate-400">
            <span>Latest signed payload</span>
            <span>Ed25519</span>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
            {JSON.stringify(
              {
                channelId: 'demo-channel-01',
                sequence,
                merchantBalance: merchantBalance.toFixed(2),
                customerBalance: (channelTotal - merchantBalance).toFixed(2),
                asset: 'XLM',
              },
              null,
              2,
            )}
          </pre>
        </div>
      </div>

      <aside className="flex flex-col gap-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Participant signatures</h2>
          <p className="mt-1 text-sm text-slate-500">
            Both parties approve the same balance state.
          </p>
          <div className="mt-5 space-y-4">
            {(['merchant', 'customer'] as const).map((party) => (
              <div key={party} className="border-t border-slate-100 pt-3">
                <div className="flex justify-between gap-3 text-sm">
                  <span className="font-medium capitalize text-slate-800">{party}</span>
                  <span className="font-mono text-xs text-slate-500">
                    {publicKeys?.[party] ?? 'Generating key...'}
                  </span>
                </div>
                <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-slate-600">
                  {signedState?.[party] ?? 'Waiting for signature'}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-rose-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <h2 className="text-lg font-semibold text-slate-950">Dispute walkthrough</h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Submit an earlier signed state to demonstrate how a newer sequence wins a challenge.
            This walkthrough updates locally and does not submit a blockchain transaction.
          </p>
          <button
            className="mt-5 w-full rounded-md bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={sequence === 0 || !signedState}
            onClick={() => setDisputeStatus('resolved')}
          >
            Simulate malicious stale-state dispute
          </button>
          {disputeStatus === 'resolved' && (
            <p
              aria-live="polite"
              className="mt-3 border-l-2 border-emerald-600 pl-3 text-sm text-emerald-800"
            >
              Challenge resolved: signed state #{sequence} supersedes the earlier state.
            </p>
          )}
        </div>

        <div className="border-l-2 border-slate-300 pl-4 text-sm leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-900">
            Contract source not available in this revision
          </p>
          <p className="mt-1">
            The state-channel contract is still a design, not a deployed Soroban contract.{' '}
            <a
              className="font-medium text-emerald-800 underline underline-offset-2"
              href="https://github.com/accensa/accensa-app/blob/main/docs/technical-designs/178-state-channels-sdk.md"
              target="_blank"
              rel="noreferrer"
            >
              Read the state-channel design
            </a>
            .
          </p>
        </div>
      </aside>
    </section>
  );
}
