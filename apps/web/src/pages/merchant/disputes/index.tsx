import Link from 'next/link';

interface PendingDispute {
  id: string;
  amount: string;
  asset: string;
  deadline: string;
}

const pendingDisputes: PendingDispute[] = [];

function urgency(deadline: string): 'urgent' | 'open' {
  return Date.parse(deadline) - Date.now() <= 24 * 60 * 60 * 1000 ? 'urgent' : 'open';
}

export default function MerchantDisputesPage() {
  const grouped = pendingDisputes.reduce<Record<'urgent' | 'open', PendingDispute[]>>(
    (groups, dispute) => {
      groups[urgency(dispute.deadline)].push(dispute);
      return groups;
    },
    { urgent: [], open: [] },
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header>
        <p className="text-sm text-slate-600">Merchant workspace</p>
        <h1 className="text-3xl font-semibold">Pending disputes</h1>
      </header>
      {(['urgent', 'open'] as const).map((group) => (
        <section key={group} aria-labelledby={`${group}-disputes`} className="mt-8">
          <h2 id={`${group}-disputes`} className="text-lg font-semibold">
            {group === 'urgent' ? 'Urgent, less than 24 hours' : 'Open, more than 24 hours'}
          </h2>
          {grouped[group].length === 0 ? (
            <p className="mt-3 text-slate-600">No pending disputes in this window.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
              {grouped[group].map((dispute) => (
                <li key={dispute.id} className="flex items-center justify-between gap-4 py-4">
                  <span>
                    {dispute.amount} {dispute.asset}
                  </span>
                  <Link
                    className="text-emerald-700 underline focus-visible:outline-2"
                    href={`/merchant/disputes/${dispute.id}`}
                  >
                    Review dispute
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
