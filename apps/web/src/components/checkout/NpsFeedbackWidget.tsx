import React, { useState, useEffect } from 'react';

interface NpsFeedbackWidgetProps {
  transactionId: string;
  merchantId: string;
}

export const NpsFeedbackWidget: React.FC<NpsFeedbackWidgetProps> = ({
  transactionId,
  merchantId,
}) => {
  const [rating, setRating] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Check if user has already given feedback recently (in last 30 days)
    const lastFeedback = localStorage.getItem('accensa_last_feedback');
    if (lastFeedback) {
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - parseInt(lastFeedback) < thirtyDays) {
        return;
      }
    }

    // Smooth entrance animation
    const timer = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === null) return;

    try {
      await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId,
          merchantId,
          rating,
          feedbackText,
          deviceType: /Mobile|Android|iP(ad|hone)/.test(navigator.userAgent) ? 'mobile' : 'desktop',
        }),
      });

      setIsSubmitted(true);
      localStorage.setItem('accensa_last_feedback', Date.now().toString());

      // Auto dismiss after 3 seconds
      setTimeout(() => setIsDismissed(true), 3000);
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    }
  };

  if (!show || isDismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-sm w-full bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 transition-all duration-500 transform translate-y-0 opacity-100">
      <div className="p-4 relative">
        <button
          onClick={() => setIsDismissed(true)}
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="Dismiss"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {isSubmitted ? (
          <div className="text-center py-6">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
              <svg
                className="h-6 w-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Thank you!</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Your feedback helps us improve.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              How was your payment experience?
            </h3>
            <div className="flex justify-between mb-4">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className={`p-2 text-2xl transition-transform hover:scale-110 focus:outline-none ${
                    rating && rating >= star
                      ? 'text-yellow-400'
                      : 'text-gray-300 dark:text-gray-600'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>

            {rating !== null && (
              <div className="animate-fade-in-up">
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="Optional: Tell us more about your experience..."
                  className="w-full text-black p-2 border border-gray-300 rounded-md shadow-sm text-sm focus:ring-blue-500 focus:border-blue-500 mb-3"
                  rows={2}
                />
                <button
                  type="submit"
                  className="w-full bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Submit Feedback
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
