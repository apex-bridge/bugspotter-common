/**
 * Time-based buffer for storing replay events.
 * Automatically prunes events older than the configured duration.
 * Always preserves the most recent FullSnapshot (type === 2) and the Meta
 * event (type === 4) immediately before it — rrweb-player needs the Meta to
 * set up viewport / href before applying the snapshot, otherwise the canvas
 * renders blank even though playback "starts".
 */

export interface ReplayEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

const FULL_SNAPSHOT_TYPE = 2;
const META_TYPE = 4;

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

    // Preserve the latest FullSnapshot even if older than cutoff, and the
    // Meta event that precedes it (rrweb emits Meta right before each
    // FullSnapshot to anchor viewport / href). Dropping the Meta leaves
    // rrweb-player without dimensions to render the snapshot into.
    //
    // Math.min is used (not unconditional assign) because the Meta can land
    // just past the cutoff while the FullSnapshot is still in-window — in
    // that case we need to BACK UP firstValidIndex to include the Meta, but
    // we must never push it FORWARD past younger events the cutoff already
    // accepted.
    if (this.lastFullSnapshotIndex >= 0) {
      const protectedStart =
        this.lastFullSnapshotIndex > 0 &&
        this.events[this.lastFullSnapshotIndex - 1].type === META_TYPE
          ? this.lastFullSnapshotIndex - 1
          : this.lastFullSnapshotIndex;
      firstValidIndex = Math.min(firstValidIndex, protectedStart);
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
