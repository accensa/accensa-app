import React, { useState } from 'react';
import Head from 'next/head';
import { TotpSetupModal } from '../../../components/settings/TotpSetupModal';

export default function SecuritySettings() {
  const [isTotpModalOpen, setIsTotpModalOpen] = useState(false);
  const [is2faEnabled, setIs2faEnabled] = useState(false);

  return (
    <div className="max-w-4xl mx-auto py-10 px-4 sm:px-6 lg:px-8">
      <Head>
        <title>Security Settings - Accensa Merchant</title>
      </Head>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Security Settings</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Manage your account security and two-factor authentication.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow rounded-lg mb-6">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">
            Two-Factor Authentication (2FA)
          </h3>
          <div className="mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-300">
            <p>
              Add an extra layer of security to your account by requiring more than just a password
              to sign in and make sensitive configuration changes (like updating treasury payouts).
            </p>
          </div>
          <div className="mt-5">
            {is2faEnabled ? (
              <div className="flex items-center space-x-4">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                  Enabled
                </span>
                <button
                  type="button"
                  className="inline-flex items-center px-4 py-2 border border-red-300 shadow-sm text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none"
                  onClick={() => setIs2faEnabled(false)}
                >
                  Disable 2FA
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none"
                onClick={() => setIsTotpModalOpen(true)}
              >
                Enable 2FA (Authenticator App)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sensitive Actions (mock to show 2FA protection requirement) */}
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">
            Sensitive Operations
          </h3>
          <div className="mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-300">
            <p>Operations below require 2FA challenge verification before saving.</p>
          </div>
          <div className="mt-5 border-t border-gray-200 dark:border-gray-700 pt-5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Treasury Payout Address
            </label>
            <div className="mt-1 flex rounded-md shadow-sm">
              <input
                type="text"
                disabled
                className="flex-1 min-w-0 block w-full px-3 py-2 rounded-md border border-gray-300 bg-gray-50 text-gray-500 sm:text-sm"
                value="GABCDEFGHIJKLMNOPQRSTUVWXYZ123456789"
              />
              <button className="ml-3 inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                Change
              </button>
            </div>
          </div>
        </div>
      </div>

      <TotpSetupModal
        isOpen={isTotpModalOpen}
        userEmail="merchant@example.com"
        onClose={() => {
          setIsTotpModalOpen(false);
          setIs2faEnabled(true);
        }}
      />
    </div>
  );
}
