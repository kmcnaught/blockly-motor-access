/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Dance Party stage renderer.
 *
 * Replaces the maze canvas with a slideshow stage: large emoji + label card,
 * progress bar that drains over each move, next-up hint below. The user's
 * dance program is executed through js-interpreter against a dance API that
 * records moves into a log; a playback loop then animates the log with real
 * time delays, matching the maze's log-then-replay pattern.
 */

import Interpreter from 'js-interpreter';

/** Base duration for each move, in seconds. Scaled by the speed multiplier at Run time. */
const MOVE_DURATIONS: Record<string, number> = {
  clap: 1.0,
  spin: 2.0,
  jump: 1.0,
  wiggle: 2.0,
  bow: 2.0,
  dance_like_a: 3.0,
  pull_face: 2.0,
  make_noise: 1.5,
  strike_pose: 2.5,
  wave: 2.0,
  step: 1.0,
  // freeze: handled dynamically from the field value.
};

/** Emoji shown on the big card for each move. */
const MOVE_EMOJI: Record<string, string> = {
  clap: '👏',
  spin: '🌀',
  jump: '🦘',
  wiggle: '〰️',
  bow: '🙇',
  freeze: '❄️',
};

/** Emoji for parameterised moves, by sub-value. */
const PARAM_EMOJI: Record<string, Record<string, string>> = {
  dance_like_a: {
    robot: '🤖',
    chicken: '🐔',
    jellyfish: '🪼',
  },
  pull_face: {
    silly: '🤪',
    scary: '😱',
    surprised: '😲',
  },
  make_noise: {
    moo: '🐮',
    beep: '🤖',
    roar: '🦁',
  },
  strike_pose: {
    superhero: '🦸',
    teapot: '🫖',
    statue: '🗿',
  },
  wave: {
    'left hand': '👋',
    'right hand': '👋',
    'both hands': '👋',
  },
  step: {
    forward: '⬆️',
    back: '⬇️',
    sideways: '⬅️',
  },
};

const IDLE_EMOJI = '🎉';
const DONE_EMOJI = '🎊';

/** Speed-toggle positions. */
type Speed = 'slow' | 'normal' | 'fast';

/** Duration multipliers applied at Run time; captured for the whole run. */
const SPEED_MULTIPLIERS: Record<Speed, number> = {
  slow: 1.5,
  normal: 1.0,
  fast: 0.6,
};

/** Natural-language card text for a queued move. */
function moveLabel(cmd: string, param: string | number | null): string {
  switch (cmd) {
    case 'clap': return 'Clap!';
    case 'spin': return 'Spin!';
    case 'jump': return 'Jump!';
    case 'wiggle': return 'Wiggle!';
    case 'bow': return 'Bow!';
    case 'dance_like_a': return `Dance like a ${param}!`;
    case 'pull_face': return `Pull a ${param} face!`;
    case 'make_noise': return `Make a ${param} noise!`;
    case 'strike_pose': return `Strike a ${param} pose!`;
    case 'wave': return `Wave ${param}!`;
    case 'step': return `Step ${param}!`;
    case 'freeze': return `Freeze for ${param} seconds!`;
    default: return cmd;
  }
}

/** Emoji to show for a queued move. */
function moveEmoji(cmd: string, param: string | number | null): string {
  if (cmd === 'freeze') return MOVE_EMOJI.freeze;
  if (param !== null && PARAM_EMOJI[cmd]) {
    const key = String(param);
    return PARAM_EMOJI[cmd][key] || '💃';
  }
  return MOVE_EMOJI[cmd] || '💃';
}

/** Duration in seconds for a queued move. */
function moveDuration(cmd: string, param: string | number | null): number {
  if (cmd === 'freeze') {
    const n = Number(param);
    return Number.isFinite(n) && n > 0 ? n : 1.0;
  }
  return MOVE_DURATIONS[cmd] ?? 1.0;
}

/** One move to be shown on stage. */
interface Move {
  cmd: string;
  param: string | number | null;
}

/**
 * DanceStage owns the stage DOM (card, progress bar, next-up line) and
 * handles running a dance program end to end.
 */
export class DanceStage {
  private host: HTMLElement;
  private stageEl: HTMLElement;
  private cardEmojiEl: HTMLElement;
  private cardLabelEl: HTMLElement;
  private progressBarEl: HTMLElement;
  private nextUpEl: HTMLElement;
  private speedButtons: Record<Speed, HTMLButtonElement>;

  private log: Move[] = [];
  private running = false;
  private cancelled = false;
  private activeTimeout: ReturnType<typeof setTimeout> | null = null;
  private onRunningChange: ((isRunning: boolean) => void) | null = null;
  private onAboutRequest: (() => void) | null = null;
  private onNaturalComplete: (() => void) | null = null;

