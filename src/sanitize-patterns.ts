/**
 * PII pattern definitions for data sanitization.
 */

export type PIIPatternName =
  | 'email'
  | 'phone'
  | 'creditcard'
  | 'ssn'
  | 'iin'
  | 'ip'
  | 'apikey'
  | 'token'
  | 'password';

export interface PatternDefinition {
  name: PIIPatternName;
  regex: RegExp;
  description: string;
  examples?: string[];
  priority: number;
}

export const DEFAULT_PATTERNS: Record<PIIPatternName, PatternDefinition> = {
  email: {
    name: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    description: 'Email addresses',
    priority: 1,
  },
  creditcard: {
    name: 'creditcard',
    regex: /\b(?:\d{4}[-\s]){3}\d{4}\b|\b\d{4}[-\s]\d{6}[-\s]\d{5}\b|\b\d{13,19}\b/g,
    description: 'Credit card numbers',
    priority: 2,
  },
  ssn: {
    name: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b|\b(?<!\d)\d{9}(?!\d)\b/g,
    description: 'US Social Security Numbers',
    priority: 3,
  },
  iin: {
    name: 'iin',
    regex: /\b[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])\d{6}\b/g,
    description: 'Kazakhstan IIN/BIN',
    priority: 4,
  },
  ip: {
    name: 'ip',
    regex:
      /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b|(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    description: 'IPv4 and IPv6 addresses',
    priority: 5,
  },
  phone: {
    name: 'phone',
    regex:
      /\+\d{1,3}[-.\s]\d{3}[-.\s]\d{4}\b|\+\d{1,3}[-.\s]\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\(\d{3}\)\s*\d{3}[-.\s]\d{4}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,
    description: 'Phone numbers',
    priority: 6,
  },
  apikey: {
    name: 'apikey',
    regex:
      /\b(?:sk|pk)_(?:live|test)_[a-zA-Z0-9]{24,}\b|AIza[a-zA-Z0-9_-]{35}|ya29\.[a-zA-Z0-9_-]+|AKIA[a-zA-Z0-9]{16}\b/g,
    description: 'API keys (Stripe, Google, AWS)',
    priority: 7,
  },
  token: {
    name: 'token',
    regex:
      /\b(?:Bearer\s+)?[a-zA-Z0-9_-]{32,}\b|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}/g,
    description: 'Auth tokens (Bearer, GitHub, JWT-like)',
    priority: 8,
  },
  password: {
    name: 'password',
    regex:
      /(?:password|passwd|pwd)[\s:=]+[^\s]{6,}|(?:password|passwd|pwd)["']?\s*[:=]\s*["']?[^\s"']{6,}/gi,
    description: 'Password fields in text',
    priority: 9,
  },
};

/**
 * Pattern categories for grouping
 */
export const PATTERN_CATEGORIES = {
  financial: ['creditcard', 'ssn'] as PIIPatternName[],
  contact: ['email', 'phone'] as PIIPatternName[],
  identification: ['ssn', 'iin'] as PIIPatternName[],
  network: ['ip', 'email'] as PIIPatternName[],
  credentials: ['apikey', 'token', 'password'] as PIIPatternName[],
  kazakhstan: ['iin'] as PIIPatternName[],
} as const;

/**
 * Pre-configured pattern sets for common compliance/use cases
 */
export const PATTERN_PRESETS = {
  all: Object.keys(DEFAULT_PATTERNS) as PIIPatternName[],
  minimal: ['email', 'creditcard', 'ssn'] as PIIPatternName[],
  financial: ['creditcard', 'ssn'] as PIIPatternName[],
  contact: ['email', 'phone'] as PIIPatternName[],
  identification: ['ssn', 'iin'] as PIIPatternName[],
  credentials: ['apikey', 'token', 'password'] as PIIPatternName[],
  kazakhstan: ['email', 'phone', 'iin'] as PIIPatternName[],
  gdpr: ['email', 'phone', 'ip'] as PIIPatternName[],
  pci: ['creditcard'] as PIIPatternName[],
  security: [
    'email',
    'phone',
    'creditcard',
    'ssn',
    'apikey',
    'token',
    'password',
  ] as PIIPatternName[],
} as const;

export type PatternPresetName = keyof typeof PATTERN_PRESETS;

export function getAllPatternNames(): PIIPatternName[] {
  return Object.keys(DEFAULT_PATTERNS) as PIIPatternName[];
}

export function getPatternsByPriority(
  patterns: PatternDefinition[],
): PatternDefinition[] {
  return [...patterns].sort((a, b) => a.priority - b.priority);
}

export function getPatternsByPreset(
  preset: PatternPresetName,
): PIIPatternName[] {
  return [...PATTERN_PRESETS[preset]];
}

export function createPatternConfig(
  preset: PatternPresetName | PIIPatternName[],
): PatternDefinition[] {
  const names = typeof preset === 'string' ? PATTERN_PRESETS[preset] : preset;
  return names.map((name) => DEFAULT_PATTERNS[name]);
}

/**
 * Validate a custom pattern regex for performance issues
 */
export function validatePattern(
  pattern: PatternDefinition,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!pattern.name) errors.push('Pattern must have a name');
  if (!pattern.regex) {
    errors.push('Pattern must have a regex');
  } else {
    if (!pattern.regex.global)
      errors.push('Pattern regex must have global flag');
    try {
      const testString = 'a'.repeat(1000);
      const start = Date.now();
      testString.match(pattern.regex);
      if (Date.now() - start > 100) {
        errors.push('Pattern regex may cause performance issues');
      }
    } catch (e) {
      errors.push(`Pattern regex error: ${(e as Error).message}`);
    }
  }
  return { valid: errors.length === 0, errors };
}
