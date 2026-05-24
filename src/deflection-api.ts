/**
 * Shared SDK-side client for the deflection similarity probe.
 *
 * Consumed by both `bugspotter-sdk` (vanilla-DOM widget) and
 * `bugspotter-extension` (React popup). The render layer differs
 * per platform; this is the pure HTTP / debounce / cancellation
 * core that's identical between them.
 *
 * Three contracts under guard:
 *   - **Debounce**: rapid queries collapse to ONE network call
 *     (default 400ms). Configurable per platform; <200ms invites
 *     429s from the per-API-key rate limiter on the backend.
 *   - **AbortController cancellation**: in-flight requests are
 *     aborted when a newer query arrives. Stale results from earlier
 *     keystrokes never overwrite newer ones — without this, slow
 *     networks would flicker the match list on out-of-order responses.
 *   - **Soft-fail surface**: timeout, network error, 4xx, 5xx all
 *     resolve to `[]`. Never throws. The host UI must stay usable.
 *
 * Auth headers are provided by the caller via `getAuthHeaders` so
 * this module stays platform-agnostic — the SDK uses its own
 * X-API-Key shape, the extension reads from `chrome.storage`.
 */

import { getApiBaseUrl } from './url-helpers.js';

/**
 * Slim match shape returned by `POST /api/v1/sdk/similar`.
 * `canonical_id` is the existing bug a new report could be
 * deflected into; the rest is for rendering.
 */
export interface DeflectionMatch {
  canonical_id: string;
  title: string;
  status: string;
  similarity: number;
}

/**
 * Hard cap on a single probe. The backend SLO is ~300ms p95; this
 * gives ~3x headroom so a one-off stall doesn't freeze the widget.
 */
const PROBE_TIMEOUT_MS = 2_000;

/** Minimum title length below which we don't bother probing. */
const MIN_TITLE_LENGTH = 5;

const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_MAX_MATCHES = 3;

export interface DeflectionApiOptions {
  /** Base URL of the BugSpotter backend, e.g. `https://api.example.com`. Path is appended internally. */
  endpoint: string;
  /**
   * Returns the auth headers to attach to the probe. The function
   * is awaited on every call — the extension uses this to re-read
   * `chrome.storage` so credential rotation is picked up without a
   * re-init. The SDK returns a static `{ 'X-API-Key': key }`.
   */
  getAuthHeaders: () => Record<string, string> | Promise<Record<string, string>>;
  /** Default 400. Set to 0 to disable debouncing (tests). */
  debounceMs?: number;
  /** Default 3. Backend hard-caps at 5. */
  maxMatches?: number;
  /**
   * Called on non-AbortError failures (network down, 5xx, malformed
   * JSON). Defaults to no-op — host can pipe to its own logger.
   * AbortErrors are expected on every cancellation and are NOT
   * routed here to avoid noisy logs.
   */
  onError?: (error: unknown) => void;
}

/**
 * Stateful client — one instance per widget session. Owns the
 * debounce timer and the in-flight AbortController.
 */
export class DeflectionApi {
  private readonly options: Required<DeflectionApiOptions>;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: AbortController | null = null;
  /**
   * Resolver for the most-recent `query()` call's promise. Tracked
   * so a new query (or `cancel()`) can settle the prior promise
   * with `[]` rather than leak it pending forever. Without this,
   * each cancelled call's closure stays alive holding the consumer
   * callback chain (and, transitively, the DOM nodes referenced by
   * the chain) until the host page itself navigates away.
   */
  private pendingResolve: ((value: DeflectionMatch[]) => void) | null = null;

  constructor(options: DeflectionApiOptions) {
    this.options = {
      endpoint: options.endpoint,
      getAuthHeaders: options.getAuthHeaders,
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      // Clamp to a positive integer. A negative value (e.g. -1
      // passed by a misconfigured consumer) would otherwise reach
      // `slice(0, -1)` which silently returns all-but-last-1 items
      // — wrong count, no error surface. Math.max keeps things
      // sensible without needing a separate validation step.
      maxMatches: Math.max(1, options.maxMatches ?? DEFAULT_MAX_MATCHES),
      onError: options.onError ?? (() => {}),
    };
  }

