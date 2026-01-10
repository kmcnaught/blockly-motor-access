/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Immediate Mode Controller for Maze game.
 * Provides direct command execution via buttons and keyboard for early levels,
 * teaching users what each command does before introducing programming concepts.
 */

import {MazeGame} from './maze';
import {msg} from './messages';

/**
 * Maximum distance (pixels) a touch can move and still count as a tap.
 * Set generously for young children who often drag slightly when tapping.
 */
const TOUCH_SLOP = 30;

/**
 * Add forgiving touch handling to a button element.
 * Tolerates small finger movements during a tap, which is common with young
 * children who haven't developed fine motor control.
 *
 * @param btn The button element to add touch handling to.
 * @param action The action to perform when a valid tap is detected.
 * @param touchStarts Map to track touch start positions (shared across buttons).
 */
function addForgivingTouchHandler(
  btn: HTMLElement,
  action: () => void,
  touchStarts: Map<HTMLElement, {x: number; y: number}>,
): void {
  btn.addEventListener(
    'touchstart',
    (e) => {
      const touch = e.touches[0];
      touchStarts.set(btn, {x: touch.clientX, y: touch.clientY});
    },
    {passive: true},
  );

  btn.addEventListener('touchend', (e) => {
    const touch = e.changedTouches[0];
    const start = touchStarts.get(btn);
    touchStarts.delete(btn);

    if (!start) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= TOUCH_SLOP) {
      e.preventDefault(); // Prevent click from also firing
      action();
    }
  });

  btn.addEventListener('touchcancel', () => {
    touchStarts.delete(btn);
  });
}

/**
 * Controller for immediate execution mode UI.
 * Renders command buttons and handles keyboard shortcuts for direct control.
 */
export class ImmediateModeController {
  private container: HTMLElement;
  private mazeGame: MazeGame;
  private enabled = false;
  private executing = false;
  private boundKeyHandler: (e: KeyboardEvent) => void;
  private onLevelCompleteCallback: ((success: boolean) => void) | null = null;

  // Instruction counting for Grid mode
  private instructionCount = 0;
  private onInstructionCountChangeCallback: ((count: number) => void) | null = null;

  // Button elements
  private forwardBtn: HTMLButtonElement | null = null;
  private turnLeftBtn: HTMLButtonElement | null = null;
  private turnRightBtn: HTMLButtonElement | null = null;

  // Fall overlay elements
  private fallOverlay: HTMLElement | null = null;
  private fallOverlayText: HTMLElement | null = null;

  // Per-button touch tracking to avoid confusion when touching multiple buttons
  private touchStarts: Map<HTMLElement, {x: number; y: number}> = new Map();

