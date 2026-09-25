/**
 * Accensa Checkout Widget
 * 
 * An embeddable web component for accepting Accensa payments on third-party sites.
 * Uses Shadow DOM to prevent CSS bleed and postMessage for secure communication.
 * 
 * Usage:
 * <accensa-checkout
 *   merchant-id="your-merchant-id"
 *   amount="100.00"
 *   currency="XLM"
 *   variant="card"
 * ></accensa-checkout>
 */

export interface CheckoutConfig {
  merchantId: string;
  amount: string;
  currency: string;
  variant?: 'pill' | 'card' | 'modal';
  theme?: 'light' | 'dark';
  onSuccess?: (txHash: string) => void;
  onError?: (error: string) => void;
}

export interface WidgetMessage {
  type: 'init' | 'pay' | 'success' | 'error' | 'resize' | 'ready';
  payload?: any;
  id?: string;
}

export interface ParentMessage {
  type: 'config' | 'pay' | 'cancel';
  payload?: any;
  id?: string;
}

const MESSAGE_ORIGIN = '*'; // Will be validated in production

class AccensaCheckoutWidget extends HTMLElement {
  private shadow: ShadowRoot;
  private config: CheckoutConfig;
  private messageId = 0;
  private messageHandlers: Map<string, (response: WidgetMessage) => void> = new Map();

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.config = this.getConfigFromAttributes();
  }

  static get observedAttributes() {
    return ['merchant-id', 'amount', 'currency', 'variant', 'theme'];
  }

  connectedCallback() {
    this.render();
    this.setupMessageListener();
    this.postMessage({ type: 'ready' });
  }

  disconnectedCallback() {
    window.removeEventListener('message', this.handleMessage);
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue !== newValue) {
      this.config = this.getConfigFromAttributes();
      this.render();
    }
  }

  private getConfigFromAttributes(): CheckoutConfig {
    return {
      merchantId: this.getAttribute('merchant-id') || '',
      amount: this.getAttribute('amount') || '0',
      currency: this.getAttribute('currency') || 'XLM',
      variant: (this.getAttribute('variant') as CheckoutConfig['variant']) || 'card',
      theme: (this.getAttribute('theme') as CheckoutConfig['theme']) || 'light',
    };
  }

  private setupMessageListener() {
    window.addEventListener('message', this.handleMessage.bind(this));
  }

  private handleMessage = (event: MessageEvent<ParentMessage>) => {
    // Validate origin in production
    // if (event.origin !== ALLOWED_ORIGIN) return;

    const message = event.data;

    if (message.id && this.messageHandlers.has(message.id)) {
      const handler = this.messageHandlers.get(message.id);
      if (handler) {
        handler(message as WidgetMessage);
        this.messageHandlers.delete(message.id);
      }
    }

    switch (message.type) {
      case 'config':
        this.config = { ...this.config, ...message.payload };
        this.render();
        break;
      case 'pay':
        this.initiatePayment();
        break;
      case 'cancel':
        this.postMessage({ type: 'error', payload: { error: 'Payment cancelled' } });
        break;
    }
  };

  private postMessage(message: WidgetMessage, targetOrigin: string = MESSAGE_ORIGIN) {
    if (this.messageId > 10000) {
      this.messageId = 0; // Prevent overflow
    }
    const id = `msg_${++this.messageId}`;
    const messageWithId = { ...message, id };
    window.parent.postMessage(messageWithId, targetOrigin);
  }

  private async sendMessageWithResponse(
    message: WidgetMessage,
    timeout: number = 5000,
  ): Promise<WidgetMessage> {
    return new Promise((resolve, reject) => {
      const id = `msg_${++this.messageId}`;
      this.messageHandlers.set(id, resolve);

      setTimeout(() => {
        this.messageHandlers.delete(id);
        reject(new Error('Message timeout'));
      }, timeout);

      window.parent.postMessage({ ...message, id }, MESSAGE_ORIGIN);
    });
  }

  private render() {
    const { variant, theme, amount, currency } = this.config;

    const styles = `
      :host {
        display: inline-block;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .widget {
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        overflow: hidden;
        ${theme === 'dark' ? 'background: #1a1a1a; color: #fff;' : 'background: #fff; color: #333;'}
      }
      .widget.pill {
        padding: 8px 16px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .widget.card {
        padding: 16px;
        min-width: 280px;
      }
      .widget.modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        padding: 24px;
        min-width: 320px;
        max-width: 400px;
        z-index: 9999;
      }
      .pay-button {
        background: #3b82f6;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 500;
        transition: background 0.2s;
      }
      .pay-button:hover {
        background: #2563eb;
      }
      .pay-button:disabled {
        background: #9ca3af;
        cursor: not-allowed;
      }
      .amount {
        font-size: 1.25rem;
        font-weight: 600;
      }
      .currency {
        font-size: 0.875rem;
        color: ${theme === 'dark' ? '#9ca3af' : '#6b7280'};
      }
      .loading {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 2px solid #fff;
        border-radius: 50%;
        border-top-color: transparent;
        animation: spin 0.6s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;

    const html = `
      <style>${styles}</style>
      <div class="widget ${variant}">
        ${variant === 'pill' ? `
          <span class="amount">${amount}</span>
          <span class="currency">${currency}</span>
          <button class="pay-button" id="payBtn">Pay</button>
        ` : variant === 'card' ? `
          <div style="margin-bottom: 12px;">
            <span class="amount">${amount}</span>
            <span class="currency"> ${currency}</span>
          </div>
          <button class="pay-button" id="payBtn" style="width: 100%;">Pay with Accensa</button>
        ` : `
          <h2 style="margin: 0 0 16px 0;">Complete Payment</h2>
          <div style="margin-bottom: 16px;">
            <span class="amount">${amount}</span>
            <span class="currency"> ${currency}</span>
          </div>
          <button class="pay-button" id="payBtn" style="width: 100%;">Pay Now</button>
        `}
      </div>
    `;

    this.shadow.innerHTML = html;

    const payButton = this.shadow.getElementById('payBtn') as HTMLButtonElement;
    if (payButton) {
      payButton.addEventListener('click', () => this.initiatePayment());
    }
  }

  private async initiatePayment() {
    const payButton = this.shadow.getElementById('payBtn') as HTMLButtonElement;
    if (payButton) {
      payButton.disabled = true;
      payButton.innerHTML = '<span class="loading"></span> Processing...';
    }

    try {
      // Request payment initiation from parent
      const response = await this.sendMessageWithResponse({
        type: 'pay',
        payload: {
          merchantId: this.config.merchantId,
          amount: this.config.amount,
          currency: this.config.currency,
        },
      });

      if (response.type === 'success') {
        this.postMessage({
          type: 'success',
          payload: { txHash: response.payload?.txHash },
        });
        if (this.config.onSuccess) {
          this.config.onSuccess(response.payload?.txHash);
        }
      } else if (response.type === 'error') {
        this.postMessage({
          type: 'error',
          payload: { error: response.payload?.error },
        });
        if (this.config.onError) {
          this.config.onError(response.payload?.error);
        }
      }
    } catch (error) {
      this.postMessage({
        type: 'error',
        payload: { error: error instanceof Error ? error.message : 'Payment failed' },
      });
    } finally {
      if (payButton) {
        payButton.disabled = false;
        payButton.textContent = 'Pay';
      }
    }
  }

  /**
   * Public API for programmatic control
   */
  public updateConfig(newConfig: Partial<CheckoutConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.render();
  }

  public pay() {
    this.initiatePayment();
  }
}

// Register the custom element
if (!customElements.get('accensa-checkout')) {
  customElements.define('accensa-checkout', AccensaCheckoutWidget);
}

export { AccensaCheckoutWidget };
