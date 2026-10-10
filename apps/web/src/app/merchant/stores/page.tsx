'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useStoreContext } from '@/context/StoreContext';

interface StoreReport {
  storeId: number;
  name: string;
  paymentCount: number;
  assets: Array<{ asset: string; volume: string }>;
}

interface ConsolidatedReport {
  stores: StoreReport[];
  totals: { paymentCount: number; assets: Array<{ asset: string; volume: string }> };
}

export default function StoresPage() {
  const { stores, activeStoreId, refreshStores, selectStore, loading, error } = useStoreContext();
  const [report, setReport] = useState<ConsolidatedReport | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [refundVaultId, setRefundVaultId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [teamSubject, setTeamSubject] = useState('');
  const [teamRelation, setTeamRelation] = useState<'editor' | 'viewer'>('viewer');
  const [teamRoles, setTeamRoles] = useState<{
    storeId: number;
    roles: Array<{ relation: string; user: string }>;
  } | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const activeStore = stores.find((store) => store.id === activeStoreId);
  const teamStoreId = activeStore?.id;

  useEffect(() => {
    void refreshStores();
    fetch('/api/merchant/stores/consolidated', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load consolidated reporting');
        setReport((await response.json()) as ConsolidatedReport);
      })
      .catch(() => setReport(null));
  }, [refreshStores]);

  useEffect(() => {
    if (!teamStoreId) return;
    let active = true;
    fetch('/api/roles', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load store permissions');
        const result = (await response.json()) as {
          roles: Array<{ relation: string; user: string }>;
        };
        if (active) {
          setTeamRoles({ storeId: teamStoreId, roles: result.roles });
          setTeamError(null);
        }
      })
      .catch((cause) => {
        if (active)
          setTeamError(cause instanceof Error ? cause.message : 'Unable to load permissions');
      });
    return () => {
      active = false;
    };
  }, [teamStoreId]);

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch('/api/merchant/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address, refundVaultId: refundVaultId || null }),
      });
      const result = (await response.json()) as {
        store?: { id: number };
        error?: string;
      };
      if (!response.ok || !result.store) throw new Error(result.error ?? 'Unable to create store');
      await selectStore(result.store.id);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to create store');
    } finally {
      setSaving(false);
    }
  }

  async function updateTeam(subject: string, relation: string, revoke: boolean) {
    const response = await fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, relation, revoke }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      throw new Error(result.error ?? 'Unable to update store permissions');
    }
    const result = (await fetch('/api/roles', { cache: 'no-store' }).then((res) => res.json())) as {
      roles: Array<{ relation: string; user: string }>;
    };
    if (activeStore) setTeamRoles({ storeId: activeStore.id, roles: result.roles });
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 pb-16 pt-28 text-slate-800 dark:text-slate-100 md:px-8">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5 dark:border-white/15">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400">
            Organization
          </p>
          <h1 className="text-3xl font-bold">Stores</h1>
        </div>
        <a
          href="#new-store"
          className="border border-slate-400 px-3 py-2 text-sm font-medium hover:bg-white dark:border-white/20 dark:hover:bg-white/10"
        >
          Add store
        </a>
      </header>

      <section aria-labelledby="store-list-heading" className="mb-12">
        <h2 id="store-list-heading" className="mb-4 text-lg font-semibold">
          Store entities
        </h2>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-white/10 dark:border-white/10">
          {stores.map((store) => (
            <div key={store.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <h3 className="font-medium">{store.name}</h3>
                <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  {store.address}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void selectStore(store.id)}
                className="border border-slate-300 px-3 py-2 text-sm hover:bg-white dark:border-white/20 dark:hover:bg-white/10"
              >
                Open store
              </button>
            </div>
          ))}
          {!loading && stores.length === 0 && (
            <p className="py-5 text-sm text-slate-500 dark:text-slate-400">
              No stores are configured.
            </p>
          )}
        </div>
      </section>

      <section
        aria-labelledby="store-team-heading"
        className="mb-12 border-t border-slate-200 pt-8 dark:border-white/15"
      >
        <h2 id="store-team-heading" className="mb-2 text-lg font-semibold">
          Store permissions
        </h2>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
          {activeStore
            ? `Team access for ${activeStore.name}`
            : 'Select a store to manage its team access.'}
        </p>
        {teamError && (
          <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-300">
            {teamError}
          </p>
        )}
        {activeStore && (
          <>
            <form
              className="mb-5 flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void updateTeam(`user:${teamSubject.replace(/^user:/, '')}`, teamRelation, false)
                  .then(() => setTeamSubject(''))
                  .catch((cause) =>
                    setTeamError(
                      cause instanceof Error ? cause.message : 'Unable to update permissions',
                    ),
                  );
              }}
            >
              <label className="grid gap-1 text-sm font-medium">
                Team member subject
                <input
                  value={teamSubject}
                  onChange={(event) => setTeamSubject(event.target.value)}
                  required
                  placeholder="user:wallet-or-id"
                  className="h-10 border border-slate-300 bg-white px-3 dark:border-white/20 dark:bg-slate-900"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Permission
                <select
                  value={teamRelation}
                  onChange={(event) => setTeamRelation(event.target.value as 'editor' | 'viewer')}
                  className="h-10 border border-slate-300 bg-white px-3 dark:border-white/20 dark:bg-slate-900"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
              </label>
              <button className="h-10 bg-emerald-700 px-4 text-sm font-semibold text-white dark:bg-emerald-500 dark:text-slate-950">
                Grant access
              </button>
            </form>
            <div className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-white/10 dark:border-white/10">
              {(teamRoles?.storeId === activeStore.id ? teamRoles.roles : []).map((role) => (
                <div
                  key={`${role.relation}:${role.user}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <span className="font-mono">{role.user}</span>
                  <span className="capitalize">{role.relation}</span>
                  {role.relation !== 'owner' && (
                    <button
                      type="button"
                      onClick={() =>
                        void updateTeam(role.user, role.relation, true).catch((cause) =>
                          setTeamError(
                            cause instanceof Error ? cause.message : 'Unable to update permissions',
                          ),
                        )
                      }
                      className="text-red-700 underline dark:text-red-300"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="report-heading" className="mb-12">
        <h2 id="report-heading" className="mb-4 text-lg font-semibold">
          Consolidated financial reporting
        </h2>
        {report ? (
          <>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              {report.totals.paymentCount.toLocaleString()} settled payments across{' '}
              {report.stores.length} stores
            </p>
            <div className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-white/10 dark:border-white/10">
              {report.totals.assets.map((asset) => (
                <div key={asset.asset} className="flex justify-between gap-4 py-3 text-sm">
                  <span>{asset.asset}</span>
                  <span className="font-mono">{asset.volume}</span>
                </div>
              ))}
              {report.totals.assets.length === 0 && (
                <p className="py-4 text-sm text-slate-500">No settled payments yet.</p>
              )}
            </div>
            <div className="mt-4 divide-y divide-slate-200 dark:divide-white/10">
              {report.stores.map((store) => (
                <div
                  key={store.storeId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <span className="font-medium">{store.name}</span>
                  <span className="text-slate-600 dark:text-slate-300">
                    {store.paymentCount} payments
                  </span>
                  <span className="font-mono text-xs">
                    {store.assets.map((asset) => `${asset.volume} ${asset.asset}`).join(' · ') ||
                      'No volume'}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">Reporting is not available.</p>
        )}
      </section>

      <section
        id="new-store"
        aria-labelledby="new-store-heading"
        className="border-t border-slate-200 pt-8 dark:border-white/15"
      >
        <h2 id="new-store-heading" className="mb-4 text-lg font-semibold">
          Add a store
        </h2>
        <form onSubmit={createStore} className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            Store name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              className="h-10 border border-slate-300 bg-white px-3 dark:border-white/20 dark:bg-slate-900"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Store Stellar address
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              required
              pattern="G[A-Z2-7]{55}"
              className="h-10 border border-slate-300 bg-white px-3 font-mono text-xs dark:border-white/20 dark:bg-slate-900"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium sm:col-span-2">
            Refund vault contract ID
            <input
              value={refundVaultId}
              onChange={(event) => setRefundVaultId(event.target.value)}
              pattern="C[A-Z2-7]{55}"
              className="h-10 border border-slate-300 bg-white px-3 font-mono text-xs dark:border-white/20 dark:bg-slate-900"
            />
          </label>
          {formError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300 sm:col-span-2">
              {formError}
            </p>
          )}
          <button
            disabled={saving}
            className="h-10 w-fit bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60 dark:bg-emerald-500 dark:text-slate-950"
          >
            {saving ? 'Creating…' : 'Create store'}
          </button>
        </form>
      </section>
    </main>
  );
}
