export class TagManager {
  private tagMap = new Map<string, Set<string>>();

  addTags(id: string, tags: string[]): void {
    let tagSet = this.tagMap.get(id);
    if (!tagSet) {
      tagSet = new Set();
      this.tagMap.set(id, tagSet);
    }
    for (const tag of tags) {
      tagSet.add(tag);
    }
  }

  clear(): void {
    this.tagMap.clear();
  }

  clearUnusedTags(): void {
    for (const [id, tagSet] of this.tagMap) {
      if (tagSet.size === 0) {
        this.tagMap.delete(id);
      }
    }
  }

  getTags(id: string): string[] {
    const tagSet = this.tagMap.get(id);
    return tagSet ? [...tagSet] : [];
  }

  queryByTags(tags: string[], matchAll = false): string[] {
    if (tags.length === 0) {
      return [];
    }

    const result: string[] = [];
    for (const [id, tagSet] of this.tagMap) {
      const hasMatch = matchAll ? tags.every((tag) => tagSet.has(tag)) : tags.some((tag) => tagSet.has(tag));
      if (hasMatch) {
        result.push(id);
      }
    }
    return result;
  }
}
