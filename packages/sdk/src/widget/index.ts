/**
 * Widget host utilities for integrating the checkout widget
 * 
 * Provides helper functions for embedding the widget and handling
 * postMessage communication between the parent page and widget iframe.
 */

import type { WidgetMessage, ParentMessage, CheckoutConfig } from './checkout-widget';

export interface WidgetHostOptions {
  /** Allowed origin for postMessage security */
  allowedOrigin?: string;
  /** Callback when payment succeeds */
  onSuccess?: (txHash: string) => void;
  /** Callback when payment fails */
  onError?: (error: string) => void;
  /** Callback when widget is ready */
  onReady?: () => void;
}

export interface PaymentRequest {
  merchantId: string;
  amount: string;
  currency: string;
}

/**
 * Initialize widget communication in the parent page
 * 
 * Call this function in your page to handle messages from the embedded widget.
 * 
 * @param options - Configuration options
 * @returns Cleanup function to remove event listeners
 */
export function initWidgetHost(options: WidgetHostOptions = {}): () => void {
  const { allowedOrigin, onSuccess, onError, onReady } = options;
  const messageId = 0;
  const messageHandlers = new Map<string, (response: WidgetMessage) => void>();

  const handleMessage = (event: MessageEvent<WidgetMessage>) => {
    // Validate origin if specified
    if (allowedOrigin && event.origin !== allowedOrigin) {
      console.warn(`Widget message from untrusted origin: ${event.origin}`);
      return;
    }

    const message = event.data;

    // Handle response to specific message
    if (message.id && messageHandlers.has(message.id)) {
      const handler = messageHandlers.get(message.id);
      if (handler) {
        handler(message);
        messageHandlers.delete(message.id);
      }
      return;
    }

    // Handle broadcast messages
    switch (message.type) {
      case 'ready':
        if (onReady) onReady();
        break;
      case 'success':
        if (onSuccess) onSuccess(message.payload?.txHash || '');
        break;
      case 'error':
        if (onError) onError(message.payload?.error || 'Unknown error');
        break;
      case 'resize':
        // Handle widget resize requests
        const iframe = document.querySelector('iframe[data-accensa-widget]') as HTMLIFrameElement;
        if (iframe && message.payload?.height) {
          iframe.style.height = `${message.payload.height}px`;
        }
        break;
    }
  };

  window.addEventListener('message', handleMessage);

  // Return cleanup function
  return () => {
    window.removeEventListener('message', handleMessage);
    messageHandlers.clear();
  };
}

/**
 * Send a message to the widget and wait for response
 * 
 * @param iframe - The widget iframe element
 * @param message - Message to send
 * @param timeout - Response timeout in milliseconds
 * @returns Promise resolving to the widget's response
 */
export function sendToWidget(
  iframe: HTMLIFrameElement,
  message: ParentMessage,
  timeout: number = 5000,
): Promise<WidgetMessage> {
  return new Promise((resolve, reject) => {
    const id = `host_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const messageWithId = { ...message, id };

    const handler = (event: MessageEvent<WidgetMessage>) => {
      if (event.data.id === id) {
        window.removeEventListener('message', handler);
        resolve(event.data);
      }
    };

    window.addEventListener('message', handler);

    setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('Widget response timeout'));
    }, timeout);

    iframe.contentWindow?.postMessage(messageWithId, '*');
  });
}

/**
 * Embed the widget as an iframe
 * 
 * Creates an iframe element configured to host the checkout widget.
 * 
 * @param config - Checkout configuration
 * @param widgetUrl - URL of the widget HTML page
 * @returns The iframe element
 */
export function embedWidget(
  config: CheckoutConfig,
  widgetUrl: string,
): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-accensa-widget', 'true');
  iframe.style.border = 'none';
  iframe.style.overflow = 'hidden';

  // Set size based on variant
  switch (config.variant) {
    case 'pill':
      iframe.style.width = 'auto';
      iframe.style.height = '40px';
      break;
    case 'card':
      iframe.style.width = '300px';
      iframe.style.height = '120px';
      break;
    case 'modal':
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.position = 'fixed';
      iframe.style.top = '0';
      iframe.style.left = '0';
      iframe.style.zIndex = '9999';
      break;
    default:
      iframe.style.width = '300px';
      iframe.style.height = '120px';
  }

  // Build URL with config params
  const url = new URL(widgetUrl);
  url.searchParams.set('merchantId', config.merchantId);
  url.searchParams.set('amount', config.amount);
  url.searchParams.set('currency', config.currency);
  if (config.variant) url.searchParams.set('variant', config.variant);
  if (config.theme) url.searchParams.set('theme', config.theme);

  iframe.src = url.toString();

  return iframe;
}

/**
 * Create a widget instance with automatic cleanup
 * 
 * Convenience function that combines embedWidget and initWidgetHost.
 * 
 * @param config - Checkout configuration
 * @param widgetUrl - URL of the widget HTML page
 * @param options - Host options
 * @returns Object containing iframe and cleanup function
 */
export function createWidget(
  config: CheckoutConfig,
  widgetUrl: string,
  options: WidgetHostOptions = {},
): { iframe: HTMLIFrameElement; cleanup: () => void } {
  const iframe = embedWidget(config, widgetUrl);
  const cleanup = initWidgetHost(options);

  return {
    iframe,
    cleanup: () => {
      cleanup();
      iframe.remove();
    },
  };
}
