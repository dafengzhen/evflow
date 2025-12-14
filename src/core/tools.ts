import type { WildcardCompileOptions } from './types.ts';

export const compileWildcard = (pattern: string, options: WildcardCompileOptions = {}): RegExp => {
  const { cache, flags = '', separator = '.' } = options;
  const cacheKey = `${pattern}||${separator}||${flags}`;

  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const escapedSep = escapeRegexChar(separator);
  let regexStr = '^';
  let escaped = false;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];

    if (!escaped && ch === '\\') {
      escaped = true;
      continue;
    }

    if (escaped) {
      regexStr += escapeRegexChar(ch);
      escaped = false;
      continue;
    }

    switch (ch) {
      case '#':
        regexStr += '.*';
        break;
      case '*':
        regexStr += `[^${escapedSep}]*`;
        break;
      case '+':
        regexStr += `[^${escapedSep}]+`;
        break;
      case '?':
        regexStr += `[^${escapedSep}]`;
        break;
      default:
        regexStr += escapeRegexChar(ch);
        break;
    }
  }

  if (escaped) {
    regexStr += '\\\\';
  }

  regexStr += '$';
  const regex = new RegExp(regexStr, flags);

  cache?.set(cacheKey, regex);
  return regex;
};

export const escapeRegexChar = (char: string): string => {
  return char.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
};

