/** Custom error for webhook signing failures. */
export class WebhookSigningError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = 'WebhookSigningError';
  }
}

/** Custom error for webhook delivery failures. */
export class WebhookDeliveryError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number | null,
    public readonly transportError?: boolean,
  ) {
    super(message);
    this.name = 'WebhookDeliveryError';
  }
}
