<script lang="ts">
  // SIGNAL mark — four equalizer bars in a glowing badge. The bars animate
  // while the transport is playing, so the brand itself is a level meter.
  let { playing = false, size = 30 }: { playing?: boolean; size?: number } = $props();

  const BARS = [
    { h: 38, delay: 0.0, dur: 0.9 },
    { h: 78, delay: 0.25, dur: 0.7 },
    { h: 55, delay: 0.1, dur: 1.1 },
    { h: 68, delay: 0.4, dur: 0.8 },
  ];
</script>

<div class="badge" class:playing style="width:{size}px;height:{size}px" aria-hidden="true">
  {#each BARS as bar}
    <span
      class="bar"
      style="height:{bar.h}%;animation-delay:{bar.delay}s;animation-duration:{bar.dur}s"
    ></span>
  {/each}
</div>

<style>
  .badge {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border-radius: 9px;
    background: linear-gradient(145deg, #ff8a3d, #ff5c2e 55%, #e8431f);
    box-shadow:
      0 0 0 1px rgba(255, 138, 61, 0.35),
      0 2px 10px rgba(255, 92, 46, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.35);
  }
  .bar {
    width: 3px;
    border-radius: 2px;
    background: rgba(10, 8, 6, 0.85);
    transform-origin: center;
  }
  .playing .bar {
    animation-name: eq-bar;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }
</style>
