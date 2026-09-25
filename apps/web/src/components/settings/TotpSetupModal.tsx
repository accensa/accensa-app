import React, { useState, useEffect } from 'react';

interface TotpSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
}

export const TotpSetupModal: React.FC<TotpSetupModalProps> = ({ isOpen, onClose, userEmail }) => {
  const [step, setStep] = useState<number>(1);
  const [secret, setSecret] = useState<string>('');
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [token, setToken] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      // Fetch TOTP secret and QR code on mount
      fetch('/api/auth/totp/generate', { method: 'POST' })
        .then((res) => res.json())
        .then((data) => {
          setSecret(data.secret);
          setQrCodeUrl(data.qrCodeUrl);
          setBackupCodes(data.backupCodes);
        })
        .catch((err) => console.error('Error generating TOTP:', err));
    } else {
      setTimeout(() => {
        setStep(1);
        setToken('');
        setError('');
      }, 0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleVerify = async () => {
    setIsVerifying(true);
    setError('');
    try {
      const res = await fetch('/api/auth/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, secret }),
      });

      const data = await res.json();
      if (data.success) {
        setStep(2);
      } else {
        setError('Invalid token. Please try again.');
      }
    } catch (err) {
      console.error(err);
      setError('An error occurred during verification.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleFinish = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
        {step === 1 && (
          <>
            <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
              Set up Two-Factor Authentication
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Scan the QR code below with your authenticator app (e.g. Google Authenticator, Authy).
            </p>
            {qrCodeUrl ? (
              <div className="flex justify-center mb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrCodeUrl}
                  alt={`TOTP QR Code for ${userEmail}`}
                  className="w-48 h-48 border rounded"
                />
              </div>
            ) : (
              <div className="flex justify-center mb-4">
                <div className="w-48 h-48 border rounded flex items-center justify-center text-gray-500">
                  Loading...
                </div>
              </div>
            )}

            <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
              Or enter this code manually:
            </p>
            <code className="block bg-gray-100 dark:bg-gray-700 p-2 rounded text-center mb-4 font-mono">
              {secret}
            </code>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Verify Code
              </label>
              <input
                type="text"
                maxLength={6}
                value={token}
                onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
                className="w-full border-gray-300 rounded-md shadow-sm p-2 text-black"
                placeholder="000000"
              />
              {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
            </div>

            <div className="flex justify-end space-x-2">
              <button
                onClick={onClose}
                className="px-4 py-2 border rounded-md text-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleVerify}
                disabled={isVerifying || token.length !== 6}
                className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50"
              >
                Verify
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
              Save Backup Codes
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              If you lose access to your authenticator app, you can use these recovery codes.{' '}
              <strong>Save them in a secure place.</strong> Each code can only be used once.
            </p>

            <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded mb-6 grid grid-cols-2 gap-2">
              {backupCodes.map((code, idx) => (
                <div key={idx} className="font-mono text-sm text-gray-800 dark:text-gray-200">
                  {code}
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleFinish}
                className="px-4 py-2 bg-green-600 text-white rounded-md"
              >
                I have saved these codes
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
