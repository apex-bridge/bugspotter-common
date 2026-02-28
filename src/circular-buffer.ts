/**
 * Generic circular buffer — fixed-size FIFO that overwrites oldest items.
 *
 * @template T The type of items stored in the buffer
 */
export class CircularBuffer<T> {
  private items: T[] = [];
  private index = 0;
  private count = 0;

  constructor(private maxSize: number) {
    if (maxSize <= 0) {
      throw new Error('CircularBuffer maxSize must be greater than 0');
    }
  }

  /**
   * Add an item to the buffer. If full, the oldest item is overwritten.
   */
  add(item: T): void {
    if (this.count < this.maxSize) {
      this.items.push(item);
      this.count++;
    } else {
      this.items[this.index] = item;
    }
    this.index = (this.index + 1) % this.maxSize;
  }

  /**
   * Get all items in chronological order (oldest to newest).
   * Returns a copy of the internal array.
   */
  getAll(): T[] {
    if (this.count < this.maxSize) {
      return [...this.items];
    }
    return [
      ...this.items.slice(this.index),
      ...this.items.slice(0, this.index),
    ];
  }

  /**
   * Clear all items from the buffer.
   */
  clear(): void {
    this.items = [];
    this.index = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  get capacity(): number {
    return this.maxSize;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  get isFull(): boolean {
    return this.count >= this.maxSize;
  }
}
