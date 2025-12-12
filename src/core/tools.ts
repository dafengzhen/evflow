import type { AbstractEventEmitter } from './abstract-event-emitter.ts';
import type { AbstractConstructor, BaseEventDefinitions, WildcardCompileOptions } from './types.ts';

export const compileWildcard = (pattern: string, options: WildcardCompileOptions = {}): RegExp => {
  const { cache, flags = '', separator = '.' } = options;

  const cacheKey = `${pattern}||${separator}||${flags}`;
  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const sepClass = escapeRegexChar(separator);

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
        regexStr += `[^${sepClass}]*`;
        break;
      case '+':
        regexStr += `[^${sepClass}]+`;
        break;
      case '?':
        regexStr += `[^${sepClass}]`;
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

  const re = new RegExp(regexStr, flags);
  if (cache) {
    cache.set(cacheKey, re);
  }
  return re;
};

export const escapeRegexChar = (char: string): string => {
  return char.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
};

export const composeMixins = <T extends BaseEventDefinitions>(
  ...mixins: Array<(base: AbstractConstructor<AbstractEventEmitter<T>>) => AbstractConstructor<AbstractEventEmitter<T>>>
) => {
  return function applyMixins(
    BaseClass: AbstractConstructor<AbstractEventEmitter<T>>,
  ): AbstractConstructor<AbstractEventEmitter<T>> {
    return mixins.reduce((Base, mixin) => mixin(Base), BaseClass);
  };
};