  constructor(containerId: string, mazeGame: MazeGame) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element ${containerId} not found`);
    }
    this.container = container;
    this.mazeGame = mazeGame;

    // Cache button references
    this.forwardBtn = document.getElementById(
      'cmdForward',
    ) as HTMLButtonElement;
    this.turnLeftBtn = document.getElementById(
      'cmdTurnLeft',
    ) as HTMLButtonElement;
    this.turnRightBtn = document.getElementById(
      'cmdTurnRight',
    ) as HTMLButtonElement;

    // Cache fall overlay references
    this.fallOverlay = document.getElementById('fallOverlay');
    this.fallOverlayText = document.getElementById('fallOverlayText');

    // Bind keyboard handler
    this.boundKeyHandler = this.handleKeyDown.bind(this);

    // Set up button click handlers
    this.setupButtonHandlers();
  }

  /**
   * Set up click and touch handlers for command buttons.
   */
  private setupButtonHandlers(): void {
    // Click handlers (mouse and keyboard)
    this.forwardBtn?.addEventListener('click', () => this.doMoveForward());
    this.turnLeftBtn?.addEventListener('click', () => this.doTurn('left'));
    this.turnRightBtn?.addEventListener('click', () => this.doTurn('right'));

    // Forgiving touch handlers for young children
    if (this.forwardBtn) {
      addForgivingTouchHandler(
        this.forwardBtn,
        () => this.doMoveForward(),
        this.touchStarts,
      );
    }
    if (this.turnLeftBtn) {
      addForgivingTouchHandler(
        this.turnLeftBtn,
        () => this.doTurn('left'),
        this.touchStarts,
      );
    }
    if (this.turnRightBtn) {
      addForgivingTouchHandler(
        this.turnRightBtn,
        () => this.doTurn('right'),
        this.touchStarts,
      );
    }
  }

  /**
   * Enable immediate mode (show buttons, bind keys).
   */
  public enable(): void {
    if (this.enabled) return;

    this.enabled = true;
    this.container.classList.remove('hidden');

    // Bind keyboard events
    document.addEventListener('keydown', this.boundKeyHandler);

    // Update button labels with localized text
    this.updateLabels();
  }

  /**
   * Disable immediate mode (hide buttons, unbind keys).
   */
  public disable(): void {
    if (!this.enabled) return;

    this.enabled = false;
    this.container.classList.add('hidden');

    // Unbind keyboard events
    document.removeEventListener('keydown', this.boundKeyHandler);
  }

  /**
   * Check if immediate mode is enabled.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Register completion callback for when level is completed.
   */
  public onLevelComplete(callback: (success: boolean) => void): void {
    this.onLevelCompleteCallback = callback;
  }

  /**
   * Register callback for when instruction count changes (for Grid mode).
   */
  public onInstructionCountChange(callback: (count: number) => void): void {
    this.onInstructionCountChangeCallback = callback;
  }

  /**
   * Get the current instruction count.
   */
  public getInstructionCount(): number {
    return this.instructionCount;
  }

  /**
   * Reset the instruction count to zero.
   */
  public resetInstructionCount(): void {
    this.instructionCount = 0;
    this.onInstructionCountChangeCallback?.(this.instructionCount);
  }

  /**
   * Update the MazeGame reference (called when level changes).
   */
  public setMazeGame(mazeGame: MazeGame): void {
    this.mazeGame = mazeGame;
  }

  /**
   * Update button labels with localized text.
   */
  public updateLabels(): void {
    const hintEl = document.getElementById('immediateHint');
    if (hintEl) {
      hintEl.textContent = msg('MAZE_PRACTICE_HINT');
    }

    // Update goal marker image to match current skin
    const markerEl = document.getElementById('immediateMarker') as HTMLImageElement;
    if (markerEl) {
      markerEl.src = this.mazeGame.getMarkerPath();
    }

    // Update button labels
    const forwardLabel = this.forwardBtn?.querySelector('.cmd-label');
    if (forwardLabel) {
      forwardLabel.textContent = msg('MAZE_PRACTICE_FORWARD');
    }

    const leftLabel = this.turnLeftBtn?.querySelector('.cmd-label');
    if (leftLabel) {
      leftLabel.textContent = msg('MAZE_PRACTICE_TURN_LEFT');
    }

    const rightLabel = this.turnRightBtn?.querySelector('.cmd-label');
    if (rightLabel) {
      rightLabel.textContent = msg('MAZE_PRACTICE_TURN_RIGHT');
    }
  }

  /**
   * Handle keyboard input for immediate mode.
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;

    // Ignore if already executing a command
    if (this.executing) return;

    // Ignore if user is typing in an input field
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        e.preventDefault();
        this.doMoveForward();
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        this.doTurn('left');
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        this.doTurn('right');
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        this.resetInstructionCount();
        this.mazeGame.reset();
        break;
    }
  }

  /**
   * Execute forward command with UI feedback.
   */
  private async doMoveForward(): Promise<void> {
    if (this.executing) return;

    this.setExecuting(true, this.forwardBtn);

    try {
      const result = await this.mazeGame.executeImmediateMove();

      // Count successful moves (not wall collisions)
      if (result === 'success' || result === 'continue') {
        this.instructionCount++;
        this.onInstructionCountChangeCallback?.(this.instructionCount);
      }

      if (result === 'success') {
        // Level completed!
        this.onLevelCompleteCallback?.(true);
      } else if (result === 'fell') {
        // Character fell off - show overlay, wait, then auto-reset
        this.showFallOverlay();
        await this.delay(2000);
        this.hideFallOverlay();
        this.resetInstructionCount();
        this.mazeGame.reset();
      }
      // 'continue' and 'wall' just let the player keep trying
    } finally {
      this.setExecuting(false, this.forwardBtn);
    }
  }

  /**
   * Execute turn command with UI feedback.
   */
  private async doTurn(direction: 'left' | 'right'): Promise<void> {
    if (this.executing) return;

    const btn = direction === 'left' ? this.turnLeftBtn : this.turnRightBtn;
    this.setExecuting(true, btn);

    try {
      await this.mazeGame.executeImmediateTurn(direction);

      // Count turn as an instruction
      this.instructionCount++;
      this.onInstructionCountChangeCallback?.(this.instructionCount);
    } finally {
      this.setExecuting(false, btn);
    }
  }

  /**
   * Set the executing state and update button style.
   */
  private setExecuting(
    executing: boolean,
    btn: HTMLButtonElement | null,
  ): void {
    this.executing = executing;

    if (btn) {
      if (executing) {
        btn.classList.add('executing');
      } else {
        btn.classList.remove('executing');
      }
    }
  }

  /**
   * Show the fall overlay with "Oh no!" message.
   */
  private showFallOverlay(): void {
    if (this.fallOverlayText) {
      this.fallOverlayText.textContent = msg('MAZE_PRACTICE_FELL');
    }
    this.fallOverlay?.classList.add('active');
  }

  /**
   * Hide the fall overlay.
   */
  private hideFallOverlay(): void {
    this.fallOverlay?.classList.remove('active');
  }

  /**
   * Promise-based delay helper.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
