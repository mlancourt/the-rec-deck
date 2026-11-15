// Board sounds, synthesized. Silent unless the shell's sound setting is on.

export type Sfx = 'move' | 'capture' | 'check' | 'coin' | 'warn';

const NOTES: Record<Sfx, [number, number][]> = {
  move: [[196, 0.04]],
  capture: [[147, 0.05], [82, 0.11]],
  check: [[659, 0.06], [880, 0.1]],
  coin: [[988, 0.05], [1319, 0.12]],
  warn: [[311, 0.08], [311, 0.08]],
};

export interface SfxPlayer {
  play(kind: Sfx): void;
  close(): void;
}

export function makeSfx(on: boolean): SfxPlayer {
  let ac: AudioContext | null = null;
  return {
    play(kind) {
      if (!on) return;
      try {
        ac ??= new AudioContext();
        let t = ac.currentTime;
        for (const [freq, dur] of NOTES[kind]) {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = 'square';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.05, t);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          osc.connect(gain).connect(ac.destination);
          osc.start(t);
          osc.stop(t + dur);
          t += dur;
        }
      } catch {
        /* no audio: fine */
      }
    },
    close() {
      void ac?.close().catch(() => undefined);
      ac = null;
    },
  };
}
