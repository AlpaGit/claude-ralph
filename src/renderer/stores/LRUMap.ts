/**
 * LRUMap — Lightweight Least-Recently-Used cache built on top of `Map`.
 *
 * Leverages Map's insertion-order iteration to track recency: a `get` or `set`
 * deletes and re-inserts the key so it moves to the end (most-recent).  When
 * the capacity is exceeded, the first entry (least-recent) is evicted.
 *
 * An optional `dispose` callback is invoked synchronously on every evicted
 * value, enabling cleanup (e.g. clearing a RingBuffer to release its array).
 *
 * Time complexity: get O(1)*, set O(1)*, delete O(1), has O(1).
 * (* amortized; the delete+re-insert trick is O(1) for V8's ordered Map.)
 */
export class LRUMap<K, V> {
  private readonly map = new Map<K, V>();
  readonly capacity: number;
  private readonly dispose?: (value: V, key: K) => void;

  constructor(capacity: number, dispose?: (value: V, key: K) => void) {
    if (capacity < 1) throw new RangeError("LRUMap capacity must be >= 1");
    this.capacity = capacity;
    this.dispose = dispose;
  }

  /** Number of entries currently stored. */
  get size(): number {
    return this.map.size;
  }

  /** Retrieve a value and promote the key to most-recently-used. */
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Promote to most-recent by re-inserting
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** Check if a key exists (does NOT promote recency). */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /**
   * Insert or update a key-value pair. If the key already exists it is
   * promoted to most-recent. If the cache exceeds capacity, the
   * least-recently-used entry is evicted (and `dispose` is called on it).
   */
  set(key: K, value: V): this {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.evictIfNeeded();
    return this;
  }

  /** Remove a specific key. Returns true if the key existed. Calls `dispose` on the evicted value. */
  delete(key: K): boolean {
    const value = this.map.get(key);
    const existed = this.map.delete(key);
    if (existed && this.dispose && value !== undefined) {
      this.dispose(value, key);
    }
    return existed;
  }

  /** Remove all entries. Calls `dispose` on each evicted value. */
  clear(): void {
    if (this.dispose) {
      for (const [key, value] of this.map) {
        this.dispose(value, key);
      }
    }
    this.map.clear();
  }

  /** Iterate over all entries in least-recent → most-recent order. */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.map[Symbol.iterator]();
  }

  /** Iterate over keys in least-recent → most-recent order. */
  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  /** Iterate over values in least-recent → most-recent order. */
  values(): IterableIterator<V> {
    return this.map.values();
  }

  /** Iterate over entries in least-recent → most-recent order. */
  entries(): IterableIterator<[K, V]> {
    return this.map.entries();
  }

  /** Evict entries from the front (oldest) until size <= capacity. */
  private evictIfNeeded(): void {
    while (this.map.size > this.capacity) {
      // Map iterator yields entries in insertion order; first entry is the LRU.
      const { value: entry, done } = this.map.entries().next();
      if (done) break; // shouldn't happen, but guard against it
      const [key, value] = entry as [K, V];
      this.map.delete(key);
      this.dispose?.(value, key);
    }
  }
}
