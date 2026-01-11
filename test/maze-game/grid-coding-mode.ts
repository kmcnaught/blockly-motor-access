/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Grid Coding Mode Controller for Maze game.
 * Provides immediate execution with block insertion - keyboard commands both
 * execute the action AND insert the corresponding block into the Blockly workspace.
 * This bridges practice mode (immediate feedback) with coding mode (building programs).
 */

import * as Blockly from 'blockly/core';
import {javascriptGenerator} from 'blockly/javascript';
import {MazeGame} from './maze';
import {msg} from './messages';

/**
 * Saved maze state for undo functionality.
 */
interface MazeState {
  x: number;
  y: number;
  direction: number;
}

/**
 * History entry for undo - tracks block and maze state before the move.
 */
interface HistoryEntry {
  block: Blockly.Block;
  stateBefore: MazeState;
}

/**
 * Controller for Grid Coding Mode.
 * Keyboard commands insert real Blockly blocks AND execute immediately.
 */
export class GridCodingModeController {
  private workspace: Blockly.WorkspaceSvg;
  private mazeGame: MazeGame;
  private enabled = false;
  private executing = false;
  private boundKeyHandler: (e: KeyboardEvent) => void;

  // History for undo functionality
  private history: HistoryEntry[] = [];

  // Callbacks
  private onLevelCompleteCallback: ((success: boolean) => void) | null = null;
  private onBlockCountChangeCallback: ((count: number) => void) | null = null;

  // Fall overlay elements
  private fallOverlay: HTMLElement | null = null;
  private fallOverlayText: HTMLElement | null = null;

  constructor(workspace: Blockly.WorkspaceSvg, mazeGame: MazeGame) {
    this.workspace = workspace;
    this.mazeGame = mazeGame;

    // Bind keyboard handler
    this.boundKeyHandler = this.handleKeyDown.bind(this);

    // Cache fall overlay references
    this.fallOverlay = document.getElementById('fallOverlay');
    this.fallOverlayText = document.getElementById('fallOverlayText');
  }

  /**
   * Enable Grid coding mode.
   */
  public enable(): void {
    if (this.enabled) return;

    this.enabled = true;

    // Bind keyboard events
    document.addEventListener('keydown', this.boundKeyHandler);

    // Clear history and workspace
    this.clear();
  }

  /**
   * Disable Grid coding mode.
   */
  public disable(): void {
    if (!this.enabled) return;

    this.enabled = false;

    // Unbind keyboard events
    document.removeEventListener('keydown', this.boundKeyHandler);
  }

  /**
   * Check if Grid coding mode is enabled.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update the MazeGame reference (called when level changes).
   */
  public setMazeGame(mazeGame: MazeGame): void {
    this.mazeGame = mazeGame;
  }

  /**
   * Register completion callback for when level is completed.
   */
  public onLevelComplete(callback: (success: boolean) => void): void {
    this.onLevelCompleteCallback = callback;
  }

  /**
   * Register callback for when block count changes.
   */
  public onBlockCountChange(callback: (count: number) => void): void {
    this.onBlockCountChangeCallback = callback;
  }

  /**
   * Get the current block count.
   */
  public getBlockCount(): number {
    return this.history.length;
  }

  /**
   * Handle keyboard input.
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
        e.stopPropagation();
        this.doMoveForward();
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        e.stopPropagation();
        this.doTurn('left');
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        e.stopPropagation();
        this.doTurn('right');
        break;
      case 'Backspace':
      case 'Delete':
      case 'u':
      case 'U':
        e.preventDefault();
        e.stopPropagation();
        this.undo();
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        e.stopPropagation();
        this.clear();
        break;
      case 'r':
      case 'R':
        // Only run if not just reset (R without Ctrl/Cmd)
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          this.runProgram();
        }
        break;
    }
  }

  /**
   * Execute forward command - inserts block AND executes immediately.
   * Block is inserted first as disabled (greyed), then enabled on success or removed on failure.
   */
  private async doMoveForward(): Promise<void> {
    if (this.executing) return;

    // Save state before the move
    const stateBefore = this.saveMazeState();

    this.executing = true;

    // Insert block FIRST, but disabled (greyed out) - shows immediate feedback
    const block = this.insertBlock('maze_moveForward');
    const blockSvg = block as Blockly.BlockSvg | null;
    if (blockSvg) {
      blockSvg.setDisabledReason(true, 'pending_execution');
      this.scrollToBlock(block!);
    }

    try {
      const result = await this.mazeGame.executeImmediateMove();

      if (result === 'success' || result === 'continue') {
        // Success - enable the block
        if (blockSvg) {
          blockSvg.setDisabledReason(false, 'pending_execution');
          this.history.push({block: block!, stateBefore});
          this.highlightBlock(block!);
          this.notifyBlockCountChange();
        }

        if (result === 'success') {
          // Level completed!
          this.onLevelCompleteCallback?.(true);
        }
      } else {
        // Failed - remove the greyed-out block
        if (block) {
          block.dispose();
        }

        if (result === 'fell') {
          // Character fell off - show overlay, wait, then restore to position before fail
          this.showFallOverlay();
          await this.delay(1500);
          this.hideFallOverlay();
          this.restoreMazeState(stateBefore);
        }
        // 'wall' - just let them try again
      }
    } finally {
      this.executing = false;
    }
  }

