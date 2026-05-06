/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Panel Resizer for Maze game.
 * Provides a draggable divider between Blockly workspace and maze visualization,
 * allowing users to adjust panel widths with constraint enforcement and persistence.
 */

import * as Blockly from 'blockly/core';

/**
 * LocalStorage keys for persisting panel widths.
 */
const BLOCKLY_WIDTH_KEY = 'mazeBlocklyPanelWidth';
const GAME_WIDTH_KEY = 'mazeGamePanelWidth';

/**
 * Fixed layout dimensions (matches existing CSS).
 */
export const RESIZER_WIDTH = 12;
export const MIN_BLOCKLY_FLYOUT_MULTIPLIER = 2.2;
export const MIN_GAME_FLYOUT_MULTIPLIER = 1.5;

/**
 * Controller for panel resizing functionality.
 * Handles drag operations, constraint enforcement, and persistence.
 */
export class PanelResizer {
  private workspace: Blockly.WorkspaceSvg;
  private container: HTMLElement;
  private blocklyContainer: HTMLElement;
  private gameContainer: HTMLElement;
  private resizerElement: HTMLElement;

  private isGridCodingMode: boolean;

  private isResizing = false;
  private startX = 0;
  private startBlocklyWidth = 0;
  private startGameWidth = 0;

  private boundStartResize: (e: MouseEvent | TouchEvent) => void;
  private boundHandleResize: (e: MouseEvent | TouchEvent) => void;
  private boundStopResize: () => void;
  private boundHandleKeyboard: (e: KeyboardEvent) => void;

  private onResizeCallback?: () => void;
  private resizeObserver?: ResizeObserver;

