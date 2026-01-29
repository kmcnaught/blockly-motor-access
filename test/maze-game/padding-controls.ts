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
  private leftIncButton: HTMLElement | null;
  private leftDecButton: HTMLElement | null;
  private rightIncButton: HTMLElement | null;
  private rightDecButton: HTMLElement | null;

  private leftClicks: number = 0;
  private rightClicks: number = 0;

  private isGridMode: boolean;
  private isGridCodingMode: boolean;

  private boundHandleLeftIncrease: () => void;
  private boundHandleLeftDecrease: () => void;
  private boundHandleRightIncrease: () => void;
  private boundHandleRightDecrease: () => void;

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
    this.leftIncButton = document.getElementById('padLeftIncBtn');
    this.leftDecButton = document.getElementById('padLeftDecBtn');
    this.rightIncButton = document.getElementById('padRightIncBtn');
    this.rightDecButton = document.getElementById('padRightDecBtn');

    // Bind event handlers
    this.boundHandleLeftIncrease = this.handleLeftIncrease.bind(this);
    this.boundHandleLeftDecrease = this.handleLeftDecrease.bind(this);
    this.boundHandleRightIncrease = this.handleRightIncrease.bind(this);
    this.boundHandleRightDecrease = this.handleRightDecrease.bind(this);
  }

  /**
   * Initialize the padding controls.
   * Loads saved state from localStorage and attaches event listeners.
   */
  public init(): void {
    // Load saved state
    this.loadFromLocalStorage();

    // Apply initial padding and update button states
    this.applyPadding();
    this.updateButtonVisibility();

    // Attach event listeners
    if (this.leftIncButton) {
      this.leftIncButton.addEventListener('click', this.boundHandleLeftIncrease);
    }
    if (this.leftDecButton) {
      this.leftDecButton.addEventListener('click', this.boundHandleLeftDecrease);
    }
    if (this.rightIncButton) {
      this.rightIncButton.addEventListener('click', this.boundHandleRightIncrease);
    }
    if (this.rightDecButton) {
      this.rightDecButton.addEventListener('click', this.boundHandleRightDecrease);
    }

    // Update visibility based on mode
    this.updateVisibility();
  }

  /**
   * Clean up event listeners.
   */
  public destroy(): void {
    if (this.leftIncButton) {
      this.leftIncButton.removeEventListener('click', this.boundHandleLeftIncrease);
    }
    if (this.leftDecButton) {
      this.leftDecButton.removeEventListener('click', this.boundHandleLeftDecrease);
    }
    if (this.rightIncButton) {
      this.rightIncButton.removeEventListener('click', this.boundHandleRightIncrease);
    }
    if (this.rightDecButton) {
      this.rightDecButton.removeEventListener('click', this.boundHandleRightDecrease);
    }
  }

  /**
   * Handle left padding increase button click.
   * Increments left padding by one step (max 4 clicks = 12vw).
   */
  private handleLeftIncrease(): void {
    if (this.leftClicks < MAX_CLICKS) {
      this.leftClicks++;
      this.applyPadding();
      this.updateButtonVisibility();
      this.saveToLocalStorage();
    }
  }

  /**
   * Handle left padding decrease button click.
   * Decrements left padding by one step (min 0 clicks = 0vw).
   */
  private handleLeftDecrease(): void {
    if (this.leftClicks > 0) {
      this.leftClicks--;
      this.applyPadding();
      this.updateButtonVisibility();
      this.saveToLocalStorage();
    }
  }

  /**
   * Handle right padding increase button click.
   * Increments right padding by one step (max 4 clicks = 12vw).
   */
  private handleRightIncrease(): void {
    if (this.rightClicks < MAX_CLICKS) {
      this.rightClicks++;
      this.applyPadding();
      this.updateButtonVisibility();
      this.saveToLocalStorage();
    }
  }

  /**
   * Handle right padding decrease button click.
   * Decrements right padding by one step (min 0 clicks = 0vw).
   */
  private handleRightDecrease(): void {
    if (this.rightClicks > 0) {
      this.rightClicks--;
      this.applyPadding();
      this.updateButtonVisibility();
      this.saveToLocalStorage();
    }
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
   * Update button visibility and enabled state based on padding values.
   * - Show decrease button only when padding > 0
   * - Disable increase button when padding is at max (12vw)
   */
  private updateButtonVisibility(): void {
    // Left side buttons
    if (this.leftDecButton) {
      if (this.leftClicks > 0) {
        this.leftDecButton.classList.add('active');
      } else {
        this.leftDecButton.classList.remove('active');
      }
    }

    if (this.leftIncButton) {
      if (this.leftClicks >= MAX_CLICKS) {
        this.leftIncButton.classList.add('disabled');
        this.leftIncButton.setAttribute('disabled', 'true');
      } else {
        this.leftIncButton.classList.remove('disabled');
        this.leftIncButton.removeAttribute('disabled');
      }
    }

    // Right side buttons
    if (this.rightDecButton) {
      if (this.rightClicks > 0) {
        this.rightDecButton.classList.add('active');
      } else {
        this.rightDecButton.classList.remove('active');
      }
    }

    if (this.rightIncButton) {
      if (this.rightClicks >= MAX_CLICKS) {
        this.rightIncButton.classList.add('disabled');
        this.rightIncButton.setAttribute('disabled', 'true');
      } else {
        this.rightIncButton.classList.remove('disabled');
        this.rightIncButton.removeAttribute('disabled');
      }
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
