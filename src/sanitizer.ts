/**
 * PII sanitizer — recursively sanitizes strings, objects, and arrays.
 */

import {
  type PIIPatternName,
  DEFAULT_PATTERNS,
  getPatternsByPriority,
  getAllPatternNames,
} from './sanitize-patterns.js';

export interface SanitizeConfig {
  enabled: boolean;
  patterns?: PIIPatternName[];
}

export class Sanitizer {
  private enabled: boolean;
  private patterns: Map<string, RegExp> = new Map();

  constructor(config: SanitizeConfig) {
    this.enabled = config.enabled;

    if (!this.enabled) return;

    const names = config.patterns ?? getAllPatternNames();
    const defs = names.map((n) => DEFAULT_PATTERNS[n]);
    const sorted = getPatternsByPriority(defs);

    for (const def of sorted) {
      this.patterns.set(def.name, def.regex);
    }
  }

  sanitize(value: unknown): unknown {
    if (!this.enabled) return value;
    return this.sanitizeValue(value);
  }

  sanitizeString(value: string): string {
    if (!this.enabled || typeof value !== 'string') return value;

    let result = value;
    this.patterns.forEach((regex, name) => {
      result = result.replace(regex, `[REDACTED-${name.toUpperCase()}]`);
    });
    return result;
  }

  sanitizeConsoleArgs(args: unknown[]): unknown[] {
    if (!this.enabled) return args;
    return args.map((arg) => this.sanitizeValue(arg));
  }

  sanitizeNetworkData<T extends Record<string, unknown>>(data: T): T {
    if (!this.enabled) return data;
    return this.sanitizeValue(data) as T;
  }

  /**
   * Sanitize error objects (message + stack)
   */
  sanitizeError(error: {
    message?: string;
    stack?: string;
  }): { message?: string; stack?: string } {
    if (!this.enabled) return error;
    return {
      ...error,
      message: error.message
        ? this.sanitizeString(error.message)
        : error.message,
      stack: error.stack ? this.sanitizeString(error.stack) : error.stack,
    };
  }

  /**
   * Sanitize text node content for rrweb replay recordings.
   * Used as maskTextFn callback — redacts PII from visible DOM text.
   */
  sanitizeTextNode(text: string, _element?: HTMLElement): string {
    if (!this.enabled) return text;
    return this.sanitizeString(text);
  }

  private sanitizeValue(value: unknown): unknown {
    if (value == null) return value;
    if (typeof value === 'string') return this.sanitizeString(value);
    if (Array.isArray(value))
      return value.map((item) => this.sanitizeValue(item));

    if (typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        const sanitizedKey = this.sanitizeString(key);
        sanitized[sanitizedKey] = this.sanitizeValue(val);
      }
      return sanitized;
    }

    return value;
  }
}

export function createSanitizer(config: SanitizeConfig): Sanitizer {
  return new Sanitizer(config);
}
