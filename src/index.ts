// Circular buffer
export { CircularBuffer } from './circular-buffer';

// Time-based buffer for replay events
export { TimeBasedBuffer, type ReplayEvent } from './time-based-buffer';

// PII sanitization patterns
export {
  type PIIPatternName,
  type PatternDefinition,
  type PatternPresetName,
  DEFAULT_PATTERNS,
  PATTERN_CATEGORIES,
  PATTERN_PRESETS,
  getAllPatternNames,
  getPatternsByPriority,
  getPatternsByPreset,
  createPatternConfig,
  validatePattern,
} from './sanitize-patterns';

// PII sanitizer
export {
  Sanitizer,
  type SanitizeConfig,
  createSanitizer,
} from './sanitizer';

// Deduplication
export {
  BugReportDeduplicator,
  type DeduplicationConfig,
} from './deduplicator';

// Retry with exponential backoff
export { retryWithBackoff, type RetryConfig } from './retry';

// URL helpers
export {
  isSecureEndpoint,
  getApiBaseUrl,
  stripEndpointSuffix,
  InvalidEndpointError,
  InsecureEndpointError,
} from './url-helpers';
