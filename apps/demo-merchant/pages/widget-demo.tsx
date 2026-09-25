import React, { useEffect, useState, useRef } from 'react';
import { createWidget, type CheckoutConfig } from '@accensa/sdk';

/**
 * Demo page showing the embeddable checkout widget integration
 * 
 * This demonstrates how third-party merchants can integrate the Accensa
 * checkout widget into their own websites using a simple script tag.
 */
export default function WidgetDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [widgetUrl] = useState('https://accensa-dashboard.vercel.app/widget');
  const [status, setStatus] = useState<'idle' | 'ready' | 'processing' | 'success' | 'error'>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [config, setConfig] = useState<CheckoutConfig>({
    merchantId: 'demo-merchant-123',
    amount: '49.99',
    currency: 'XLM',
    variant: 'card',
    theme: 'light',
  });

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize widget host communication
    const cleanup = createWidget(
      config,
      widgetUrl,
      {
        allowedOrigin: 'https://accensa-dashboard.vercel.app',
        onReady: () => {
          setStatus('ready');
          console.log('Widget is ready');
        },
        onSuccess: (hash) => {
          setStatus('success');
          setTxHash(hash);
          console.log('Payment successful:', hash);
        },
        onError: (error) => {
          setStatus('error');
          setErrorMessage(error);
          console.error('Payment failed:', error);
        },
      },
    );

    containerRef.current.appendChild(cleanup.iframe);

    return () => {
      cleanup.cleanup();
    };
  }, [config, widgetUrl]);

  const handleVariantChange = (variant: CheckoutConfig['variant']) => {
    setConfig({ ...config, variant });
  };

  const handleThemeChange = (theme: CheckoutConfig['theme']) => {
    setConfig({ ...config, theme });
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfig({ ...config, amount: e.target.value });
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="bg-white shadow-sm p-4">
        <h1 className="text-2xl font-bold">Accensa Checkout Widget Demo</h1>
      </header>

      <main className="container mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Configuration Panel */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Widget Configuration</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Amount</label>
                <input
                  type="text"
                  value={config.amount}
                  onChange={handleAmountChange}
                  className="w-full p-2 border rounded"
                  placeholder="49.99"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Variant</label>
                <div className="flex gap-2">
                  {(['pill', 'card', 'modal'] as const).map((variant) => (
                    <button
                      key={variant}
                      onClick={() => handleVariantChange(variant)}
                      className={`px-4 py-2 rounded ${
                        config.variant === variant
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 hover:bg-gray-300'
                      }`}
                    >
                      {variant.charAt(0).toUpperCase() + variant.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Theme</label>
                <div className="flex gap-2">
                  {(['light', 'dark'] as const).map((theme) => (
                    <button
                      key={theme}
                      onClick={() => handleThemeChange(theme)}
                      className={`px-4 py-2 rounded ${
                        config.theme === theme
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 hover:bg-gray-300'
                      }`}
                    >
                      {theme.charAt(0).toUpperCase() + theme.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t">
                <h3 className="font-medium mb-2">Integration Code</h3>
                <pre className="bg-gray-900 text-gray-100 p-4 rounded text-sm overflow-x-auto">
                  {`<script src="https://cdn.accensa.io/widget.js"></script>
<accensa-checkout
  merchant-id="${config.merchantId}"
  amount="${config.amount}"
  currency="${config.currency}"
  variant="${config.variant}"
  theme="${config.theme}"
></accensa-checkout>`}
                </pre>
              </div>
            </div>
          </div>

          {/* Widget Preview */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Widget Preview</h2>
            
            <div className="mb-4">
              <span className={`inline-block px-3 py-1 rounded-full text-sm ${
                status === 'ready' ? 'bg-green-100 text-green-800' :
                status === 'processing' ? 'bg-yellow-100 text-yellow-800' :
                status === 'success' ? 'bg-green-100 text-green-800' :
                status === 'error' ? 'bg-red-100 text-red-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                Status: {status}
              </span>
            </div>

            <div ref={containerRef} className="min-h-[200px] flex items-center justify-center">
              {status === 'idle' && <p className="text-gray-500">Loading widget...</p>}
            </div>

            {status === 'success' && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded">
                <h3 className="font-medium text-green-800">Payment Successful!</h3>
                <p className="text-sm text-green-700 mt-1">
                  Transaction Hash: <code className="bg-green-100 px-1 rounded">{txHash}</code>
                </p>
              </div>
            )}

            {status === 'error' && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded">
                <h3 className="font-medium text-red-800">Payment Failed</h3>
                <p className="text-sm text-red-700 mt-1">{errorMessage}</p>
              </div>
            )}
          </div>
        </div>

        {/* Documentation */}
        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Integration Guide</h2>
          <div className="prose prose-sm max-w-none">
            <h3>Quick Start</h3>
            <ol>
              <li>Add the widget script to your page:</li>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded text-sm">
                {`<script src="https://cdn.accensa.io/widget.js"></script>`}
              </pre>
              <li>Place the widget element where you want it:</li>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded text-sm">
                {`<accensa-checkout
  merchant-id="your-merchant-id"
  amount="100.00"
  currency="XLM"
></accensa-checkout>`}
              </pre>
            </ol>

            <h3>Features</h3>
            <ul>
              <li><strong>Zero CSS bleed:</strong> Shadow DOM isolation prevents style conflicts</li>
              <li><strong>Secure communication:</strong> postMessage with origin validation</li>
              <li><strong>Responsive variants:</strong> Pill, card, and modal layouts</li>
              <li><strong>Theme support:</strong> Light and dark modes</li>
              <li><strong>Bundle size:</strong> Under 45kB gzipped</li>
            </ul>

            <h3>Security</h3>
            <p>The widget uses postMessage for communication with the parent page. Always validate the origin in production:</p>
            <pre className="bg-gray-900 text-gray-100 p-3 rounded text-sm">
              {`initWidgetHost({
  allowedOrigin: 'https://your-accensa-dashboard.com',
  onSuccess: (txHash) => console.log('Paid:', txHash),
  onError: (error) => console.error('Error:', error),
})`}
            </pre>
          </div>
        </div>
      </main>
    </div>
  );
}
