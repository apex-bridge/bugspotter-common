/**
 * Time-based buffer for storing replay events.
 * Automatically prunes events older than the configured duration.
 * Always preserves the most recent FullSnapshot (type === 2).
 */

export interface ReplayEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

const FULL_SNAPSHOT_TYPE = 2;

export class TimeBasedBuffer {
  private events: ReplayEvent[] = [];
  private duration: number; // in milliseconds
  private lastFullSnapshotIndex = -1;

  constructor(durationSeconds = 60) {
    this.duration = durationSeconds * 1000;
  }

  add(event: ReplayEvent): void {
    if (event.type === FULL_SNAPSHOT_TYPE) {
      this.lastFullSnapshotIndex = this.events.length;
    }
    this.events.push(event);
    this.prune();
  }

  private prune(): void {
    if (this.events.length === 0) return;

    const cutoffTime = Date.now() - this.duration;

    let firstValidIndex = this.events.length;
    for (let i = 0; i < this.events.length; i++) {
      if (this.events[i].timestamp >= cutoffTime) {
        firstValidIndex = i;
        break;
      }
    }

    // Preserve full snapshot even if it's older than cutoff
    if (this.lastFullSnapshotIndex >= 0 && this.lastFullSnapshotIndex < firstValidIndex) {
      firstValidIndex = this.lastFullSnapshotIndex;
    }

    if (firstValidIndex === 0) return;

    this.events = this.events.slice(firstValidIndex);

    if (this.lastFullSnapshotIndex >= 0) {
      this.lastFullSnapshotIndex -= firstValidIndex;
    }
  }

  getEvents(): ReplayEvent[] {
    this.prune();
    return [...this.events];
  }

  clear(): void {
    this.events = [];
    this.lastFullSnapshotIndex = -1;
  }

  get size(): number {
    return this.events.length;
  }
}
