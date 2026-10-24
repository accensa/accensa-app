import { useEffect, useMemo, useState } from 'react';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';

interface DisputeEvent {
  label: string;
  timestamp: string;
}

interface Dispute {
  id: string;
  amount: string;
  asset: string;
  reason: string;
  customer: string;
  evidenceDeadline: string;
  events: DisputeEvent[];
}

interface Props {
  dispute: Dispute;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ params }) => ({
  props: {
    dispute: {
      id: String(params?.id ?? ''),
      amount: '0.00',
      asset: 'USDC',
      reason: 'Customer dispute details are loading.',
      customer: 'Unknown customer',
      evidenceDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      events: [],
    },
  },
});

export default function DisputeDetailPage({
  dispute,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, Date.parse(dispute.evidenceDeadline) - Date.now()),
  );
  const urgency = remainingMs <= 24 * 60 * 60 * 1000 ? 'urgent' : 'open';

  useEffect(() => {
    const timer = window.setInterval(
      () => setRemainingMs(Math.max(0, Date.parse(dispute.evidenceDeadline) - Date.now())),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [dispute.evidenceDeadline]);

  const countdown = useMemo(() => {
    const totalSeconds = Math.floor(remainingMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
  }, [remainingMs]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-600">Dispute {dispute.id}</p>
          <h1 className="text-3xl font-semibold">Review customer dispute</h1>
        </div>
        <div
          className={urgency === 'urgent' ? 'text-red-700' : 'text-amber-700'}
          role="status"
          aria-live="polite"
        >
          <span className="font-semibold">{urgency === 'urgent' ? 'Urgent' : 'Open'}</span>
          <span className="ml-2">{countdown} remaining</span>
        </div>
      </header>

      <section aria-labelledby="claim-heading" className="border-y border-slate-200 py-5">
        <h2 id="claim-heading" className="text-lg font-semibold">
          Claim details
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-slate-600">Amount</dt>
            <dd>
              {dispute.amount} {dispute.asset}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Customer</dt>
            <dd>{dispute.customer}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Reason</dt>
            <dd>{dispute.reason}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="text-lg font-semibold">
          Dispute timeline
        </h2>
        <ol className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4">
          {dispute.events.length === 0 && (
            <li className="text-slate-600">No events recorded yet.</li>
          )}
          {dispute.events.map((event) => (
            <li key={`${event.timestamp}-${event.label}`}>
              <strong>{event.label}</strong>
              <time className="ml-2 text-sm text-slate-600">{event.timestamp}</time>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