  /**
   * Create a new PanelResizer.
   * @param workspace The Blockly workspace instance
   * @param container The main container element (.container)
   * @param blocklyContainer The Blockly panel element (.blockly-container)
   * @param gameContainer The game panel element (.game-container)
   * @param resizerElement The resizer element (#panelResizer)
   * @param isGridCodingMode Whether grid coding mode is active
   * @param onResize Optional callback called when panels are resized
   */
  constructor(
    workspace: Blockly.WorkspaceSvg,
    container: HTMLElement,
    blocklyContainer: HTMLElement,
    gameContainer: HTMLElement,
    resizerElement: HTMLElement,
    isGridCodingMode: boolean = false,
    onResize?: () => void
  ) {
    this.workspace = workspace;
    this.container = container;
    this.blocklyContainer = blocklyContainer;
    this.gameContainer = gameContainer;
    this.resizerElement = resizerElement;
    this.isGridCodingMode = isGridCodingMode;
    this.onResizeCallback = onResize;

    // Bind event handlers
    this.boundStartResize = this.startResize.bind(this);
    this.boundHandleResize = this.handleResize.bind(this);
    this.boundStopResize = this.stopResize.bind(this);
    this.boundHandleKeyboard = this.handleKeyboard.bind(this);

    // Set up ResizeObserver to detect when game container actually resizes.
    // No rAF debounce here — ResizeObserver already fires asynchronously at the
    // end of the frame, so an extra rAF would push the maze redraw 2 frames late.
    if (this.onResizeCallback) {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.isResizing) {
          this.onResizeCallback?.();
        }
      });
      this.resizeObserver.observe(this.gameContainer);
    }

    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Attach all event listeners.
   */
  private attachEventListeners(): void {
    // Mouse/touch drag
    this.resizerElement.addEventListener('mousedown', this.boundStartResize);
    this.resizerElement.addEventListener('touchstart', this.boundStartResize, { passive: false });

    // Keyboard control
    this.resizerElement.addEventListener('keydown', this.boundHandleKeyboard);
  }

  /**
   * Remove all event listeners.
   */
  public destroy(): void {
    this.resizerElement.removeEventListener('mousedown', this.boundStartResize);
    this.resizerElement.removeEventListener('touchstart', this.boundStartResize);
    this.resizerElement.removeEventListener('keydown', this.boundHandleKeyboard);

    // Disconnect ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Clean up active resize
    if (this.isResizing) {
      this.stopResize();
    }
  }

  /**
   * Get minimum Blockly width based on toolbox constraints.
   */
  private getMinBlocklyWidth(): number {
    if (this.isGridCodingMode) {
      return 150; // No toolbox visible; allow narrower workspace
    }

    const flyout = this.workspace.getFlyout();
    if (!flyout) return 280;

    const flyoutWidth = flyout.getWidth();
    // Need toolbox + space for blocks = 2.2x toolbox width
    return Math.max(280, Math.ceil(flyoutWidth * MIN_BLOCKLY_FLYOUT_MULTIPLIER));
  }

  /**
   * Get minimum game container width based on flyout width.
   */
  private getMinGameWidth(): number {
    const flyout = this.workspace.getFlyout();
    const flyoutWidth = flyout ? flyout.getWidth() : 120;
    // Maze can be narrower than blockly — 1.5× flyout is enough
    return Math.max(150, Math.ceil(flyoutWidth * MIN_GAME_FLYOUT_MULTIPLIER));
  }

  /**
   * Calculate maximum widths based on available space.
   */
  private getMaxWidths(containerWidth: number): { maxBlocklyWidth: number; maxGameWidth: number } {
    const minBlocklyWidth = this.getMinBlocklyWidth();
    const minGameWidth = this.getMinGameWidth();
    const availableWidth = containerWidth - RESIZER_WIDTH;

    return {
      maxBlocklyWidth: availableWidth - minGameWidth,
      maxGameWidth: availableWidth - minBlocklyWidth
    };
  }

  /**
   * Start resize operation.
   */
  private startResize(e: MouseEvent | TouchEvent): void {
    this.isResizing = true;
    document.body.classList.add('resizing');

    this.startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    this.startBlocklyWidth = this.blocklyContainer.offsetWidth;
    this.startGameWidth = this.gameContainer.offsetWidth;

    document.addEventListener('mousemove', this.boundHandleResize);
    document.addEventListener('mouseup', this.boundStopResize);
    document.addEventListener('touchmove', this.boundHandleResize, { passive: false });
    document.addEventListener('touchend', this.boundStopResize);

    e.preventDefault();
  }

  /**
   * Handle resize drag.
   */
  private handleResize(e: MouseEvent | TouchEvent): void {
    if (!this.isResizing) return;

    const currentX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const deltaX = currentX - this.startX;

    // Get constraints
    const containerWidth = this.container.offsetWidth;
    const { maxBlocklyWidth, maxGameWidth } = this.getMaxWidths(containerWidth);
    const minBlocklyWidth = this.getMinBlocklyWidth();
    const minGameWidth = this.getMinGameWidth();

    // Calculate new widths
    let newBlocklyWidth = this.startBlocklyWidth + deltaX;
    let newGameWidth = this.startGameWidth - deltaX;

    // Apply constraints
    newBlocklyWidth = Math.max(minBlocklyWidth, Math.min(maxBlocklyWidth, newBlocklyWidth));
    newGameWidth = Math.max(minGameWidth, Math.min(maxGameWidth, newGameWidth));

    // Ensure widths fit container exactly
    const availableWidth = containerWidth - RESIZER_WIDTH;
    const totalWidths = newBlocklyWidth + newGameWidth;

    if (totalWidths !== availableWidth) {
      if (newBlocklyWidth === minBlocklyWidth) {
        newGameWidth = availableWidth - minBlocklyWidth;
      } else if (newGameWidth === minGameWidth) {
        newBlocklyWidth = availableWidth - minGameWidth;
      } else {
        // Scale proportionally
        const scale = availableWidth / totalWidths;
        newBlocklyWidth = Math.floor(newBlocklyWidth * scale);
        newGameWidth = availableWidth - newBlocklyWidth;
      }
    }

    this.applyWidths(newBlocklyWidth, newGameWidth);
    // Call svgResize directly (not via scheduleLayout) for immediate visual
    // feedback on every mousemove tick during the drag.
    Blockly.svgResize(this.workspace);

    e.preventDefault();
  }

  /**
   * Stop resize and save preferences.
   */
  private stopResize(): void {
    if (!this.isResizing) return;

    this.isResizing = false;
    document.body.classList.remove('resizing');

    document.removeEventListener('mousemove', this.boundHandleResize);
    document.removeEventListener('mouseup', this.boundStopResize);
    document.removeEventListener('touchmove', this.boundHandleResize);
    document.removeEventListener('touchend', this.boundStopResize);

    // Save to localStorage
    this.saveWidths();

    // Final resize - ensure Blockly is properly sized
    Blockly.svgResize(this.workspace);

    // ResizeObserver will automatically trigger maze redraw when container size settles
  }

  /**
   * Handle keyboard resize (Arrow keys).
   */
  private handleKeyboard(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

    e.preventDefault();

    const step = e.shiftKey ? 50 : 20; // Shift for bigger steps
    const delta = e.key === 'ArrowRight' ? step : -step;

    const containerWidth = this.container.offsetWidth;
    const { maxBlocklyWidth } = this.getMaxWidths(containerWidth);
    const minBlocklyWidth = this.getMinBlocklyWidth();

    const currentWidth = this.blocklyContainer.offsetWidth;
    let newBlocklyWidth = currentWidth + delta;
    newBlocklyWidth = Math.max(minBlocklyWidth, Math.min(maxBlocklyWidth, newBlocklyWidth));

    const availableWidth = containerWidth - RESIZER_WIDTH;
    const newGameWidth = availableWidth - newBlocklyWidth;

    this.applyWidths(newBlocklyWidth, newGameWidth);
    // Same as handleResize: call directly for responsive key-repeat feedback.
    Blockly.svgResize(this.workspace);
    this.saveWidths();
  }

  /**
   * Handle window resize - re-constrain panels.
   */
  private handleWindowResize(): void {
    if (this.isResizing) return;

    // Only adjust widths when the user has explicitly set them via drag/keyboard.
    // On first load, restoreSavedWidths() always sets custom widths, so this
    // early-return doesn't create a gap — it simply skips the flex-layout phase
    // where the browser is still responsible for sizing.
    const hasCustomWidths = this.blocklyContainer.style.width && this.gameContainer.style.width;
    if (!hasCustomWidths) return;

    const containerWidth = this.container.offsetWidth;
    if (containerWidth <= 0) return;

    const availableWidth = containerWidth - RESIZER_WIDTH;

    const minBlocklyWidth = this.getMinBlocklyWidth();
    const minGameWidth = this.getMinGameWidth();

    // If the viewport is too narrow to honour both minimums, do nothing —
    // computeFitZoom / enforceFitZoom will reduce the page zoom so there is
    // enough virtual space.
    if (availableWidth < minBlocklyWidth + minGameWidth) return;

    const currentBlocklyWidth = this.blocklyContainer.offsetWidth;
    const currentGameWidth = this.gameContainer.offsetWidth;
    const currentTotal = currentBlocklyWidth + currentGameWidth;

    // If panels exceed available space, scale proportionally
    if (currentTotal > availableWidth) {
      const ratio = availableWidth / currentTotal;
      let newBlocklyWidth = Math.round(currentBlocklyWidth * ratio);
      let newGameWidth = availableWidth - newBlocklyWidth;

      // Respect minimums (availableWidth >= both mins so these can't go negative)
      if (newBlocklyWidth < minBlocklyWidth) {
        newBlocklyWidth = minBlocklyWidth;
        newGameWidth = availableWidth - minBlocklyWidth;
      } else if (newGameWidth < minGameWidth) {
        newGameWidth = minGameWidth;
        newBlocklyWidth = availableWidth - minGameWidth;
      }

      this.applyWidths(newBlocklyWidth, newGameWidth);
    } else if (currentTotal < availableWidth - 10) {
      // Distribute extra space proportionally (symmetric with shrink path)
      const extraSpace = availableWidth - currentTotal;
      const blocklyRatio = currentBlocklyWidth / currentTotal;
      let newBlocklyWidth = Math.round(currentBlocklyWidth + extraSpace * blocklyRatio);
      let newGameWidth = availableWidth - newBlocklyWidth;
      const minB = this.getMinBlocklyWidth();
      const minG = this.getMinGameWidth();
      if (newBlocklyWidth < minB) {
        newBlocklyWidth = minB;
        newGameWidth = availableWidth - minB;
      } else if (newGameWidth < minG) {
        newGameWidth = minG;
        newBlocklyWidth = availableWidth - minG;
      }
      this.applyWidths(newBlocklyWidth, newGameWidth);
    }
  }

  /**
   * Apply panel widths (override flex layout).
   * Caller is responsible for triggering Blockly.svgResize after this.
   */
  private applyWidths(blocklyWidth: number, gameWidth: number): void {
    // Guard writes to avoid spurious ResizeObserver notifications when sizes haven't changed.
    const bw = `${blocklyWidth}px`;
    const gw = `${gameWidth}px`;
    this.blocklyContainer.style.flex = 'none';
    if (this.blocklyContainer.style.width !== bw) this.blocklyContainer.style.width = bw;
    this.gameContainer.style.flex = 'none';
    if (this.gameContainer.style.width !== gw) this.gameContainer.style.width = gw;
  }

  /**
   * Reset panels to default flex layout.
   */
  public resetToFlexLayout(): void {
    this.blocklyContainer.style.flex = '';
    this.blocklyContainer.style.width = '';
    this.gameContainer.style.flex = '';
    this.gameContainer.style.width = '';

    Blockly.svgResize(this.workspace);
  }

  /**
   * Apply a default 50/50 width split, clamped to min constraints.
   * Called when no saved widths exist so the game panel isn't collapsed.
   */
  private applyDefaultWidths(): void {
    const containerWidth = this.container.offsetWidth;
    if (containerWidth === 0) return;

    const availableWidth = containerWidth - RESIZER_WIDTH;
    const minBlocklyWidth = this.getMinBlocklyWidth();
    const minGameWidth = this.getMinGameWidth();

    // Start with 50/50 split then enforce minimums
    let gameWidth = Math.round(availableWidth * 0.5);
    let blocklyWidth = availableWidth - gameWidth;

    if (blocklyWidth < minBlocklyWidth) {
      blocklyWidth = minBlocklyWidth;
      gameWidth = availableWidth - blocklyWidth;
    }
    if (gameWidth < minGameWidth) {
      gameWidth = minGameWidth;
      blocklyWidth = availableWidth - gameWidth;
    }

    this.applyWidths(blocklyWidth, gameWidth);
  }

  /**
   * Restore saved widths from localStorage, or apply defaults if none are saved.
   */
  public restoreSavedWidths(onComplete?: () => void): void {
    try {
      const savedBlocklyWidth = localStorage.getItem(BLOCKLY_WIDTH_KEY);
      const savedGameWidth = localStorage.getItem(GAME_WIDTH_KEY);

      let applied = false;

      if (savedBlocklyWidth && savedGameWidth) {
        const blocklyWidth = parseInt(savedBlocklyWidth, 10);
        const gameWidth = parseInt(savedGameWidth, 10);

        if (!isNaN(blocklyWidth) && !isNaN(gameWidth)) {
          // Validate against current constraints
          const containerWidth = this.container.offsetWidth;
          const availableWidth = containerWidth - RESIZER_WIDTH;

          const minBlocklyWidth = this.getMinBlocklyWidth();
          const minGameWidth = this.getMinGameWidth();
          const { maxBlocklyWidth, maxGameWidth } = this.getMaxWidths(containerWidth);

          if (blocklyWidth >= minBlocklyWidth && blocklyWidth <= maxBlocklyWidth &&
              gameWidth >= minGameWidth && gameWidth <= maxGameWidth &&
              blocklyWidth + gameWidth <= availableWidth + 10) { // 10px tolerance
            this.applyWidths(blocklyWidth, gameWidth);
            applied = true;
          }
        }
      }

      if (!applied) {
        this.applyDefaultWidths();
      }
    } catch (err) {
      console.warn('Failed to restore panel widths:', err);
      this.applyDefaultWidths();
    }

    // Call completion callback after browser flushes style mutations
    if (onComplete) {
      requestAnimationFrame(() => onComplete());
    }
  }

  /**
   * Re-run window resize width computation.
   * Call after a page-zoom change so panels fill the updated virtual container.
   */
  public recomputeWidths(): void {
    this.handleWindowResize();
  }

  /**
   * Save current widths to localStorage.
   */
  private saveWidths(): void {
    try {
      localStorage.setItem(BLOCKLY_WIDTH_KEY, String(this.blocklyContainer.offsetWidth));
      localStorage.setItem(GAME_WIDTH_KEY, String(this.gameContainer.offsetWidth));
    } catch (err) {
      console.warn('Failed to save panel widths:', err);
    }
  }

  /**
   * Update grid coding mode state.
   * Call this when mode changes to recalculate constraints.
   */
  public setGridCodingMode(enabled: boolean): void {
    this.isGridCodingMode = enabled;
  }
}
