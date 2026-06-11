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
import { buildChain, type BuiltChain } from '../effects/nodes.js';
import type { EffectState } from '../effects/types.js';
import { anyTrackSoloed, clipDuration, clipEnd, trackTargetGain } from '../model/project.js';
import type { Project, Track } from '../model/types.js';
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
  /** Per-track fader gain: chain → gain → trackPanner. Created lazily. */
  #trackGains = new Map<string, GainNode>();
  /** Per-track pedalboard chain: head → chain → gain. Created lazily. */
  #trackChains = new Map<string, BuiltChain>();
  /** Per-track stereo panner: gain → trackPanner → master. Created lazily. */
  #trackPanners = new Map<string, StereoPannerNode>();
  /** Per-track graph head — the node that sources connect to. After fader flip = chain.input. */
  #trackHeads = new Map<string, AudioNode>();

  /** Declick ramp time constant (seconds) for live gain changes — ~10 ms, no clicks. */
  static readonly #RAMP = 0.01;

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
      for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
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

    for (const track of project.tracks) {
      // Audibility is now carried by the per-track gain node (set via applyTrackLevels),
      // so we schedule sources for every track and let the live gain mute/solo them. This
      // is what lets mute/solo/volume changes take effect mid-playback.
      const head = this.#ensureTrackGraph(track.id, track.effects ?? []);
      for (const clip of track.clips) {
        const trimStart = clip.trimStart ?? 0;
        const visible = clipDuration(clip);
        if (visible <= 0) continue; // skip corrupt/zero-length clips
        const clipStart = clip.start;
        const clipEndPos = clipStart + visible;
        if (clipEndPos <= fromPosition) continue; // already past this clip

        const node = ctx.createBufferSource();
        node.buffer = clip.buffer;
        node.connect(head);

        if (fromPosition <= clipStart) {
          // Clip begins in the future: start after the lead-in, read the trimmed window.
          node.start(startClock + (clipStart - fromPosition), trimStart, visible);
        } else {
          // Playhead is inside the clip: start now, offset past the head trim + elapsed.
          const into = fromPosition - clipStart;
          node.start(startClock, trimStart + into, visible - into);
        }
        this.#sources.push({ node });
      }
    }

    // Initialise the per-track levels for this playback pass (mute/solo/volume).
    this.applyTrackLevels();
  }

  /**
   * Ensure a track's full graph exists and is wired: chain → gain → panner → master (post-fader).
   * Created lazily and cached; `effects` seeds the chain on first build. Returns the head node
   * (chain.input) — the node sources connect to.
   */
  #ensureTrackGraph(trackId: string, effects: readonly EffectState[] = []): AudioNode {
    let head = this.#trackHeads.get(trackId);
    if (head) return head;
    const ctx = this.#ctx.context;
    const gain = ctx.createGain();
    const chain = buildChain(ctx, effects);
    const panner = ctx.createStereoPanner();
    // Post-fader: source → chain → gain → panner → master
    chain.output.connect(gain);
    gain.connect(panner);
    panner.connect(this.#ctx.master);
    this.#trackHeads.set(trackId, chain.input);
    this.#trackGains.set(trackId, gain);
    this.#trackChains.set(trackId, chain);
    this.#trackPanners.set(trackId, panner);
    return chain.input;
  }

  /** Get (creating the graph if needed) the gain node for a track (for gain-control use). */
  #trackGain(trackId: string): GainNode {
    this.#ensureTrackGraph(trackId);
    return this.#trackGains.get(trackId)!;
  }

  /** Get (creating the graph if needed) the panner for a track. */
  #trackPanner(trackId: string): StereoPannerNode {
    this.#ensureTrackGraph(trackId);
    return this.#trackPanners.get(trackId)!;
  }

  /**
   * Rebuild (or param-update) a track's pedalboard chain from the model. Splices the new chain
   * back into chain → gain → panner (post-fader). A full rebuild handles add/remove/reorder;
   * pass `paramsOnly` to update existing nodes in place (slider drags) without reconnecting.
   */
  applyTrackEffects(track: Pick<Track, 'id' | 'effects'>, paramsOnly = false): void {
    const effects = track.effects ?? [];
    const existing = this.#trackChains.get(track.id);
    // No graph yet → build it lazily with this chain (e.g. editing before first play).
    if (!existing) {
      this.#ensureTrackGraph(track.id, effects);
      return;
    }
    if (paramsOnly && existing.effects.length === effects.length) {
      // Same shape: update params in place (declicked), no reconnection.
      for (let i = 0; i < effects.length; i++) {
        if (existing.effects[i]!.id === effects[i]!.id) existing.effects[i]!.update(effects[i]!);
      }
      return;
    }
    // Structural change: dispose old chain; wire new chain between head and gain.
    // gain → panner stays connected — only the chain segment changes.
    const ctx = this.#ctx.context;
    const gain = this.#trackGains.get(track.id)!;
    const next = buildChain(ctx, effects);
    existing.dispose();
    next.output.connect(gain);
    this.#trackChains.set(track.id, next);
    this.#trackHeads.set(track.id, next.input);
    // Note: sources scheduled in the current playback pass still connect to the old head.
    // They will continue playing through the old (now-disposed) chain until the next play.
    // This pre-existing limitation is unchanged by the fader flip.
  }

  /** Whether a track currently has a non-empty live effect chain (read-only, for E2E). */
  liveTrackHasEffects(trackId: string): boolean {
    return (this.#trackChains.get(trackId)?.effects.length ?? 0) > 0;
  }

  /**
   * Recompute every track's live gain from the current model and ramp the per-track gain
   * nodes to it. Call after any mute / solo / volume change so it is heard immediately —
   * whether or not playback is running (when stopped it just sets the next play's targets).
   */
  applyTrackLevels(): void {
    const project = this.#getProject();
    const soloed = anyTrackSoloed(project.tracks);
    const now = this.#ctx.currentTime;
    for (const track of project.tracks) {
      const target = trackTargetGain(track, soloed);
      this.#trackGain(track.id).gain.setTargetAtTime(target, now, Transport.#RAMP);
      this.#trackPanner(track.id).pan.value = track.pan;
    }
  }

  /**
   * The current value of a track's live gain node, or `undefined` if no node exists yet.
   * Read-only — exposed for verification (tests / debugging), not for control.
   */
  liveTrackGain(trackId: string): number | undefined {
    return this.#trackGains.get(trackId)?.gain.value;
  }

  /** Release a removed track's gain node (disconnect + drop) to avoid a graph leak. */
  releaseTrack(trackId: string): void {
    const gain = this.#trackGains.get(trackId);
    if (gain) {
      gain.disconnect();
      this.#trackGains.delete(trackId);
    }
    const chain = this.#trackChains.get(trackId);
    if (chain) {
      chain.dispose();
      this.#trackChains.delete(trackId);
    }
    const panner = this.#trackPanners.get(trackId);
    if (panner) {
      panner.disconnect();
      this.#trackPanners.delete(trackId);
    }
    this.#trackHeads.delete(trackId);
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
    for (const node of this.#trackGains.values()) node.disconnect();
    this.#trackGains.clear();
    for (const chain of this.#trackChains.values()) chain.dispose();
    this.#trackChains.clear();
    for (const node of this.#trackPanners.values()) node.disconnect();
    this.#trackPanners.clear();
    this.#trackHeads.clear();
    this.events.clear();
  }
}
