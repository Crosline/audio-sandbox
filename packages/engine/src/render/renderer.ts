/**
 * Renderer: mixes a Project down through OfflineAudioContext to one or more AudioBuffers.
 *
 * This is the only export code that touches Web Audio. All decisions (window, gains, included
 * tracks, clip scheduling) are made by the pure `resolveRenderPlan`; this class only wires the
 * resolved plan into an offline graph and renders it. It is verified in the app's browser E2E
 * (the node test env has no OfflineAudioContext), while the plan carries full unit coverage.
 *
 * Graph per render: for each track plan, clip sources → trackGain(plan.gain) → destination.
 */
import { buildChain } from '../effects/nodes.js';
import type { Project } from '../model/types.js';
import { resolveRenderPlan, type RenderOptions, type RenderPlan } from './plan.js';

export class Renderer {
  readonly #project: Project;
  readonly #options: RenderOptions;

  constructor(project: Project, options: RenderOptions = {}) {
    this.#project = project;
    this.#options = options;
  }

  /** Render the full mix (all included tracks summed) to one AudioBuffer. */
  renderMix(): Promise<AudioBuffer> {
    return this.#renderPlan(resolveRenderPlan(this.#project, this.#options));
  }

  /** Render a single track in isolation to one AudioBuffer. */
  renderStem(trackId: string): Promise<AudioBuffer> {
    return this.#renderPlan(resolveRenderPlan(this.#project, this.#options, trackId));
  }

  /** Render every included track to its own buffer, keyed by track id. */
  async renderStems(): Promise<Map<string, AudioBuffer>> {
    // Resolve the mix plan to learn which tracks are included, then render each alone.
    const mixPlan = resolveRenderPlan(this.#project, this.#options);
    const entries = await Promise.all(
      mixPlan.tracks.map(async (t): Promise<[string, AudioBuffer]> => {
        const plan = resolveRenderPlan(this.#project, this.#options, t.trackId);
        return [t.trackId, await this.#renderPlan(plan)];
      }),
    );
    return new Map(entries);
  }

  /** Build an OfflineAudioContext from a resolved plan, schedule it, and render. */
  async #renderPlan(plan: RenderPlan): Promise<AudioBuffer> {
    // OfflineAudioContext requires length >= 1; a zero-length window renders a 1-frame
    // (effectively silent) buffer that the caller can ignore or the encoder emits as ~empty.
    const length = Math.max(1, plan.lengthSamples);
    const ctx = new OfflineAudioContext(plan.channels, length, plan.sampleRate);

    for (const track of plan.tracks) {
      const trackGain = ctx.createGain();
      trackGain.gain.value = track.gain;

      // Re-instantiate the pedalboard chain in THIS offline context (nodes can't cross
      // contexts). Empty chains build a passthrough, so this wiring is uniform.
      const chain = buildChain(ctx, track.effects);
      trackGain.connect(chain.input);
      chain.output.connect(ctx.destination);

      for (const clip of track.clips) {
        const source = ctx.createBufferSource();
        source.buffer = clip.buffer;
        source.connect(trackGain);
        source.start(clip.when, clip.offset, clip.duration);
      }
    }

    return ctx.startRendering();
  }
}