  /** Selected UI speed; read into currentSpeedMultiplier at Run time. */
  private selectedSpeed: Speed = 'normal';
  /** Captured at Run; applied to every move in this run (no mid-run update). */
  private currentSpeedMultiplier = 1.0;
  /**
   * Caller-supplied getter for the global sound-enabled setting. TTS is
   * skipped when this returns false. Defaults to always-on.
   */
  private isSoundEnabled: () => boolean = () => true;

  constructor(host: HTMLElement) {
    this.host = host;

    const stage = document.createElement('div');
    stage.id = 'danceStage';
    stage.className = 'dance-stage hidden';
    stage.innerHTML = `
      <button type="button" class="dance-about-btn" id="danceAboutBtn" aria-label="About this level">&#9432;</button>
      <div class="dance-card">
        <div class="dance-card-emoji" id="danceCardEmoji">${IDLE_EMOJI}</div>
        <div class="dance-card-label" id="danceCardLabel">Ready!</div>
      </div>
      <div class="dance-progress">
        <div class="dance-progress-bar" id="danceProgressBar"></div>
      </div>
      <div class="dance-next-up" id="danceNextUp"></div>
      <div class="dance-speed-toggle" role="radiogroup" aria-label="Playback speed">
        <button type="button" class="dance-speed-btn" data-speed="slow" role="radio" aria-checked="false">Slow</button>
        <button type="button" class="dance-speed-btn is-selected" data-speed="normal" role="radio" aria-checked="true">Normal</button>
        <button type="button" class="dance-speed-btn" data-speed="fast" role="radio" aria-checked="false">Fast</button>
      </div>
    `;
    host.appendChild(stage);

    this.stageEl = stage;
    this.cardEmojiEl = stage.querySelector('#danceCardEmoji') as HTMLElement;
    this.cardLabelEl = stage.querySelector('#danceCardLabel') as HTMLElement;
    this.progressBarEl = stage.querySelector('#danceProgressBar') as HTMLElement;
    this.nextUpEl = stage.querySelector('#danceNextUp') as HTMLElement;
    this.speedButtons = {
      slow: stage.querySelector('.dance-speed-btn[data-speed="slow"]') as HTMLButtonElement,
      normal: stage.querySelector('.dance-speed-btn[data-speed="normal"]') as HTMLButtonElement,
      fast: stage.querySelector('.dance-speed-btn[data-speed="fast"]') as HTMLButtonElement,
    };
    (Object.keys(this.speedButtons) as Speed[]).forEach((speed) => {
      this.speedButtons[speed].addEventListener('click', () => this.setSpeed(speed));
    });

    const aboutBtn = stage.querySelector('#danceAboutBtn') as HTMLButtonElement;
    aboutBtn.addEventListener('click', () => this.onAboutRequest?.());
  }

  /**
   * Install a callback that reports the global sound-enabled state. When it
   * returns false, TTS narration is skipped. Call from index.ts after wiring
   * the mute toggle.
   */
  public setSoundEnabledGetter(getter: () => boolean): void {
    this.isSoundEnabled = getter;
  }

  /** Update the selected speed and reflect it in the button UI. */
  private setSpeed(speed: Speed): void {
    this.selectedSpeed = speed;
    (Object.keys(this.speedButtons) as Speed[]).forEach((s) => {
      const btn = this.speedButtons[s];
      const selected = s === speed;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-checked', String(selected));
    });
  }

  /** Register a callback that fires when run start/stop transitions happen. */
  public onRunningChanged(cb: (isRunning: boolean) => void): void {
    this.onRunningChange = cb;
  }

  /** Register a callback that fires when the About button is pressed. */
  public onAbout(cb: () => void): void {
    this.onAboutRequest = cb;
  }

  /**
   * Register a callback that fires once when a program finishes naturally
   * (reaches the end of the queue without being stopped). Not invoked on stop().
   */
  public onCompleted(cb: () => void): void {
    this.onNaturalComplete = cb;
  }

  /** Show the stage, hide the maze canvas. */
  public show(): void {
    this.stageEl.classList.remove('hidden');
    this.setIdle();
  }

  /** Hide the stage; caller is responsible for showing the canvas again. */
  public hide(): void {
    this.stop();
    this.stageEl.classList.add('hidden');
  }

  public isRunning(): boolean {
    return this.running;
  }

  /** Reset the card to "Ready!" idle state. */
  private setIdle(): void {
    this.cardEmojiEl.textContent = IDLE_EMOJI;
    this.cardLabelEl.textContent = 'Ready!';
    this.resetProgressBar();
    this.nextUpEl.textContent = '';
  }

  private resetProgressBar(): void {
    // Snap back to 100% with no transition, then the next move's drain is a
    // clean left-to-right animation.
    this.progressBarEl.style.transition = 'none';
    this.progressBarEl.style.width = '100%';
    // Force reflow so the next transition doesn't batch with this reset.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    this.progressBarEl.offsetWidth;
  }

