/**
 * The Studio: the app's single bridge to `@audiosandbox/engine`.
 *
 * It owns the engine objects (audio context, transport) and the project model, and mirrors
 * the bits the UI needs into Svelte 5 runes so components stay reactive. Components call
 * methods here; they never touch engine internals or audio nodes directly. This is the
 * Svelte-side embodiment of the engine/app boundary.
 */
import {
  createClip,
  createContextFactory,
  createProject,
  createTrack,
  EngineContext,
  Transport,
  type BufferFactory,
  type Clip,
  type Project,
  type Track,
} from '@audiosandbox/engine';

export class Studio {
  readonly #engine = new EngineContext();
  readonly #transport: Transport;

  /** Reactive mirror of the project model. Reassigned wholesale to trigger reactivity. */
  project = $state<Project>(createProject());
  /** Reactive transport state + playhead, polled while playing. */
  transportState = $state<'stopped' | 'playing' | 'paused'>('stopped');
  playhead = $state(0);
  masterVolume = $state(80);

  #raf = 0;

  constructor() {
    this.#transport = new Transport(this.#engine, () => this.project);
    this.#transport.events.on('statechange', (s) => {
      this.transportState = s;
      if (s === 'playing') this.#startPlayheadLoop();
      else this.#stopPlayheadLoop();
    });
    this.#transport.events.on('seek', (pos) => {
      this.playhead = pos;
    });
    this.#engine.setMasterVolume(this.masterVolume);
  }

  /** A BufferFactory bound to the live audio context, for buffer-ops. */
  get bufferFactory(): BufferFactory {
    return createContextFactory(this.#engine.context);
  }

  get sampleRate(): number {
    return this.#engine.sampleRate;
  }

  // ---- project mutation (reassign to trigger Svelte reactivity) ----

  addTrack(name?: string): Track {
    const track = createTrack(name ?? `Track ${this.project.tracks.length + 1}`);
    this.project = { ...this.project, tracks: [...this.project.tracks, track] };
    return track;
  }

  removeTrack(trackId: string): void {
    this.project = {
      ...this.project,
      tracks: this.project.tracks.filter((t) => t.id !== trackId),
    };
  }

  /** Replace a track (e.g. after mute/solo/volume change or editing a clip). */
  updateTrack(updated: Track): void {
    this.project = {
      ...this.project,
      tracks: this.project.tracks.map((t) => (t.id === updated.id ? updated : t)),
    };
  }

  toggleMute(trackId: string): void {
    const t = this.project.tracks.find((x) => x.id === trackId);
    if (t) this.updateTrack({ ...t, muted: !t.muted });
  }

  toggleSolo(trackId: string): void {
    const t = this.project.tracks.find((x) => x.id === trackId);
    if (t) this.updateTrack({ ...t, soloed: !t.soloed });
  }

  setTrackGain(trackId: string, gain: number): void {
    const t = this.project.tracks.find((x) => x.id === trackId);
    if (t) this.updateTrack({ ...t, gain });
  }

  /**
   * Decode an audio file and append it as a new clip on a track (creating a track if none
   * is given). Returns the new clip.
   */
  async addFile(file: File, trackId?: string): Promise<Clip> {
    const arrayBuffer = await file.arrayBuffer();
    // decodeAudioData detaches the ArrayBuffer; slice() hands it a private copy.
    const audio = await this.#engine.context.decodeAudioData(arrayBuffer.slice(0));
    if (audio.length === 0) throw new Error(`"${file.name}" decoded to an empty buffer`);

    const clip = createClip(audio, file.name, 0);
    let target = trackId
      ? this.project.tracks.find((t) => t.id === trackId)
      : undefined;
    if (!target) target = this.addTrack();

    this.updateTrack({ ...target, clips: [...target.clips, clip] });
    return clip;
  }

  // ---- transport ----

  async play(): Promise<void> {
    await this.#transport.play();
  }

  pause(): void {
    this.#transport.pause();
  }

  stop(): void {
    this.#transport.stop();
    this.playhead = 0;
  }

  seek(seconds: number): void {
    this.#transport.seek(seconds);
    this.playhead = seconds;
  }

  setMasterVolume(volume0to100: number): void {
    this.masterVolume = volume0to100;
    this.#engine.setMasterVolume(volume0to100);
  }

  // ---- playhead animation ----

  #startPlayheadLoop(): void {
    const tick = (): void => {
      this.playhead = this.#transport.position;
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  #stopPlayheadLoop(): void {
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.playhead = this.#transport.position;
  }
}
