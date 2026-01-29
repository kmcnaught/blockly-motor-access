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
const RESIZER_WIDTH = 12;
const SIDEBAR_TOGGLE_WIDTH = 0; // Sidebar toggle hidden, using resizer instead

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
  private boundHandleWindowResize: () => void;
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
    this.boundHandleWindowResize = this.handleWindowResize.bind(this);
    this.boundHandleKeyboard = this.handleKeyboard.bind(this);

    // Set up ResizeObserver to detect when game container actually resizes
    if (this.onResizeCallback) {
      this.resizeObserver = new ResizeObserver(() => {
        // Only trigger callback if not currently resizing (wait for drag to complete)
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

    // Window resize
    window.addEventListener('resize', this.boundHandleWindowResize);
  }

  /**
   * Remove all event listeners.
   */
  public destroy(): void {
    this.resizerElement.removeEventListener('mousedown', this.boundStartResize);
    this.resizerElement.removeEventListener('touchstart', this.boundStartResize);
    this.resizerElement.removeEventListener('keydown', this.boundHandleKeyboard);
    window.removeEventListener('resize', this.boundHandleWindowResize);

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
      return 300; // No toolbox visible, but need room for blocks
    }

    const flyout = this.workspace.getFlyout();
    if (!flyout) return 400;

    const flyoutWidth = flyout.getWidth();
    // Need toolbox + space for blocks = 2.2x toolbox width
    return Math.max(400, Math.ceil(flyoutWidth * 2.2));
  }

  /**
   * Get minimum game container width from CSS.
   */
  private getMinGameWidth(): number {
    const computed = getComputedStyle(this.gameContainer);
    return parseFloat(computed.minWidth) || 450;
  }

  /**
   * Calculate maximum widths based on available space.
   */
  private getMaxWidths(containerWidth: number): { maxBlocklyWidth: number; maxGameWidth: number } {
    const minBlocklyWidth = this.getMinBlocklyWidth();
    const minGameWidth = this.getMinGameWidth();
    const availableWidth = containerWidth - RESIZER_WIDTH - SIDEBAR_TOGGLE_WIDTH;

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
    const availableWidth = containerWidth - RESIZER_WIDTH - SIDEBAR_TOGGLE_WIDTH;
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

    // Apply widths (ResizeObserver will handle maze redraw automatically)
    this.applyWidths(newBlocklyWidth, newGameWidth);

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

    const availableWidth = containerWidth - RESIZER_WIDTH - SIDEBAR_TOGGLE_WIDTH;
    const newGameWidth = availableWidth - newBlocklyWidth;

    this.applyWidths(newBlocklyWidth, newGameWidth);
    this.saveWidths();
  }

  /**
   * Handle window resize - re-constrain panels.
   */
  private handleWindowResize(): void {
    if (this.isResizing) return;

    // Check if we have custom widths set
    const hasCustomWidths = this.blocklyContainer.style.width && this.gameContainer.style.width;
    if (!hasCustomWidths) return;

    const containerWidth = this.container.offsetWidth;
    const availableWidth = containerWidth - RESIZER_WIDTH - SIDEBAR_TOGGLE_WIDTH;

    const currentBlocklyWidth = this.blocklyContainer.offsetWidth;
    const currentGameWidth = this.gameContainer.offsetWidth;
    const currentTotal = currentBlocklyWidth + currentGameWidth;

    const minBlocklyWidth = this.getMinBlocklyWidth();
    const minGameWidth = this.getMinGameWidth();

    // If panels exceed available space, scale proportionally
    if (currentTotal > availableWidth) {
      const ratio = availableWidth / currentTotal;
      let newBlocklyWidth = Math.floor(currentBlocklyWidth * ratio);
      let newGameWidth = Math.floor(currentGameWidth * ratio);

      // Respect minimums
      if (newBlocklyWidth < minBlocklyWidth) {
        newBlocklyWidth = minBlocklyWidth;
        newGameWidth = availableWidth - minBlocklyWidth;
      } else if (newGameWidth < minGameWidth) {
        newGameWidth = minGameWidth;
        newBlocklyWidth = availableWidth - minGameWidth;
      }

      this.applyWidths(newBlocklyWidth, newGameWidth);
    } else if (currentTotal < availableWidth - 10) {
      // Give extra space to Blockly
      const extraSpace = availableWidth - currentTotal;
      const newBlocklyWidth = currentBlocklyWidth + extraSpace;
      this.applyWidths(newBlocklyWidth, currentGameWidth);
    }
  }

  /**
   * Apply panel widths (override flex layout).
   */
  private applyWidths(blocklyWidth: number, gameWidth: number): void {
    this.blocklyContainer.style.flex = 'none';
    this.blocklyContainer.style.width = `${blocklyWidth}px`;
    this.gameContainer.style.flex = 'none';
    this.gameContainer.style.width = `${gameWidth}px`;

    Blockly.svgResize(this.workspace);

    // ResizeObserver will automatically trigger maze redraw when size changes
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
   * Restore saved widths from localStorage.
   */
  public restoreSavedWidths(): void {
    try {
      const savedBlocklyWidth = localStorage.getItem(BLOCKLY_WIDTH_KEY);
      const savedGameWidth = localStorage.getItem(GAME_WIDTH_KEY);

      if (!savedBlocklyWidth || !savedGameWidth) return;

      const blocklyWidth = parseInt(savedBlocklyWidth, 10);
      const gameWidth = parseInt(savedGameWidth, 10);

      if (isNaN(blocklyWidth) || isNaN(gameWidth)) return;

      // Validate against current constraints
      const containerWidth = this.container.offsetWidth;
      const availableWidth = containerWidth - RESIZER_WIDTH - SIDEBAR_TOGGLE_WIDTH;

      const minBlocklyWidth = this.getMinBlocklyWidth();
      const minGameWidth = this.getMinGameWidth();
      const { maxBlocklyWidth, maxGameWidth } = this.getMaxWidths(containerWidth);

      // Only apply if valid
      if (blocklyWidth >= minBlocklyWidth && blocklyWidth <= maxBlocklyWidth &&
          gameWidth >= minGameWidth && gameWidth <= maxGameWidth &&
          blocklyWidth + gameWidth <= availableWidth + 10) { // 10px tolerance

        this.applyWidths(blocklyWidth, gameWidth);
      }
    } catch (err) {
      console.warn('Failed to restore panel widths:', err);
    }
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