  /**
   * Schedule a similarity probe for the given title text. Cancels
   * any pending probe (debounce) AND any in-flight HTTP request
   * (AbortController), AND settles any prior promise with `[]` so
   * the closure can be GC'd. Resolves to the matches when the
   * latest probe lands, or to `[]` on any failure.
   *
   * Contract: only the MOST RECENT call's promise will receive
   * non-empty results. Earlier calls that get superseded resolve
   * to `[]` so consumers don't render stale matches AND so callers
   * that `await` every query (rather than fire-and-forget) don't
   * stall on superseded calls.
   */
  query(title: string): Promise<DeflectionMatch[]> {
    // Settle any prior pending promise with `[]` before we replace
    // its resolver. Idempotent — re-resolving a settled promise is
    // a no-op, so the `if-newer-still-equal` guards below stay safe.
    const priorResolve = this.pendingResolve;
    this.pendingResolve = null;
    priorResolve?.([]);

    return new Promise((resolve) => {
      this.pendingResolve = resolve;

      // Drop the in-flight network request first — it might still
      // be racing the new debounce timer. Without this, a slow
      // earlier request could land after a faster newer one and
      // overwrite. Abort triggers `fetchOnce`'s catch which returns
      // `[]`; the resolver-equality guard there suppresses the
      // double-settle.
      if (this.inFlight) {
        this.inFlight.abort();
        this.inFlight = null;
      }
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
      }

      // Below the embedding model's useful floor — don't waste a
      // round trip. Matches the backend's own minLength check.
      if (title.trim().length < MIN_TITLE_LENGTH) {
        if (this.pendingResolve === resolve) {
          this.pendingResolve = null;
        }
        resolve([]);
        return;
      }

      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.fetchOnce(title).then((matches) => {
          // Only settle if we're still the pending resolver — a
          // newer query may have replaced us mid-fetch, in which
          // case it already settled this promise with `[]`.
          if (this.pendingResolve === resolve) {
            this.pendingResolve = null;
            resolve(matches);
          }
        });
      }, this.options.debounceMs);
    });
  }

  /**
   * Cancel any pending or in-flight probe. Call on modal close so
   * we don't leak abortable requests across modal sessions, AND so
   * the most-recent `query()` promise settles with `[]` rather than
   * hanging.
   */
  cancel(): void {
    const priorResolve = this.pendingResolve;
    this.pendingResolve = null;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.inFlight) {
      this.inFlight.abort();
      this.inFlight = null;
    }
    priorResolve?.([]);
  }

  private async fetchOnce(title: string): Promise<DeflectionMatch[]> {
    const controller = new AbortController();
    this.inFlight = controller;
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    try {
      // Use the shared `getApiBaseUrl` helper so the deflection
      // probe handles the same endpoint shapes the rest of the SDK
      // already does — including the case where a host passes the
      // full `/api/v1/reports` URL as the endpoint. Without this,
      // a naive trailing-slash strip would produce
      // `…/api/v1/reports/api/v1/sdk/similar` and silently 404.
      // Throws `InvalidEndpointError` on malformed URLs; the catch
      // below funnels that through the soft-fail path (returns []).
      const baseUrl = getApiBaseUrl(this.options.endpoint);
      const url = `${baseUrl}/api/v1/sdk/similar`;
      const headers = await this.options.getAuthHeaders();
      // `getAuthHeaders` is awaitable — the extension reads
      // `chrome.storage` and can race a fresh cancellation. If the
      // controller already aborted during that await, skip the
      // fetch entirely. fetch() with an aborted signal would reject
      // immediately anyway, but skipping avoids the network-stack
      // setup and the AbortError trip through our catch.
      if (controller.signal.aborted) {
        return [];
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          title,
          limit: this.options.maxMatches,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Backend treats most failure modes as `{ matches: [] }` at
        // 200, so a non-2xx here usually means auth / schema / 5xx.
        // All silent — surfaced to the host via `onError` only.
        this.options.onError(new Error(`Deflection probe HTTP ${response.status}`));
        return [];
      }

      const data = (await response.json()) as
        | { success?: boolean; data?: { matches?: unknown } }
        | undefined;
      // Validate the shape before slicing — `??` only short-circuits
      // null/undefined, not "wrong type". A backend that ever
      // returned `matches` as a string or object would silently
      // corrupt downstream (`.slice()` on a string returns a string
      // typed as `DeflectionMatch[]`, and consumers would render
      // garbage). `Array.isArray` is the right guard.
      const matches = Array.isArray(data?.data?.matches) ? data.data.matches : [];
      // Defensive: if the backend ever returns more than asked for,
      // clamp client-side. Shouldn't happen, but we never want to
      // flood the widget with chips.
      return matches.slice(0, this.options.maxMatches) as DeflectionMatch[];
    } catch (error) {
      // AbortError fires both on timeout and on cancellation by the
      // next debounce tick — both are expected, never an `onError`.
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (!isAbort) {
        this.options.onError(error);
      }
      return [];
    } finally {
      clearTimeout(timeoutId);
      // Only null out if WE'RE still the in-flight one — a newer
      // probe could have already replaced us.
      if (this.inFlight === controller) {
        this.inFlight = null;
      }
    }
  }
}

