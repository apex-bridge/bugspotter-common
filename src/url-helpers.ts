/**
 * URL helper utilities for endpoint validation and parsing.
 */

/**
 * Custom error for invalid endpoint URLs
 */
export class InvalidEndpointError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly reason: string,
  ) {
    super(`Invalid endpoint URL: ${endpoint}. ${reason}`);
    this.name = 'InvalidEndpointError';
  }
}

/**
 * Custom error for insecure endpoints
 */
export class InsecureEndpointError extends Error {
  constructor(public readonly endpoint: string) {
    super(
      `Secure HTTPS connection required. Attempted to connect to insecure endpoint: "${endpoint}"`,
    );
    this.name = 'InsecureEndpointError';
  }
}

/**
 * Strip known endpoint suffixes from path.
 * Removes /api/v1/reports path.
 */
export function stripEndpointSuffix(path: string): string {
  const reportsIndex = path.lastIndexOf('/api/v1/reports');
  if (reportsIndex !== -1) {
    return path.substring(0, reportsIndex);
  }
  return path.replace(/\/$/, '') || '';
}

/**
 * Extract base API URL from endpoint.
 * Returns scheme + host + base path (without /api/v1/reports suffix).
 *
 * @example
 * getApiBaseUrl('https://api.example.com/api/v1/reports')
 * // Returns: 'https://api.example.com'
 *
 * @throws InvalidEndpointError if endpoint is not a valid absolute URL
 */
export function getApiBaseUrl(endpoint: string): string {
  if (!endpoint) {
    throw new InvalidEndpointError('', 'No endpoint configured');
  }

  try {
    const url = new URL(endpoint);
    const basePath = stripEndpointSuffix(url.pathname);
    return url.origin + basePath;
  } catch {
    throw new InvalidEndpointError(
      endpoint,
      'Must be a valid absolute URL (e.g., https://api.example.com/api/v1/reports)',
    );
  }
}

/**
 * Checks if the endpoint uses a secure protocol.
 * Uses the URL API for robust parsing.
 *
 * Allows HTTPS in production, HTTP only on localhost/127.0.0.1 for development.
 */
export function isSecureEndpoint(endpoint: string): boolean {
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint.trim());
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
    );
  } catch {
    return false;
  }
}
