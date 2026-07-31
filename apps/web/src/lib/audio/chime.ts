/**
 * The §3.3 notification cue.
 *
 * Synthesised with WebAudio rather than shipped as an audio file. Three reasons, in order of
 * how much they matter:
 *
 *   1. An `<audio src>` needs a network fetch, and the moment the chime is needed is exactly the
 *      moment we may be offline (ADR 0001 decision 3 — no service worker, so nothing is cached).
 *      A sound that only plays when you have signal is not a notification.
 *   2. No asset, no licence question, no 40KB in the bundle.
 *   3. A two-note interval is genuinely nicer than most stock notification sounds, and "subtle"
 *      is what §3.3 asks for.
 *
 * AUTOPLAY: browsers refuse to start an AudioContext that was not created in response to a user
 * gesture, and a context created too early is born `suspended`. So the context is built lazily
 * on first play — which always follows a click on the start button — and `resume()` is called
 * defensively in case it was suspended anyway.
 */

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }

  return context;
}

/** One note. A sine with an exponential decay — no click on attack, no buzz on release. */
function tone(ctx: AudioContext, frequency: number, startAt: number, seconds: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = frequency;

  /*
   * The envelope is what stops this sounding like an alarm clock. A raw gain change produces an
   * audible click, because the waveform jumps discontinuously — ramping over 10ms removes it.
   * `exponentialRampToValueAtTime` cannot reach zero, hence the small floor.
   */
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + seconds);

  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + seconds + 0.05);
}

/**
 * Play the end-of-phase cue.
 *
 * Rising for a break beginning (work is done), falling for focus beginning (settle in). The
 * direction carries the meaning, so it is recognisable without looking at the screen — which is
 * the point of an audio cue in a mode whose purpose is that you are not looking at the screen.
 */
export function playChime(kind: "focus-ended" | "break-ended" = "focus-ended"): void {
  const ctx = getContext();
  if (!ctx) return;

  // A context created outside a gesture starts suspended; this is a no-op when it is not.
  void ctx.resume().catch(() => undefined);

  const at = ctx.currentTime + 0.02;
  const [a, b] = kind === "focus-ended" ? [660, 880] : [880, 660];

  tone(ctx, a, at, 0.18);
  tone(ctx, b, at + 0.16, 0.28);
}

/** Release the audio hardware. Called when the app unmounts; harmless if never invoked. */
export function closeAudio(): void {
  void context?.close().catch(() => undefined);
  context = null;
}
