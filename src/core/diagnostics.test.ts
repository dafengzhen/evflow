import { beforeEach, describe, expect, it } from 'vitest';

import type { DiagnosticLevel } from '../types.ts';

import { Diagnostics } from './diagnostics.ts';

describe('Diagnostics', () => {
  let diagnostics: Diagnostics;

  beforeEach(() => {
    diagnostics = new Diagnostics();
  });

  describe('log methods', () => {
    it('should record error log with context', () => {
      const context = { userId: 123 };
      diagnostics.error('test error', context);
      const logs = diagnostics.getLogs();
      expect(logs[0].level).toBe('error');
      expect(logs[0].message).toBe('test error');
      expect(logs[0].context).toEqual(context);
    });

    it('should record info log without context', () => {
      diagnostics.info('test info');
      const logs = diagnostics.getLogs();
      expect(logs[0].level).toBe('info');
      expect(logs[0].context).toBeUndefined();
    });

    it('should record warn log with null context', () => {
      diagnostics.warn('test warn', undefined);
      const logs = diagnostics.getLogs();
      expect(logs[0].level).toBe('warn');
      expect(logs[0].context).toBeUndefined();
    });
  });

  describe('log()', () => {
    it('should add entry with context', () => {
      const testContext = { key: 'value' };
      diagnostics.log('info', 'message', testContext);
      const entry = diagnostics.getLogs()[0];
      expect(entry.context).toEqual(testContext);
    });

    it('should ignore undefined context', () => {
      diagnostics.log('error', 'message', undefined);
      const entry = diagnostics.getLogs()[0];
      expect(entry.context).toBeUndefined();
    });

    it('should include timestamp', () => {
      const before = Date.now();
      diagnostics.info('test');
      const entry = diagnostics.getLogs()[0];
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('getLogs()', () => {
    beforeEach(() => {
      diagnostics.error('error1');
      diagnostics.warn('warn1');
      diagnostics.info('info1');
      diagnostics.error('error2');
    });

    it('should return all logs when no filter', () => {
      expect(diagnostics.getLogs()).toHaveLength(4);
    });

    it('should filter by error level', () => {
      const errors = diagnostics.getLogs('error');
      expect(errors).toHaveLength(2);
      expect(errors.every((e) => e.level === 'error')).toBe(true);
    });

    it('should return empty array for non-existing level', () => {
      expect(diagnostics.getLogs('debug' as DiagnosticLevel)).toHaveLength(0);
    });
  });

  describe('clear()', () => {
    it('should empty the log array', () => {
      diagnostics.info('test');
      diagnostics.clear();
      expect(diagnostics.getLogs()).toHaveLength(0);
    });
  });
});
