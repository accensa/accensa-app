import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900">404</h1>
        <p className="mt-4 text-lg text-gray-600">
          The product or order you&apos;re looking for doesn&apos;t exist or has been removed.
        </p>
        <div className="mt-8 flex gap-4 justify-center">
          <Link
            href="/dashboard"
            className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Back to Dashboard
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
