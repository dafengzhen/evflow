import { beforeEach, describe, expect, test } from 'vitest';

import { TagManager } from './tag-manager.ts';

describe('TagManager', () => {
  let manager: TagManager;

  beforeEach(() => {
    manager = new TagManager();
  });

  describe('addTags', () => {
    test('should add tags to new ID', () => {
      manager.addTags('id1', ['tag1', 'tag2']);
      expect(manager.getTags('id1')).toEqual(['tag1', 'tag2']);
    });

    test('should merge tags for existing ID', () => {
      manager.addTags('id1', ['tag1']);
      manager.addTags('id1', ['tag2']);
      expect(manager.getTags('id1')).toEqual(expect.arrayContaining(['tag1', 'tag2']));
    });
  });

  describe('clear', () => {
    test('should clear all entries', () => {
      manager.addTags('id1', ['tag1']);
      manager.clear();
      expect(manager.getTags('id1')).toEqual([]);
    });
  });

  describe('clearUnusedTags', () => {
    test('should remove IDs with empty tag sets', () => {
      manager.addTags('id1', []);
      manager.addTags('id2', ['tag1']);
      manager.clearUnusedTags();
      expect(manager.getTags('id1')).toEqual([]);
      expect(manager.getTags('id2')).toEqual(['tag1']);
    });
  });

  describe('getTags', () => {
    test('should return empty array for unknown ID', () => {
      expect(manager.getTags('nonexistent')).toEqual([]);
    });

    test('should return tags for existing ID', () => {
      manager.addTags('id1', ['tag1']);
      expect(manager.getTags('id1')).toEqual(['tag1']);
    });
  });

  describe('queryByTags', () => {
    beforeEach(() => {
      manager.addTags('id1', ['tag1', 'tag2']);
      manager.addTags('id2', ['tag2', 'tag3']);
      manager.addTags('id3', ['tag1', 'tag3']);
    });

    test('should find any match (default)', () => {
      const result = manager.queryByTags(['tag1', 'tag4']);
      expect(result.sort()).toEqual(['id1', 'id3']);
    });

    test('should find all matches', () => {
      const result = manager.queryByTags(['tag1', 'tag2'], true);
      expect(result).toEqual(['id1']);
    });

    test('should handle empty tags array (any match)', () => {
      const result = manager.queryByTags([]);
      expect(result).toEqual([]);
    });

    test('should handle empty tags array (all match)', () => {
      const result = manager.queryByTags([], true);
      expect(result).toEqual([]);
    });

    test('should return empty array when no matches', () => {
      const result = manager.queryByTags(['tag4']);
      expect(result).toEqual([]);
    });
  });
});