  /**
   * Run a user program: build the interpreter, record every dance call into
   * log, then animate the log with real-time delays.
   */
  public run(code: string): void {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    this.log = [];
    // Snapshot the UI speed for this entire run — mid-run toggle changes
    // must not affect queued moves.
    this.currentSpeedMultiplier = SPEED_MULTIPLIERS[this.selectedSpeed];

    try {
      const interpreter = new Interpreter(
        code,
        (interp: any, globalObj: any) => this.initInterpreter(interp, globalObj)
      );
      // 10,000 ticks matches the maze limit.
      let ticks = 10000;
      while (interpreter.step()) {
        if (ticks-- === 0) {
          console.warn('Dance program timed out — truncating.');
          break;
        }
      }
    } catch (e) {
      console.error('Error running dance program:', e);
    }

    if (this.log.length === 0) {
      // Nothing to perform — stay idle without a brief Run/Stop flicker.
      this.running = false;
      return;
    }

    if (this.onRunningChange) this.onRunningChange(true);
    this.playback();
  }

  /** Halt mid-run and return to idle. */
  public stop(): void {
    this.cancelled = true;
    this.running = false;
    if (this.activeTimeout !== null) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    }
    this.log = [];
    this.cancelSpeech();
    this.setIdle();
    if (this.onRunningChange) this.onRunningChange(false);
  }

  /**
   * Speak a line via Web Speech API. Cancels any in-flight utterance first
   * so rapid card swaps don't queue a backlog. Silent no-op when the API is
   * unavailable or the global sound setting is muted.
   */
  private speak(text: string): void {
    if (typeof window === 'undefined') return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (!this.isSoundEnabled()) return;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    // Default system voice, default rate/pitch — cross-browser consistency
    // matters more than per-move variation here.
    synth.speak(utter);
  }

  /** Halt any in-flight utterance without emitting new speech. */
  private cancelSpeech(): void {
    if (typeof window === 'undefined') return;
    const synth = window.speechSynthesis;
    if (synth) synth.cancel();
  }

  /**
   * Register all 12 dance functions into the interpreter's global scope.
   * Each one just appends to this.log — actual animation happens after
   * stepping completes.
   */
  private initInterpreter(interpreter: any, globalObj: any): void {
    const pushMove = (cmd: string, param: string | number | null = null) => {
      this.log.push({cmd, param});
    };

    const register = (name: string, fn: Function) => {
      interpreter.setProperty(
        globalObj,
        name,
        interpreter.createNativeFunction(fn, false)
      );
    };

    register('clap', () => pushMove('clap'));
    register('spin', () => pushMove('spin'));
    register('jump', () => pushMove('jump'));
    register('wiggle', () => pushMove('wiggle'));
    register('bow', () => pushMove('bow'));
    register('danceLike', (which: string) => pushMove('dance_like_a', which));
    register('pullFace', (which: string) => pushMove('pull_face', which));
    register('makeNoise', (which: string) => pushMove('make_noise', which));
    register('strikePose', (which: string) => pushMove('strike_pose', which));
    register('wave', (which: string) => pushMove('wave', which));
    register('step', (which: string) => pushMove('step', which));
    register('freeze', (seconds: number) => pushMove('freeze', seconds));
  }

  /** Play back the first queued move; recurses until log empty or cancelled. */
  private playback(): void {
    if (this.cancelled) return;

    const move = this.log.shift();
    if (!move) {
      // End of program. Leave the progress bar drained — reads as "done".
      this.cardEmojiEl.textContent = DONE_EMOJI;
      const doneText = "That's all!";
      this.cardLabelEl.textContent = doneText;
      this.nextUpEl.textContent = '';
      this.speak(doneText);
      this.running = false;
      if (this.onRunningChange) this.onRunningChange(false);
      // Celebration fires only on natural completion — stop() short-circuits
      // playback before reaching this branch.
      this.onNaturalComplete?.();
      return;
    }

    // Render the card for this move.
    this.cardEmojiEl.textContent = moveEmoji(move.cmd, move.param);
    const label = moveLabel(move.cmd, move.param);
    this.cardLabelEl.textContent = label;
    this.speak(label);

    // Drive the progress bar. Speed multiplier scales freezes too — a Fast
    // run shortens held poses by design.
    const seconds = moveDuration(move.cmd, move.param) * this.currentSpeedMultiplier;
    this.resetProgressBar();
    // Next frame: install the transition and drain to 0.
    requestAnimationFrame(() => {
      if (this.cancelled) return;
      this.progressBarEl.style.transition = `width ${seconds}s linear`;
      this.progressBarEl.style.width = '0%';
    });

    // Next-up hint — reuse the imperative label for visual consistency;
    // CSS sizes it down.
    const upcoming = this.log[0];
    this.nextUpEl.textContent = upcoming
      ? `Next up: ${moveLabel(upcoming.cmd, upcoming.param)}`
      : 'end of performance';

    // Queue the next move after this one's duration.
    this.activeTimeout = setTimeout(() => {
      this.activeTimeout = null;
      this.playback();
    }, seconds * 1000);
  }
}
