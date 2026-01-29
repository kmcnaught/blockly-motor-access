/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Padding Controls Manager for Maze game.
 * Adds clickable buttons to create padding elements on screen edges
 * for eye gaze control bars. Each button cycles through 4 padding levels
 * (3%, 6%, 9%, 12% of viewport width) then resets to 0.
 */

/**
 * LocalStorage keys for persisting padding state.
 */
const LEFT_PADDING_KEY = 'mazePaddingLeftClicks';
const RIGHT_PADDING_KEY = 'mazePaddingRightClicks';

/**
 * Padding increment per click (in vw units).
 */
const PADDING_INCREMENT_VW = 3;

/**
 * Maximum number of clicks (4 clicks = 12vw max).
 */
const MAX_CLICKS = 4;

/**
 * Configuration options for PaddingControlsManager.
 */
export interface PaddingControlsConfig {
  /** Whether grid mode is active (hides controls) */
  isGridMode: boolean;
  /** Whether grid coding mode is active (hides controls) */
  isGridCodingMode: boolean;
}

/**
 * Controller for padding controls functionality.
 * Manages left and right padding state, applies CSS, and persists to localStorage.
 */
export class PaddingControlsManager {
  private leftPaddingDiv: HTMLElement | null;
  private rightPaddingDiv: HTMLElement | null;
  private leftButton: HTMLElement | null;
  private rightButton: HTMLElement | null;

  private leftClicks: number = 0;
  private rightClicks: number = 0;

  private isGridMode: boolean;
  private isGridCodingMode: boolean;

  private boundHandleLeftClick: () => void;
  private boundHandleRightClick: () => void;

  /**
   * Create a new PaddingControlsManager.
   * @param config Configuration options
   */
  constructor(config: PaddingControlsConfig) {
    this.isGridMode = config.isGridMode;
    this.isGridCodingMode = config.isGridCodingMode;

    // Get DOM elements
    this.leftPaddingDiv = document.getElementById('leftPadding');
    this.rightPaddingDiv = document.getElementById('rightPadding');
    this.leftButton = document.getElementById('padLeftBtn');
    this.rightButton = document.getElementById('padRightBtn');

    // Bind event handlers
    this.boundHandleLeftClick = this.handleLeftClick.bind(this);
    this.boundHandleRightClick = this.handleRightClick.bind(this);
  }

  /**
   * Initialize the padding controls.
   * Loads saved state from localStorage and attaches event listeners.
   */
  public init(): void {
    // Load saved state
    this.loadFromLocalStorage();

    // Apply initial padding
    this.applyPadding();

    // Attach event listeners
    if (this.leftButton) {
      this.leftButton.addEventListener('click', this.boundHandleLeftClick);
    }
    if (this.rightButton) {
      this.rightButton.addEventListener('click', this.boundHandleRightClick);
    }

    // Update visibility based on mode
    this.updateVisibility();
  }

  /**
   * Clean up event listeners.
   */
  public destroy(): void {
    if (this.leftButton) {
      this.leftButton.removeEventListener('click', this.boundHandleLeftClick);
    }
    if (this.rightButton) {
      this.rightButton.removeEventListener('click', this.boundHandleRightClick);
    }
  }

  /**
   * Handle left padding button click.
   * Cycles through 0 → 1 → 2 → 3 → 4 → 0 clicks.
   */
  private handleLeftClick(): void {
    this.leftClicks = (this.leftClicks + 1) % (MAX_CLICKS + 1);
    this.applyPadding();
    this.saveToLocalStorage();
  }

  /**
   * Handle right padding button click.
   * Cycles through 0 → 1 → 2 → 3 → 4 → 0 clicks.
   */
  private handleRightClick(): void {
    this.rightClicks = (this.rightClicks + 1) % (MAX_CLICKS + 1);
    this.applyPadding();
    this.saveToLocalStorage();
  }

  /**
   * Apply current padding state to DOM elements.
   * Each click = 3vw, so 0 clicks = 0vw, 4 clicks = 12vw.
   */
  private applyPadding(): void {
    const leftWidth = this.leftClicks * PADDING_INCREMENT_VW;
    const rightWidth = this.rightClicks * PADDING_INCREMENT_VW;

    if (this.leftPaddingDiv) {
      this.leftPaddingDiv.style.width = `${leftWidth}vw`;
    }
    if (this.rightPaddingDiv) {
      this.rightPaddingDiv.style.width = `${rightWidth}vw`;
    }
  }

  /**
   * Load saved padding state from localStorage.
   */
  private loadFromLocalStorage(): void {
    try {
      const savedLeft = localStorage.getItem(LEFT_PADDING_KEY);
      const savedRight = localStorage.getItem(RIGHT_PADDING_KEY);

      if (savedLeft !== null) {
        const leftClicks = parseInt(savedLeft, 10);
        if (!isNaN(leftClicks) && leftClicks >= 0 && leftClicks <= MAX_CLICKS) {
          this.leftClicks = leftClicks;
        }
      }

      if (savedRight !== null) {
        const rightClicks = parseInt(savedRight, 10);
        if (!isNaN(rightClicks) && rightClicks >= 0 && rightClicks <= MAX_CLICKS) {
          this.rightClicks = rightClicks;
        }
      }
    } catch (err) {
      console.warn('Failed to load padding state:', err);
    }
  }

  /**
   * Save current padding state to localStorage.
   */
  private saveToLocalStorage(): void {
    try {
      localStorage.setItem(LEFT_PADDING_KEY, String(this.leftClicks));
      localStorage.setItem(RIGHT_PADDING_KEY, String(this.rightClicks));
    } catch (err) {
      console.warn('Failed to save padding state:', err);
    }
  }

  /**
   * Update visibility based on current mode.
   * Padding controls are hidden in grid mode and grid coding mode.
   */
  private updateVisibility(): void {
    const shouldHide = this.isGridMode || this.isGridCodingMode;

    // Buttons visibility controlled by CSS body classes
    // Padding divs visibility also controlled by CSS body classes
    // No JavaScript changes needed here - CSS handles it
  }

  /**
   * Update mode state and refresh visibility.
   * Call this when mode changes.
   */
  public setMode(isGridMode: boolean, isGridCodingMode: boolean): void {
    this.isGridMode = isGridMode;
    this.isGridCodingMode = isGridCodingMode;
    this.updateVisibility();
  }
}