/**
 * Stable label keys returned by `canonicalStatusKey`. Consumers
 * with i18n wire these into their translation tables (e.g. the
 * admin app's `bugspotter.status.in_progress`); consumers without
 * i18n use the English defaults via `statusLabel`.
 */
export type StatusLabelKey = 'open' | 'in_progress' | 'closed' | 'wont_fix';

/**
 * Normalise an arbitrary backend status string to one of the four
 * known keys, or `null` if it doesn't match. Lets a consumer
 * branch on the canonical form without re-implementing the alias
 * map (hyphenated vs underscored, `closed` vs `resolved`, etc).
 */
export function canonicalStatusKey(status: string): StatusLabelKey | null {
  if (typeof status !== 'string' || status.length === 0) {
    return null;
  }
  switch (status.toLowerCase()) {
    case 'open':
      return 'open';
    case 'in_progress':
    case 'in-progress':
      return 'in_progress';
    case 'closed':
    case 'resolved':
      return 'closed';
    case 'wont_fix':
    case 'wont-fix':
    case 'wontfix':
      return 'wont_fix';
    default:
      return null;
  }
}

/** English default labels per canonical key. */
const DEFAULT_STATUS_LABELS: Record<StatusLabelKey, string> = {
  open: 'Open',
  in_progress: 'In progress',
  closed: 'Fixed',
  wont_fix: 'Won’t fix',
};

/**
 * Map intelligence status strings to short user-friendly labels.
 *
 * `t` is an optional translator hook so the SDK / extension /
 * admin apps that already have i18n wired (en/ru/kk) can render
 * localised labels without forking this function. When `t` is
 * supplied, it's called with a stable key of the form
 * `'bugspotter.status.<canonical>'` (e.g. `'bugspotter.status.in_progress'`).
 * A falsy / empty return from `t` falls back to the English default,
 * so partial translation coverage degrades gracefully.
 *
 * Without `t`, returns the English default. Unknown statuses pass
 * through verbatim — the backend may add new values that consumers
 * understand before this library does.
 *
 * Defensive: `status` is typed string but the module's "never throws"
 * contract has to hold even when the backend returns an unexpected
 * shape (null / undefined / number from a future API version).
 */
export function statusLabel(status: string, t?: (key: string) => string): string {
  const key = canonicalStatusKey(status);
  if (key === null) {
    // Unknown status — pass through the original (already string-
    // guarded by canonicalStatusKey). Empty for non-strings.
    return typeof status === 'string' ? status : '';
  }
  if (t) {
    // Translator is host-supplied external code; the "never throws"
    // contract has to hold even if the host's i18n system blows up
    // (e.g. i18next with a missing namespace, lazy-loaded bundle
    // that failed to fetch). Wrap defensively — any throw falls
    // back to the English default rather than propagating to the
    // widget render path.
    try {
      const translated = t(`bugspotter.status.${key}`);
      if (translated) {
        return translated;
      }
      // Translator returned empty/falsy → graceful fallback.
    } catch {
      // Fall through to default.
    }
  }
  return DEFAULT_STATUS_LABELS[key];
}
