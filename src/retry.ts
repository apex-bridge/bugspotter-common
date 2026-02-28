/**
 * Exponential backoff retry utility.
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  retryOn: number[];
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  retryOn: [502, 503, 504, 429],
};

const JITTER_PERCENTAGE = 0.1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(
  attempt: number,
  config: RetryConfig,
  retryAfter?: string,
): number {
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return Math.min(seconds * 1000, config.maxDelay);
    }
  }

  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  const jitter =
    exponentialDelay * JITTER_PERCENTAGE * (Math.random() * 2 - 1);

  return Math.min(exponentialDelay + jitter, config.maxDelay);
}

/**
 * Execute an async operation with exponential backoff retry.
 * Retries on network errors and configurable HTTP status codes.
 */
export async function retryWithBackoff(
  operation: () => Promise<Response>,
  config: Partial<RetryConfig> = {},
): Promise<Response> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const response = await operation();

      if (cfg.retryOn.includes(response.status) && attempt < cfg.maxRetries) {
        const retryAfter = response.headers.get('Retry-After') ?? undefined;
        const delay = calculateDelay(attempt, cfg, retryAfter);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error as Error;

      // Don't retry auth errors
      if (lastError.message.includes('Invalid API key')) {
        throw lastError;
      }

      if (attempt < cfg.maxRetries) {
        const delay = calculateDelay(attempt, cfg);
        await sleep(delay);
        continue;
      }
    }
  }

  throw lastError || new Error('Request failed after all retry attempts');
}
