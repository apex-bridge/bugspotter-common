/**
 * Bug report deduplicator — prevents duplicate submissions.
 * Uses djb2 hash with a configurable sliding window.
 */

export interface DeduplicationConfig {
  windowMs: number;
  maxCacheSize: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: DeduplicationConfig = {
  windowMs: 60000,
  maxCacheSize: 100,
  enabled: true,
};

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (((hash << 5) | 0) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function createFingerprint(
  title: string,
  description: string,
  errorContext?: string,
): string {
  let composite = `${title.trim().toLowerCase()}|${description.trim().toLowerCase()}`;
  if (errorContext) {
    composite += `|${errorContext.trim().toLowerCase()}`;
  }
  return djb2Hash(composite);
}

export class BugReportDeduplicator {
  private recentReports = new Map<string, number>();
  private submitting = new Set<string>();
  private config: DeduplicationConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<DeduplicationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.enabled) {
      this.cleanupTimer = setInterval(
        () => this.cleanup(),
        this.config.windowMs / 2,
      );
    }
  }

  isDuplicate(
    title: string,
    description: string,
    errorContext?: string,
  ): boolean {
    if (!this.config.enabled) return false;

    const fp = createFingerprint(title, description, errorContext);

    // Block if already submitting (double-click prevention)
    if (this.submitting.has(fp)) return true;

    const ts = this.recentReports.get(fp);
    if (ts && Date.now() - ts < this.config.windowMs) return true;

    return false;
  }

  isInProgress(
    title: string,
    description: string,
    errorContext?: string,
  ): boolean {
    return this.submitting.has(
      createFingerprint(title, description, errorContext),
    );
  }

  markInProgress(
    title: string,
    description: string,
    errorContext?: string,
  ): void {
    this.submitting.add(createFingerprint(title, description, errorContext));
  }

  markComplete(
    title: string,
    description: string,
    errorContext?: string,
  ): void {
    const fp = createFingerprint(title, description, errorContext);
    this.submitting.delete(fp);

    // Enforce cache size
    if (this.recentReports.size >= this.config.maxCacheSize) {
      const firstKey = this.recentReports.keys().next().value;
      if (firstKey) this.recentReports.delete(firstKey);
    }

    this.recentReports.set(fp, Date.now());
  }

  private cleanup(): void {
    const now = Date.now();
    this.recentReports.forEach((ts, key) => {
      if (now - ts > this.config.windowMs) {
        this.recentReports.delete(key);
      }
    });
  }

  removeInProgress(
    title: string,
    description: string,
    errorContext?: string,
  ): void {
    this.submitting.delete(createFingerprint(title, description, errorContext));
  }

  clear(): void {
    this.recentReports.clear();
    this.submitting.clear();
  }

  destroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }

  get cacheSize(): number {
    return this.recentReports.size;
  }
}
