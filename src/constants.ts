import type { PatternMatchingOptions } from './types/types.ts';

export const DEFAULT_MAX_CONCURRENCY = Infinity;

export const DEFAULT_PARALLEL = true;

export const DEFAULT_STOP_ON_ERROR = false;

export const DEFAULT_PRIORITY = 0;

export const DEFAULT_PATTERN_OPTIONS: Required<PatternMatchingOptions> = {
  allowZeroLengthDoubleWildcard: false,
  matchMultiple: false,
  separator: '.',
  wildcard: '*',
};
