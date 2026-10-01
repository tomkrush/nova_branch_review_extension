// Which diffs have been reviewed. A mark is the file's diff key (path + both blob ids), so a
// changed diff no longer matches and the file counts as unreviewed again.

class Review {
  constructor(store) {
    this.store = store; // { get(): string[], set(string[]) }
    this.keys = new Set(store.get());
  }

  has(key) {
    return this.keys.has(key);
  }

  set(keys, on) {
    for (const k of keys) on ? this.keys.add(k) : this.keys.delete(k);
    this.save();
  }

  // Forget marks for listed files whose diff has since changed.
  prune(files) {
    const live = new Map(files.map((f) => [f.path, f.key]));
    let changed = false;
    for (const k of [...this.keys]) {
      const path = k.split("\t")[0];
      if (live.has(path) && live.get(path) !== k) {
        this.keys.delete(k);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  save() {
    this.store.set([...this.keys]);
  }
}

module.exports = { Review };
