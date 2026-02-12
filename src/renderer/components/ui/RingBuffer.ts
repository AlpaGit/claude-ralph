/**
 * RingBuffer -- circular fixed-capacity array for log line storage.
 *
 * Stores up to `capacity` items (default 5 000). When the buffer is full,
 * the oldest item is silently overwritten.
 *
 * Time complexity: push O(1), toArray O(n), get O(1), length O(1).
 */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0; // next write position
  private count = 0;
  readonly capacity: number;

  constructor(capacity = 5_000) {
    if (capacity < 1) throw new RangeError("RingBuffer capacity must be >= 1");
    this.capacity = capacity;
    this.buf = new Array<T | undefined>(capacity);
  }

  /** Number of items currently stored. */
  get length(): number {
    return this.count;
  }

  /** Append an item. If the buffer is full the oldest entry is overwritten. */
  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /** Retrieve item at logical index (0 = oldest). Returns undefined if out of range. */
  get(index: number): T | undefined {
    if (index < 0 || index >= this.count) return undefined;
    const realIndex = (this.head - this.count + index + this.capacity) % this.capacity;
    return this.buf[realIndex];
  }

  /** Return all stored items in insertion order (oldest first). */
  toArray(): T[] {
    if (this.count === 0) return [];
    const result: T[] = new Array(this.count);
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(start + i) % this.capacity] as T;
    }
    return result;
  }

  /** Remove all items. */
  clear(): void {
    this.buf = new Array<T | undefined>(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}
