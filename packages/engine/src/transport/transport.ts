/**
 * Transport: play / pause / stop / seek (play-from-point) / loop.
 *
 * The transport schedules an `AudioBufferSourceNode` per audible clip against the audio
 * clock, and derives the live playhead from the clock using the pure helpers in `clock.ts`.
 * Because the playhead is *derived* (not ticked manually), it stays sample-accurate.
 *
 * This class drives the Web Audio API and is verified in the app; its timing logic lives in
 * the unit-tested `clock.ts`.
 */
import { Emitter } from '../core/emitter.js';
import type { EngineContext } from '../core/engine-context.js';
import { anyTrackSoloed, isTrackAudible } from '../model/project.js';
import type { Project } from '../model/types.js';
import {
  clampSeek,
  currentPosition,
  normalizeLoop,
  type LoopRegion,
  type PlayAnchor,
} from './clock.js';

export type TransportState = 'stopped' | 'playing' | 'paused';

export interface TransportEvents extends Record<string, unknown> {
  statechange: TransportState;
  /** Fired on seek with the new position (seconds). */
  seek: number;
  /** Fired when playback reaches the project end (non-looping). */
  ended: void;
}

/** A live source scheduled for one clip, tracked so we can stop it. */
interface ScheduledSource {
  node: AudioBufferSourceNode;
}

export class Transport {
  readonly events = new Emitter<TransportEvents>();

  #ctx: EngineContext;
  #getProject: () => Project;

  #state: TransportState = 'stopped';
  #position = 0; // playhead when stopped/paused (seconds)
  #anchor: PlayAnchor | null = null;
  #loop: LoopRegion | null = null;
  #sources: ScheduledSource[] = [];

  constructor(ctx: EngineContext, getProject: () => Project) {
    this.#ctx = ctx;
    this.#getProject = getProject;
  }

  get state(): TransportState {
    return this.#state;
  }

  get loop(): LoopRegion | null {
    return this.#loop;
  }

  /** Set (or clear) the loop region. Normalized; an empty/inverted region clears it. */
  setLoop(loop: LoopRegion | null): void {
    this.#loop = normalizeLoop(loop);
  }

  /** The live playhead position in seconds. Derived from the audio clock while playing. */
  get position(): number {
    if (this.#state === 'playing' && this.#anchor) {
      return currentPosition(this.#anchor, this.#ctx.currentTime, this.#loop);
    }
    return this.#position;
  }

  /** Total project duration in seconds. */
  #duration(): number {
    let end = 0;
    for (const track of this.#getProject().tracks) {
      for (const clip of track.clips) end = Math.max(end, clip.start + clip.buffer.duration);
    }
    return end;
  }

  /** Start playback from the current position (resumes the context first). */
  async play(): Promise<void> {
    if (this.#state === 'playing') return;
    await this.#ctx.resume();
    this.#startSources(this.#position);
    this.#setState('playing');
  }

  /** Pause: stop sources but keep the current playhead position. */
  pause(): void {
    if (this.#state !== 'playing') return;
    this.#position = this.position; // freeze derived position
    this.#stopSources();
    this.#setState('paused');
  }

  /** Stop: stop sources and reset the playhead to 0. */
  stop(): void {
    this.#stopSources();
    this.#position = 0;
    this.#anchor = null;
    this.#setState('stopped');
  }

  /** Seek to a position (play-from-point). Reschedules if currently playing. */
  seek(position: number): void {
    const pos = clampSeek(position, this.#duration());
    this.#position = pos;
    if (this.#state === 'playing') {
      this.#stopSources();
      this.#startSources(pos);
    }
    this.events.emit('seek', pos);
  }

  /** Schedule a source per audible clip so that the playhead lands at `fromPosition`. */
  #startSources(fromPosition: number): void {
    const ctx = this.#ctx.context;
    const startClock = ctx.currentTime;
    this.#anchor = { startPosition: fromPosition, startClock };

    const project = this.#getProject();
    const soloed = anyTrackSoloed(project.tracks);

    for (const track of project.tracks) {
      if (!isTrackAudible(track, soloed)) continue;
      for (const clip of track.clips) {
        const clipStart = clip.start;
        const clipEnd = clip.start + clip.buffer.duration;
        if (clipEnd <= fromPosition) continue; // already past this clip

        const node = ctx.createBufferSource();
        node.buffer = clip.buffer;
        node.connect(this.#ctx.master);

        if (fromPosition <= clipStart) {
          // Clip begins in the future: start it after the lead-in delay.
          node.start(startClock + (clipStart - fromPosition));
        } else {
          // Playhead is inside the clip: start now, offset into the buffer.
          node.start(startClock, fromPosition - clipStart);
        }
        this.#sources.push({ node });
      }
    }
  }

  #stopSources(): void {
    for (const { node } of this.#sources) {
      try {
        node.stop();
      } catch {
        // already stopped — ignore
      }
      node.disconnect();
    }
    this.#sources = [];
  }

  #setState(state: TransportState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.events.emit('statechange', state);
  }

  dispose(): void {
    this.#stopSources();
    this.events.clear();
  }
}