  /**
   * Execute turn command - inserts block AND executes immediately.
   * Block is inserted first as disabled (greyed), then enabled after animation.
   */
  private async doTurn(direction: 'left' | 'right'): Promise<void> {
    if (this.executing) return;

    // Save state before the turn
    const stateBefore = this.saveMazeState();

    this.executing = true;

    // Insert block FIRST, but disabled (greyed out) - shows immediate feedback
    const block = this.insertBlock('maze_turn', {
      DIR: direction === 'left' ? 'turnLeft' : 'turnRight',
    });
    const blockSvg = block as Blockly.BlockSvg | null;
    if (blockSvg) {
      blockSvg.setDisabledReason(true, 'pending_execution');
      this.scrollToBlock(block!);
    }

    try {
      await this.mazeGame.executeImmediateTurn(direction);

      // Turn always succeeds - enable the block
      if (blockSvg) {
        blockSvg.setDisabledReason(false, 'pending_execution');
        this.history.push({block: block!, stateBefore});
        this.highlightBlock(block!);
        this.notifyBlockCountChange();
      }
    } finally {
      this.executing = false;
    }
  }

  /**
   * Insert a block into the workspace and connect it to the last block.
   */
  private insertBlock(
    blockType: string,
    fields?: Record<string, string>,
  ): Blockly.Block | null {
    // Use Blockly events group for proper undo/redo tracking
    const eventGroup = Blockly.utils.idGenerator.genUid();
    Blockly.Events.setGroup(eventGroup);

    try {
      // Create the block
      const block = this.workspace.newBlock(blockType);

      // Set any field values
      if (fields) {
        for (const [name, value] of Object.entries(fields)) {
          block.setFieldValue(value, name);
        }
      }

      // Initialize the block (renders it)
      block.initSvg();

      // Connect to the last block in the chain
      this.connectToLast(block);

      // Render the block
      block.render();

      // Fire a create event so Blockly properly tracks this block
      Blockly.Events.fire(new Blockly.Events.BlockCreate(block));

      return block;
    } finally {
      Blockly.Events.setGroup(false);
    }
  }

  /**
   * Connect a new block to the end of the existing chain.
   */
  private connectToLast(newBlock: Blockly.Block): void {
    const topBlocks = this.workspace.getTopBlocks(true);

    if (topBlocks.length === 0) {
      // First block - position it nicely
      const blockSvg = newBlock as Blockly.BlockSvg;
      blockSvg.moveBy(50, 50);
      return;
    }

    // Find the last block in the chain (the one with no next connection or unconnected next)
    let lastBlock = topBlocks[0];
    while (lastBlock.nextConnection?.targetBlock()) {
      lastBlock = lastBlock.nextConnection.targetBlock()!;
    }

    // Connect the new block to the last block's next connection
    if (lastBlock.nextConnection && newBlock.previousConnection) {
      lastBlock.nextConnection.connect(newBlock.previousConnection);
    }
  }

  /**
   * Briefly highlight a block to show it was just added.
   */
  private highlightBlock(block: Blockly.Block): void {
    const blockSvg = block as Blockly.BlockSvg;
    blockSvg.addSelect();
    setTimeout(() => {
      blockSvg.removeSelect();
    }, 300);
  }

  /**
   * Scroll the workspace to keep the block visible.
   */
  private scrollToBlock(block: Blockly.Block): void {
    const blockSvg = block as Blockly.BlockSvg;
    this.workspace.centerOnBlock(blockSvg.id);
  }

  /**
   * Undo the last action - removes block and restores maze state.
   */
  public undo(): void {
    if (this.history.length === 0) return;
    if (this.executing) return;

    const entry = this.history.pop()!;

    // Remove the block
    entry.block.dispose();

    // Restore maze state
    this.restoreMazeState(entry.stateBefore);

    this.notifyBlockCountChange();
  }

  /**
   * Clear all blocks and reset maze.
   */
  public clear(): void {
    if (this.executing) return;

    // Clear workspace
    this.workspace.clear();

    // Clear history
    this.history = [];

    // Reset maze
    this.mazeGame.reset();

    this.notifyBlockCountChange();
  }

  /**
   * Run the program from the beginning (replay).
   */
  public runProgram(): void {
    if (this.executing) return;
    if (this.history.length === 0) return;

    // Reset maze to start
    this.mazeGame.reset();

    // Generate code from workspace and execute
    const code = javascriptGenerator.workspaceToCode(this.workspace);

    if (code) {
      this.mazeGame.execute(code);
    }
  }

  /**
   * Save the current maze state for undo.
   */
  private saveMazeState(): MazeState {
    return this.mazeGame.getState();
  }

  /**
   * Restore a saved maze state.
   */
  private restoreMazeState(state: MazeState): void {
    this.mazeGame.setState(state);
  }

  /**
   * Notify callback about block count change.
   */
  private notifyBlockCountChange(): void {
    this.onBlockCountChangeCallback?.(this.history.length);
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
