// Four tiny chiptune cues, synthesized with WebAudio so there are no audio files to ship.
// Silent unless the user turns sound on.

import { prefs } from './prefs';

export type Cue = 'start' | 'win' | 'loss' | 'back';

const NOTES: Record<Cue, [number, number][]> = {
  start: [[523, 0.07], [784, 0.1]],
  win: [[523, 0.07], [659, 0.07], [784, 0.07], [1047, 0.14]],
  loss: [[392, 0.1], [311, 0.18]],
  back: [[440, 0.05]],
};

let ctx: AudioContext | null = null;

export function play(cue: Cue): void {
  if (!prefs.sound) return;
  try {
    ctx ??= new AudioContext();
    let t = ctx.currentTime;
    for (const [freq, dur] of NOTES[cue]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur;
    }
  } catch {
    /* no audio: fine */
  }
}
