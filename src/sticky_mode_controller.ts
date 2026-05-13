/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Blockly from 'blockly/core';
import {NavigationController} from './navigation_controller';
import {Mover, MoveType} from './actions/mover';
import {getNonShadowBlock} from './workspace_utilities';
import {MoveGrip} from './move_grip';
import {ConnectionHighlighter} from './connection_highlighter';

/**
 * Trigger modes for entering sticky mode.
 */
export enum TriggerMode {
  /** Double-click to enter sticky mode (default behavior). */
  DOUBLE_CLICK = 'double_click',
  /** Shift + single click to enter sticky mode. */
  SHIFT_CLICK = 'shift_click',
  /** Single click on an already-focused block to enter sticky mode. */
  FOCUSED_CLICK = 'focused_click',
  /** Any single click enters sticky mode when singleClickToMove is enabled. */
  MODE_TOGGLE = 'mode_toggle',
  /** Click on the grip handle to enter sticky mode. */
  GRIP_CLICK = 'grip_click',
}

/**
 * Information about an active sticky mode operation.
 */
export class StickyModeInfo {
  constructor(
    readonly block: Blockly.BlockSvg,
    readonly startClientX: number,
    readonly startClientY: number,
  ) {}
}

/**
 * Controller for click-and-stick functionality.
 * Manages the lifecycle of sticky mode where blocks follow the cursor after double-click.
 * Follows the same architectural pattern as Mover (Map-based tracking, lifecycle methods).
 */
export class StickyModeController {
  /** Map tracking active sticky mode operations per workspace. */
  private stickyModes: Map<Blockly.WorkspaceSvg, StickyModeInfo> = new Map();

  /** Event listeners that need cleanup. */
  private listeners: Array<{
    target: EventTarget;
    type: string;
    handler: EventListener;
    options?: boolean | AddEventListenerOptions;
  }> = [];

  /** The current trigger mode for entering sticky mode. */
  private triggerMode: TriggerMode = TriggerMode.DOUBLE_CLICK;

  /** Whether click-to-move features are enabled. */
  private enabled: boolean = true;

  /** The block that was focused before pointerdown (for focused-click trigger mode). */
  private focusedBlockBeforePointerdown: Blockly.BlockSvg | null = null;

  /** Whether the focused block had intentional highlight before pointerdown. */
  private hadIntentionalHighlightBeforePointerdown: boolean = false;

  /** Whether the trash lid is open for the highlight-hover feature. */
  private isTrashLidOpenForHighlight: boolean = false;

  /** Block to delete on next bin click (captured at pointerdown). */
  private blockToDeleteOnBinClick: Blockly.BlockSvg | null = null;

  /** Flag to ignore the next click event after entering sticky mode via shift+click. */
  private ignoreNextClick: boolean = false;

  /** The current move grip displayed on the focused block, if any. */
  private currentGrip: MoveGrip | null = null;

  /** The block that currently has a grip attached. */
  private gripBlock: Blockly.BlockSvg | null = null;

  /** Whether the block should follow the mouse cursor during sticky move (default: true). */
  private keepBlockOnMouse: boolean = true;

  /** Whether clicking on empty workspace moves the block there (default: true). */
  private allowDropOnEmptyWorkspace: boolean = true;

  /** The flyout block that is pending placement (for "preview then place" mode). */
  private pendingFlyoutBlock: Blockly.BlockSvg | null = null;

  /** The connection highlighter for showing pending placement options. */
  private pendingHighlighter: ConnectionHighlighter | null = null;

  /** Connection highlight size for the pending highlighter. */
  private connectionSize: 'minimal' | 'medium' | 'large' = 'medium';

  /** Optional callback when entering sticky mode. */
  private onEnterCallback?: (block: Blockly.BlockSvg) => void;

  /** Optional callback when exiting sticky mode. */
  private onExitCallback?: () => void;

  constructor(
    private workspace: Blockly.WorkspaceSvg,
    private navigationController: NavigationController,
  ) {}

  /**
   * Enable or disable keeping the block on the mouse during sticky move.
   *
   * @param enabled Whether the block should follow the cursor (true) or stay at click position (false).
   */
  setKeepBlockOnMouse(enabled: boolean): void {
    this.keepBlockOnMouse = enabled;
  }

  /**
   * Enable or disable moving the block to the clicked location when clicking on empty workspace.
   * When disabled, clicking empty workspace drops the block in place instead.
   *
   * @param enabled Whether clicking empty workspace should move the block there.
   */
  setAllowDropOnEmptyWorkspace(enabled: boolean): void {
    this.allowDropOnEmptyWorkspace = enabled;
  }

  /**
   * Gets the mover from the navigation controller.
   */
  private get mover(): Mover {
    return (this.navigationController as any).mover;
  }

  /**
   * Gets the drag strategy from a block.
   *
   * @param block
   */
  private getDragStrategy(block: Blockly.BlockSvg) {
    return (block as any).dragStrategy;
  }

  /**
   * Sets click-and-stick mode on a block's drag strategy.
   *
   * @param block
   * @param enabled
   */
  private setClickAndStickMode(block: Blockly.BlockSvg, enabled: boolean) {
    const strategy = this.getDragStrategy(block);
    if (strategy?.setClickAndStickMode) {
      strategy.setClickAndStickMode(enabled);
    }
  }

  /**
   * Check if sticky mode is currently active for this workspace.
   */
  isActive(): boolean {
    return this.stickyModes.has(this.workspace);
  }

  /**
   * Get the block currently in sticky mode, if any.
   */
  getActiveBlock(): Blockly.BlockSvg | null {
    const info = this.stickyModes.get(this.workspace);
    return info ? info.block : null;
  }

  /**
   * Set the trigger mode for entering sticky mode.
   *
   * @param mode The trigger mode to use.
   */
  setTriggerMode(mode: TriggerMode): void {
    this.triggerMode = mode;
  }

  /**
   * Enable or disable click-to-move features.
   * When disabled, blocks cannot enter sticky mode via any trigger.
   *
   * @param enabled Whether click-to-move features should be enabled.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.isActive()) {
      this.exit('abort');
    }
    if (!enabled) {
      this.hideGrip();
    }
  }

  /**
   * Set a callback that fires when sticky mode is entered.
   *
   * @param callback The callback to invoke when entering sticky mode.
   */
  setOnEnterCallback(callback: (block: Blockly.BlockSvg) => void): void {
    this.onEnterCallback = callback;
  }

  /**
   * Set a callback that fires when sticky mode is exited.
   *
   * @param callback The callback to invoke when exiting sticky mode.
   */
  setOnExitCallback(callback: () => void): void {
    this.onExitCallback = callback;
  }

  /**
   * Check if the given block can enter sticky mode.
   *
   * @param block
   */
  canEnter(block: Blockly.BlockSvg): boolean {
    return !!(
      block &&
      !block.isDisposed() &&
      block.isMovable() &&
      !this.mover.isMoving(this.workspace)
    );
  }

  /**
   * Sets up event listeners for click and stick functionality.
   */
  install() {
    const workspaceElement = this.workspace.getParentSvg();
    if (!workspaceElement) return;

    this.addListener(workspaceElement, 'dblclick', (event) => {
      this.handleDoubleClick(event as MouseEvent);
    }, false);

    this.addListener(document, 'pointermove', (event) => {
      this.handlePointerMove(event as PointerEvent);
    }, false);

    // Capture pointerdown BEFORE it changes focus (capture phase)
    // Must be on document with capture:true to catch ALL pointerdowns before focus changes
    // Blockly uses pointerdown (not mousedown) for blocks to support touch
    this.addListener(document, 'pointerdown', (event) => {
      this.handlePointerDown(event as PointerEvent);
    }, true);

    this.addListener(document, 'click', (event) => {
      this.handleClick(event as MouseEvent);
    }, true);

    // Also intercept pointerup to prevent trashcan flyout from opening
    this.addListener(document, 'pointerup', (event) => {
      if (this.blockToDeleteOnBinClick) {
        event.stopImmediatePropagation();
      }
    }, true);

    // Listen for focus changes to manage grip display
    this.workspace.addChangeListener(this.handleFocusChange.bind(this));
  }

  /**
   * Removes all event listeners.
   */
  uninstall() {
    for (const {target, type, handler, options} of this.listeners) {
      target.removeEventListener(type, handler, options);
    }
    this.listeners = [];
    this.hideGrip();
  }

  /**
   * Handles focus change events to show/hide grip on focused blocks.
   *
   * @param event
   */
  private handleFocusChange(event: Blockly.Events.Abstract): void {
    if (!this.enabled) return;

    // Only show grip in GRIP_CLICK mode
    if (this.triggerMode !== TriggerMode.GRIP_CLICK) {
      return;
    }

    // Don't show grip during sticky mode
    if (this.isActive()) {
      return;
    }

    // Get the currently focused block
    const cursor = this.workspace.getCursor();
    if (!cursor) {
      this.hideGrip();
      return;
    }

    const curNode = cursor.getCurNode();
    if (!curNode) {
      this.hideGrip();
      return;
    }

    // Get the block from the cursor node
    let block: Blockly.BlockSvg | null = null;
    if (curNode instanceof Blockly.BlockSvg) {
      block = curNode;
    } else if ('getSourceBlock' in curNode && typeof (curNode as any).getSourceBlock === 'function') {
      block = (curNode as any).getSourceBlock();
    }

    if (!block) {
      this.hideGrip();
      return;
    }

    // If it's the same block, don't recreate the grip
    if (this.gripBlock === block && this.currentGrip) {
      return;
    }

    // Show grip on the new focused block
    this.showGrip(block);
  }

  /**
   * Shows the grip on the given block.
   *
   * @param block
   */
  private showGrip(block: Blockly.BlockSvg): void {
    // Hide any existing grip first
    this.hideGrip();

    // Create and show new grip
    this.currentGrip = new MoveGrip(block, (clickedBlock, event) => {
      this.handleGripClick(clickedBlock, event);
    });
    this.currentGrip.show();
    this.gripBlock = block;
  }

  /**
   * Hides the current grip if one is showing.
   */
  private hideGrip(): void {
    if (this.currentGrip) {
      this.currentGrip.hide();
      this.currentGrip = null;
    }
    this.gripBlock = null;
  }

  /**
   * Handles click events on the grip.
   *
   * @param block
   * @param event
   */
  private handleGripClick(block: Blockly.BlockSvg, event: MouseEvent): void {
    if (!this.enabled) return;

    const nonShadowBlock = getNonShadowBlock(block);
    if (nonShadowBlock && nonShadowBlock.isMovable()) {
      if (this.enter(nonShadowBlock, event.clientX, event.clientY)) {
        // Hide grip when entering sticky mode
        this.hideGrip();
      }
    }
  }

  /**
   * Helper to add and track event listeners.
   *
   * @param target
   * @param type
   * @param handler
   * @param options
   */
  private addListener(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) {
    target.addEventListener(type, handler, options);
    this.listeners.push({target, type, handler, options});
  }

  /**
   * Enters sticky mode where a block follows the cursor.
   *
   * @param block The block to enter sticky mode with.
   * @param clientX Screen X coordinate where the block was grabbed.
   * @param clientY Screen Y coordinate where the block was grabbed.
   * @returns True if sticky mode was successfully entered.
   */
  enter(block: Blockly.BlockSvg, clientX: number, clientY: number): boolean {
    // Prevent sticky mode if no other blocks to move to
    const allBlocks = this.workspace.getAllBlocks(false);
    // Find blocks other than the draggable itself
    // (descendants ARE valid move targets - can move parent below its children)
    const otherBlocks = allBlocks.filter(
      (b) => b !== block && b.isMovable()
    );

    if (otherBlocks.length === 0) {
      Blockly.Toast.show(this.workspace, {
        message: 'Need at least 2 blocks to use move mode',
        id: 'maze_move_mode_hint',
      });
      return false;
    }

    if (this.mover.isMoving(this.workspace)) {
      this.mover.abortMove(this.workspace);
    }

    if (this.isActive()) {
      this.exit('finish');
    }

    if (!block || block.isDisposed()) {
      return false;
    }

    // Close any open fields before entering sticky mode
    Blockly.DropDownDiv.hide();
    Blockly.WidgetDiv.hide();

    try {
      const onMoveFinished = () => {
        this.resetStickyState();
      };

      const success = this.mover.startMove(
        this.workspace,
        block,
        MoveType.Move,
        null,
        onMoveFinished,
        true, // isClickAndStick - must be set before onDragStart is called
      );

      if (success) {
        this.stickyModes.set(
          this.workspace,
          new StickyModeInfo(block, clientX, clientY),
        );
        block.getSvgRoot().classList.add('blockly-sticky-mode');
        this.onEnterCallback?.(block);
        return true;
      }
      return false;
    } catch (error) {
      this.stickyModes.delete(this.workspace);
      return false;
    }
  }

  /**
   * Exits sticky mode.
   *
   * @param action Whether to finish (commit) or abort the move.
   */
  exit(action: 'finish' | 'abort') {
    const info = this.stickyModes.get(this.workspace);
    if (!info) return;

    this.setClickAndStickMode(info.block, false);

    if (this.mover.isMoving(this.workspace)) {
      if (action === 'finish') {
        this.mover.finishMove(this.workspace);
      } else {
        this.mover.abortMove(this.workspace);
      }
    }

    this.resetStickyState();

    this.onExitCallback?.();
  }

  /**
   * Handles pointerdown to capture which block was focused BEFORE the click changes focus,
   * and to handle shift+click trigger mode.
   *
   * @param event
   */
  private handlePointerDown(event: PointerEvent) {
    // Check if clicking on bin with a highlighted block - capture the block to delete.
    // We capture it here because by click time, the selection/focus may have changed.
    this.blockToDeleteOnBinClick = null;
    if (!this.isActive() && this.isClickOnBin(event.clientX, event.clientY)) {
      const highlightedBlock = this.getIntentionallyHighlightedBlock();
      if (
        highlightedBlock &&
        !highlightedBlock.isDisposed() &&
        highlightedBlock.isDeletable() &&
        !highlightedBlock.workspace?.isFlyout
      ) {
        this.blockToDeleteOnBinClick = highlightedBlock;
        // Stop immediate propagation to prevent ALL other handlers including trashcan's
        event.stopImmediatePropagation();
      }
    }

    // Handle shift+click mode - enter sticky mode immediately on pointerdown
    if (this.triggerMode === TriggerMode.SHIFT_CLICK && event.shiftKey) {
      const clickedBlock = this.getBlockFromEvent(event);
      if (clickedBlock) {
        const target = event.target as Element;
        if (target && this.isDoubleClickOnField(target) && !this.isBlockFromFlyout(clickedBlock)) {
          return;
        }

        const block = getNonShadowBlock(clickedBlock);
        if (block && block.isMovable()) {
          // Prevent Blockly's gesture from starting
          event.preventDefault();
          event.stopPropagation();

          // Enter sticky mode immediately
          if (this.enter(block, event.clientX, event.clientY)) {
            // Set flag to ignore the next click event
            this.ignoreNextClick = true;
          }
        }
      }
      return;
    }

    // Handle flyout block clicks in FOCUSED_CLICK mode at pointerdown level
    // This prevents Blockly from taking focus before we can redirect it
    if (this.triggerMode === TriggerMode.FOCUSED_CLICK) {
      const clickedBlock = this.getBlockFromEvent(event);
      if (clickedBlock && this.isBlockFromFlyout(clickedBlock)) {
        // Prevent Blockly's gesture from starting - this prevents focus going to flyout
        event.preventDefault();
        event.stopPropagation();

        // Handle the insertion directly (similar to shift+click flow)
        this.handleFlyoutBlockPointerDown(clickedBlock);
        return;
      }
    }

    // Track focus state for FOCUSED_CLICK mode
    if (this.triggerMode !== TriggerMode.FOCUSED_CLICK) {
      return;
    }

    // Don't trigger sticky mode if clicking on a field
    const target = event.target as Element;
    const isField = this.isClickOnField(target);

    if (target && isField) {
      this.focusedBlockBeforePointerdown = null;
      this.hadIntentionalHighlightBeforePointerdown = false;
      return;
    }

    // Capture the currently focused/selected block before the pointerdown changes focus
    // We need to check both:
    // 1. Cursor position (if keyboard navigation is active)
    // 2. Selected blocks (if using mouse-only workflow)

    let focusedBlock: Blockly.BlockSvg | null = null;

    // Try to get from cursor first (keyboard navigation)
    const cursor = this.workspace.getCursor();
    if (cursor) {
      const curNode = cursor.getCurNode();
      if (curNode) {
        if (curNode instanceof Blockly.BlockSvg) {
          focusedBlock = curNode;
        } else if ('getSourceBlock' in curNode && typeof (curNode as any).getSourceBlock === 'function') {
          focusedBlock = (curNode as any).getSourceBlock();
        }
      }
    }

    // If no cursor-based focus, check for selected blocks (mouse workflow)
    if (!focusedBlock) {
      const selected = Blockly.common.getSelected();
      if (selected && selected instanceof Blockly.BlockSvg && selected.workspace === this.workspace) {
        focusedBlock = selected;
      }
    }

    this.focusedBlockBeforePointerdown = focusedBlock;

    // Check if the focused block has intentional highlight (solid outline)
    // This needs to be captured NOW before the pointerdown changes focus/selection
    if (focusedBlock && !focusedBlock.isDisposed()) {
      const pathElement = focusedBlock.pathObject?.svgPath;
      const blockSvgGroup = focusedBlock.getSvgRoot();
      const hasActiveFocus =
        pathElement?.classList.contains('blocklyActiveFocus') ?? false;
      const hasSelected =
        blockSvgGroup?.classList.contains('blocklySelected') ?? false;
      this.hadIntentionalHighlightBeforePointerdown =
        hasActiveFocus || hasSelected;
    } else {
      this.hadIntentionalHighlightBeforePointerdown = false;
    }
  }

  /**
   * Handles double-click events on blocks to enter sticky mode.
   *
   * @param event
   */
  private handleDoubleClick(event: MouseEvent) {
    if (!this.enabled) return;

    // Only handle double-clicks if trigger mode is set to DOUBLE_CLICK
    if (this.triggerMode !== TriggerMode.DOUBLE_CLICK) {
      return;
    }

    if (event.defaultPrevented) return;

    if (this.isActive()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const target = event.target as Element;
    const clickedBlock = this.getBlockFromEvent(event);

    if (clickedBlock) {
      this.workspace.getAudioManager().preload();
    }

    if (target && this.isDoubleClickOnField(target)) {
      return;
    }

    const block = getNonShadowBlock(clickedBlock);
    if (block && block.isMovable()) {
      if (this.enter(block, event.clientX, event.clientY)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  /**
   * Handles click events during sticky mode or to trigger sticky mode.
   *
   * @param event
   */
  private handleClick(event: MouseEvent) {
    if (!this.enabled) return;

    // If we just entered sticky mode via shift+click or pending flyout, ignore this click
    if (this.ignoreNextClick) {
      this.ignoreNextClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // If there's a pending flyout insertion, cancel it
    // (Connection highlight clicks are handled by the highlight's own click handler,
    // so if we get here, the user clicked elsewhere and wants to cancel)
    if (this.isPendingFlyoutInsertion()) {
      this.cancelPendingFlyoutInsertion();
      // Don't return - allow the click to proceed normally
    }

    // Check for bin click when a block was captured for deletion at pointerdown
    if (this.blockToDeleteOnBinClick) {
      const block = this.blockToDeleteOnBinClick;
      this.blockToDeleteOnBinClick = null;

      if (!block.isDisposed()) {
        // Close the trash lid
        if (this.isTrashLidOpenForHighlight) {
          this.workspace.trashcan?.setLidOpen(false);
          this.isTrashLidOpenForHighlight = false;
        }

        // Unplug with healStack to preserve children, then dispose
        block.unplug(true);
        block.dispose();

        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }

    // If already in sticky mode, handle the drop/connect action
    if (this.isActive()) {
      this.handleStickyModeClick(event);
      return;
    }

    // Get the clicked block once to avoid inconsistencies
    const clickedBlock = this.getBlockFromEvent(event);

    // Check if this is a flyout block - handle it specially
    if (clickedBlock && this.isBlockFromFlyout(clickedBlock)) {
      // Check if this click should trigger sticky mode based on trigger mode
      const shouldTrigger = this.shouldTriggerStickyMode(event, clickedBlock);

      if (shouldTrigger) {
        const target = event.target as Element;

        this.workspace.getAudioManager().preload();

        if (target && this.isDoubleClickOnField(target)) {
          return;
        }

        // Show placement highlights for the flyout block
        this.insertFlyoutBlockIntoStickyMode(clickedBlock, event);
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    // Handle workspace blocks (existing logic)
    // Check if this click should trigger sticky mode based on trigger mode
    const shouldTrigger = this.shouldTriggerStickyMode(event, clickedBlock);

    if (shouldTrigger && clickedBlock) {
      const target = event.target as Element;

      this.workspace.getAudioManager().preload();

      if (target && this.isDoubleClickOnField(target)) {
        return;
      }

      const block = getNonShadowBlock(clickedBlock);
      if (block && block.isMovable()) {
        if (this.enter(block, event.clientX, event.clientY)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    }
  }

  /**
   * Check if the current click event should trigger sticky mode.
   *
   * @param event The click event.
   * @param clickedBlock The block that was clicked (or null if no block).
   * @returns True if sticky mode should be triggered.
   */
  private shouldTriggerStickyMode(event: MouseEvent, clickedBlock: Blockly.BlockSvg | null): boolean {
    if (!clickedBlock) return false;

    switch (this.triggerMode) {
      case TriggerMode.SHIFT_CLICK:
        return event.shiftKey;

      case TriggerMode.FOCUSED_CLICK:
        // For flyout blocks, skip the focus check - any click triggers sticky mode
        // This provides a simpler interaction model for flyout blocks
        if (this.isBlockFromFlyout(clickedBlock)) {
          return true;
        }

        // For workspace blocks, check if the clicked block was the one that was focused BEFORE the pointerdown
        // (clicking a block makes it focused, so we need to check the pre-click state)
        // Note: Field detection happens earlier in handlePointerDown to set focusedBlockBeforePointerdown
        if (this.focusedBlockBeforePointerdown !== clickedBlock) {
          return false;
        }

        // Trigger if the block has a VISIBLE highlight
        // A block has a visible highlight based on CSS class combinations:
        // 1. blocklySelected class (core Blockly selection - always visible)
        // 2. blocklyActiveFocus OR blocklyPassiveFocus (keyboard nav - only visible when keyboard mode active)
        //
        // The visual highlight is determined by CSS rules, not by semantic focus state.
        // We check the classes that control the CSS rules that make highlights visible.
        const pathElement = clickedBlock.pathObject.svgPath;
        const blockSvgGroup = clickedBlock.getSvgRoot();

        // Core Blockly selection (always creates visible highlight)
        // Note: blocklySelected class is on the parent <g> element, not the path
        // The CSS rule is: .blocklySelected > .blocklyPath { stroke: #fc3; }
        const hasSelectedClass = blockSvgGroup?.classList.contains('blocklySelected') ?? false;

        // Keyboard navigation highlights (only visible when keyboard mode is active)
        const bodyHasKeyboardNav = document.body.classList.contains('blocklyKeyboardNavigation');
        const hasActiveFocus = pathElement?.classList.contains('blocklyActiveFocus') ?? false;
        const hasPassiveFocus = pathElement?.classList.contains('blocklyPassiveFocus') ?? false;

        // Boolean logic: visible highlight exists if:
        // - Block has blocklySelected class (core selection), OR
        // - Keyboard nav is active AND block has active/passive focus
        const hasVisibleHighlight = hasSelectedClass ||
          (bodyHasKeyboardNav && (hasActiveFocus || hasPassiveFocus));

        // Block should trigger sticky mode if it has a visible highlight
        return hasVisibleHighlight;

      case TriggerMode.MODE_TOGGLE:
        // MODE_TOGGLE requires explicit enablement through external state management
        return false;

      case TriggerMode.GRIP_CLICK:
        // GRIP_CLICK is handled by handleGripClick() which is invoked directly
        // when the grip element is clicked (with stopPropagation to prevent this
        // method from being called). Regular clicks outside the grip don't trigger
        // sticky mode in this mode.
        return false;

      case TriggerMode.DOUBLE_CLICK:
      default:
        // Double-click is handled separately
        return false;
    }
  }

  /**
   * Handles pointer movement during sticky mode to make blocks follow the cursor.
   *
   * @param event
   */
  private handlePointerMove(event: PointerEvent) {
    // Handle trash lid opening for highlighted blocks (outside sticky mode)
    if (!this.isActive()) {
      this.updateTrashLidForHighlightedBlock(event.clientX, event.clientY);
      return;
    }

    // Only update block position if keepBlockOnMouse is enabled
    if (!this.keepBlockOnMouse) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const moveInfo = (this.mover as any)?.moves?.get(this.workspace);
    if (!moveInfo) return;

    const targetWorkspaceCoords =
      Blockly.utils.svgMath.screenToWsCoordinates(
        this.workspace,
        new Blockly.utils.Coordinate(event.clientX, event.clientY),
      );

    const deltaX = targetWorkspaceCoords.x - moveInfo.startLocation.x;
    const deltaY = targetWorkspaceCoords.y - moveInfo.startLocation.y;

    moveInfo.totalDelta.x = deltaX;
    moveInfo.totalDelta.y = deltaY;

    if (moveInfo.dragger) {
      moveInfo.dragger.onDrag(
        event as any,
        moveInfo.totalDelta,
      );
    }
  }

  /**
   * Updates the trash can lid state based on mouse position and highlighted block.
   * Opens the lid when hovering over the bin with an intentionally highlighted block.
   */
  private updateTrashLidForHighlightedBlock(
    clientX: number,
    clientY: number,
  ): void {
    const trashcan = this.workspace.trashcan;
    if (!trashcan) return;

    const isOverBin = this.isClickOnBin(clientX, clientY);
    const highlightedBlock = this.getIntentionallyHighlightedBlock();

    const shouldBeOpen = isOverBin && highlightedBlock !== null;

    if (shouldBeOpen && !this.isTrashLidOpenForHighlight) {
      trashcan.setLidOpen(true);
      this.isTrashLidOpenForHighlight = true;
    } else if (!shouldBeOpen && this.isTrashLidOpenForHighlight) {
      trashcan.setLidOpen(false);
      this.isTrashLidOpenForHighlight = false;
    }
  }

  /**
   * Handles clicks during sticky mode for drop/connect/delete actions.
   *
   * @param event
   */
  private handleStickyModeClick(event: MouseEvent | PointerEvent) {
    const info = this.stickyModes.get(this.workspace);
    if (!info) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const clientX = event.clientX;
    const clientY = event.clientY;

    if (this.isClickOnBin(clientX, clientY)) {
      this.deleteBlockOnBin();
      return;
    }

    // Only resolve a connection if the click landed on a connection highlight
    // element itself. Without this guard, clicking on the block body just below
    // the selected block can hit the highlight's geometric search radius and
    // trigger an unintended connect rather than a fallback.
    const clickTarget = event.target as Element;
    let isOnConnectionHighlight = false;
    let el: Element | null = clickTarget;
    while (el) {
      if (
        el.classList?.contains('blocklyPotentialConnection') ||
        el.classList?.contains('blocklyConnectionHighlightLayer')
      ) {
        isOnConnectionHighlight = true;
        break;
      }
      el = el.parentElement;
    }
    const connectionInfo = isOnConnectionHighlight
      ? this.findConnectionAtPoint(clientX, clientY)
      : null;

    if (connectionInfo) {
      this.connectToClickedConnection(connectionInfo, clientX, clientY);
      return;
    }

    // Check if there's a connection preview
    const dragStrategy = this.getDragStrategy(info.block);

    if (this.keepBlockOnMouse) {
      // Block is following mouse - preview changes as you move
      // Accept any connection preview at current position
      if (dragStrategy && dragStrategy.connectionCandidate) {
        this.acceptConnectionCandidate();
        return;
      }
    } else {
      // Block is NOT following mouse - preview is static at original location
      // Only accept preview if clicking on the source block itself
      const clickedBlock = this.getBlockFromEvent(event);
      const isClickOnSourceBlock = clickedBlock === info.block;

      if (isClickOnSourceBlock && dragStrategy && dragStrategy.connectionCandidate) {
        this.acceptConnectionCandidate();
        return;
      }
    }

    // No connection was made. If allowDropOnEmptyWorkspace is enabled and the
    // click landed outside the source block, move the block to the click position.
    // In all other cases (click on source block, or no empty-workspace drop
    // allowed), abort and return the block to its original position.
    if (this.allowDropOnEmptyWorkspace) {
      const blockBounds = info.block.getBoundingRectangle();
      const clickWorkspaceCoords = Blockly.utils.svgMath.screenToWsCoordinates(
        this.workspace,
        new Blockly.utils.Coordinate(clientX, clientY),
      );
      if (!blockBounds.contains(clickWorkspaceCoords.x, clickWorkspaceCoords.y)) {
        this.exitStickyModeAndDrop(clientX, clientY);
        return;
      }
    }

    this.exitStickyModeAndDropToStart();
  }

  /**
   * Gets a block from an event target.
   * Searches both main workspace and flyout workspace blocks.
   *
   * @param event
   * @param event.target
   */
  private getBlockFromEvent(event: {
    target: EventTarget | null;
  }): Blockly.BlockSvg | null {
    const target = event.target as Element;
    if (!target) return null;

    // Get blocks from both main workspace and flyout
    let blocks = this.workspace.getAllBlocks();
    const flyout = this.workspace.getFlyout();
    if (flyout && flyout.isVisible()) {
      const flyoutWorkspace = flyout.getWorkspace();
      if (flyoutWorkspace) {
        blocks = blocks.concat(flyoutWorkspace.getAllBlocks());
      }
    }

    const allBlockElements: Element[] = [];
    let currentElement: Element | null = target;

    while (currentElement) {
      if (currentElement.classList?.contains('blocklyBlock')) {
        allBlockElements.push(currentElement);
      }
      currentElement = currentElement.parentElement;
    }

    if (allBlockElements.length > 0) {
      const innermostBlockElement = allBlockElements[0];
      const block = blocks.find((b) => b.getSvgRoot() === innermostBlockElement);

      if (block && block instanceof Blockly.BlockSvg) {
        return block;
      }
    }

    return null;
  }

  /**
   * Checks if a block is from the flyout.
   *
   * @param block The block to check.
   * @returns True if the block is from the flyout workspace.
   */
  private isBlockFromFlyout(block: Blockly.BlockSvg): boolean {
    return block.workspace.isFlyout === true;
  }

  /**
   * Set the connection highlight size for pending flyout insertion.
   *
   * @param size The size level: 'minimal', 'medium', or 'large'.
   */
  setConnectionSize(size: 'minimal' | 'medium' | 'large'): void {
    this.connectionSize = size;
  }

  /**
   * Check if there's a pending flyout insertion.
   */
  isPendingFlyoutInsertion(): boolean {
    return this.pendingFlyoutBlock !== null;
  }

  /**
   * Shows placement highlights for a flyout block without creating it.
   * The block stays in the flyout while highlights show where it can go.
   *
   * @param flyoutBlock The flyout block template to show placement options for.
   */
  private showFlyoutBlockPlacementHighlights(flyoutBlock: Blockly.BlockSvg): void {
    // Cancel any existing pending insertion
    this.cancelPendingFlyoutInsertion();

    // Create a temporary highlighter to check for valid connections
    const tempHighlighter = new ConnectionHighlighter(
      this.workspace,
      (connection) => this.placePendingBlockAtConnection(connection),
    );
    tempHighlighter.setConnectionSize(this.connectionSize);

    // Check for compatible connections
    const validConnections = tempHighlighter.highlightConnectionsForFlyoutBlock(
      flyoutBlock,
      this.workspace,
    );

    // If there are valid connections, show highlights and wait for user to click one
    if (validConnections.length > 0) {
      this.pendingFlyoutBlock = flyoutBlock;
      this.pendingHighlighter = tempHighlighter;
      // Ignore the click that triggered this to prevent immediate cancellation
      this.ignoreNextClick = true;
    } else {
      // No valid connections - use smart auto-placement
      tempHighlighter.dispose();
      this.autoPlaceFlyoutBlock(flyoutBlock);
    }
  }

  /**
   * Creates a block from the pending flyout block and connects it to the given connection.
   *
   * @param targetConnection The workspace connection to connect the new block to.
   */
  private placePendingBlockAtConnection(
    targetConnection: Blockly.RenderedConnection,
  ): void {
    if (!this.pendingFlyoutBlock) return;

    const flyout = this.workspace.getFlyout();
    if (!flyout) {
      this.cancelPendingFlyoutInsertion();
      return;
    }

    // Create a new event group for this operation
    const existingGroup = Blockly.Events.getGroup();
    if (!existingGroup) {
      Blockly.Events.setGroup(true);
    }

    try {
      // Create the block on the main workspace from the flyout template
      const newBlock = flyout.createBlock(this.pendingFlyoutBlock);

      // Render to get the sizing right
      newBlock.render();

      // Find the matching connection on the new block
      const newBlockConnections = newBlock.getConnections_(false);
      let localConnection: Blockly.RenderedConnection | null = null;

      // Match connection types to find the right local connection
      for (const conn of newBlockConnections) {
        const renderedConn = conn as Blockly.RenderedConnection;
        // Match OUTPUT→INPUT, PREVIOUS→NEXT, NEXT→PREVIOUS
        if (
          (renderedConn.type === Blockly.ConnectionType.OUTPUT_VALUE &&
            targetConnection.type === Blockly.ConnectionType.INPUT_VALUE) ||
          (renderedConn.type === Blockly.ConnectionType.PREVIOUS_STATEMENT &&
            targetConnection.type === Blockly.ConnectionType.NEXT_STATEMENT) ||
          (renderedConn.type === Blockly.ConnectionType.NEXT_STATEMENT &&
            targetConnection.type === Blockly.ConnectionType.PREVIOUS_STATEMENT)
        ) {
          // Verify compatibility
          if (this.workspace.connectionChecker.canConnect(
            renderedConn,
            targetConnection,
            false,
            Infinity,
          )) {
            localConnection = renderedConn;
            break;
          }
        }
      }

      if (localConnection) {
        // Connect the blocks
        localConnection.connect(targetConnection);
      } else {
        // If no connection found, just position near the target
        const workspaceCoords = new Blockly.utils.Coordinate(
          targetConnection.x,
          targetConnection.y,
        );
        newBlock.moveTo(workspaceCoords);
      }

      // Select the new block
      Blockly.common.setSelected(newBlock);

    } finally {
      // Clean up event group if we created one
      if (!existingGroup) {
        Blockly.Events.setGroup(false);
      }
    }

    // Clear the pending state
    this.cancelPendingFlyoutInsertion();
  }

  /**
   * Cancels the pending flyout insertion and clears highlights.
   */
  cancelPendingFlyoutInsertion(): void {
    if (this.pendingHighlighter) {
      this.pendingHighlighter.dispose();
      this.pendingHighlighter = null;
    }
    this.pendingFlyoutBlock = null;
  }

  /**
   * Shows placement highlights for a flyout block, or auto-places if no connections available.
   * Used when clicking on flyout blocks with sticky mode triggers enabled.
   *
   * @param flyoutBlock The flyout block template to create and place.
   * @param event The click event (unused, kept for signature compatibility).
   */
  private insertFlyoutBlockIntoStickyMode(
    flyoutBlock: Blockly.BlockSvg,
    event: MouseEvent,
  ): void {
    this.showFlyoutBlockPlacementHighlights(flyoutBlock);
  }

  /**
   * Handles pointerdown on a flyout block.
   * Called when we've intercepted the event before Blockly can process it.
   *
   * @param flyoutBlock The flyout block that was clicked.
   */
  private handleFlyoutBlockPointerDown(flyoutBlock: Blockly.BlockSvg): void {
    this.workspace.getAudioManager().preload();

    // Show placement highlights or auto-place
    this.showFlyoutBlockPlacementHighlights(flyoutBlock);

    // Set flag to ignore the subsequent click event
    this.ignoreNextClick = true;
  }

  /**
   * Auto-places a flyout block using smart placement heuristics.
   * Follows the same pattern as keyboard Enter to insert from flyout.
   *
   * @param flyoutBlock The flyout block template to create and place.
   */
  private autoPlaceFlyoutBlock(flyoutBlock: Blockly.BlockSvg): void {
    const flyout = this.workspace.getFlyout();
    if (!flyout) {
      return;
    }

    const navigation = this.navigationController.getNavigation();

    // Create a new event group for this operation
    const existingGroup = Blockly.Events.getGroup();
    if (!existingGroup) {
      Blockly.Events.setGroup(true);
    }

    try {
      // Note: We use workspace cursor position (getCurNode) rather than DOM focus
      // (findFocusedNode) because when inserting from flyout, DOM focus is on the
      // flyout workspace, not the main workspace. The cursor position is preserved
      // and represents where the user was positioned before opening the flyout.
      const stationaryNode =
        Blockly.FocusableTreeTraverser.findFocusedNode(this.workspace) ??
        this.workspace.getRestoredFocusableNode(null);


      // Create the block on the main workspace (same as enter.ts createNewBlock)
      const newBlock = flyout.createBlock(flyoutBlock);
      newBlock.render();
      // Connections are not tracked when block is first created
      newBlock.setConnectionTracking(true);

      // Find insert point AFTER creating block (block must exist for connection checks)
      const insertPoint = stationaryNode
        ? navigation.findInsertStartPoint(stationaryNode, newBlock)
        : null;


      // If insert point found, connect the block
      if (insertPoint) {
        navigation.insertBlock(newBlock, insertPoint);
      }

      // If block is still a top-level block (not connected), position it nicely
      if (this.workspace.getTopBlocks().includes(newBlock)) {
        this.positionNewTopLevelBlock(newBlock);
      }

      // Transfer focus to the new block on the workspace.
      // Since we prevented default on pointerdown, Blockly won't set focus to flyout.
      // We just need to set focus to the new block after rendering completes.
      Blockly.renderManagement.finishQueuedRenders().then(() => {
        const blockElement = newBlock.getFocusableElement();
        if (blockElement) {
          blockElement.focus();
        }
        Blockly.getFocusManager().focusNode(newBlock);
      }).catch((error) => {
        // Non-critical: focus/scroll failed, but block was created successfully
        console.debug('Failed to focus new block after render:', error);
      });

    } finally {
      // Clean up event group if we created one
      if (!existingGroup) {
        Blockly.Events.setGroup(false);
      }
    }
  }

  /**
   * Position a new top-level block to avoid overlap.
   * Simplified version of enter.ts positionNewTopLevelBlock.
   *
   * @param newBlock The top-level block to position.
   */
  private positionNewTopLevelBlock(newBlock: Blockly.BlockSvg): void {
    // Position for first block on empty workspace (workspace coordinates)
    const initialX = 50;
    const initialY = 50;
    // Vertical gap between stacked block groups
    const spacing = 20;

    const filteredTopBlocks = this.workspace
      .getTopBlocks(true)
      .filter((block) => block.id !== newBlock.id);

    if (filteredTopBlocks.length === 0) {
      // Empty workspace - position at top-left
      newBlock.moveTo(new Blockly.utils.Coordinate(initialX, initialY));
      return;
    }

    // Find the bottom of the last block stack and position below it
    const lastBlock = filteredTopBlocks[filteredTopBlocks.length - 1];
    let bottomBlock: Blockly.BlockSvg = lastBlock;
    while (bottomBlock.getNextBlock()) {
      bottomBlock = bottomBlock.getNextBlock()!;
    }

    const lastPos = bottomBlock.getRelativeToSurfaceXY();
    const lastHeight = bottomBlock.getHeightWidth().height;
    newBlock.moveTo(
      new Blockly.utils.Coordinate(lastPos.x, lastPos.y + lastHeight + spacing),
    );
  }

  /**
   * Checks if a click is on a field element by inspecting the DOM tree.
   * More reliable than gesture-based detection for events that fire after gesture disposal.
   * Only detects truly interactive/editable fields, not static text labels.
   *
   * @param target The event target element.
   */
  private isClickOnField(target: Element): boolean {
    if (!target) return false;

    // First check if we're even within a block
    const blockAncestor = target.closest('.blocklyBlock');
    if (!blockAncestor) return false;

    // Check if target or any ancestor (within the block) is an editable field.
    // Using closest() is more reliable than manual parentElement traversal for SVG elements.
    const fieldSelector =
      '.blocklyEditableField, .blocklyDropdownField, .blocklyEditableText, ' +
      '.blocklyDropdownText, .blocklyFieldDropdown, .blocklyFieldTextInput, ' +
      '.blocklyFieldNumber, .blocklyFieldColour, .blocklyFieldCheckbox, ' +
      '.blocklyFieldAngle, .blocklyDropDownDiv';

    const fieldAncestor = target.closest(fieldSelector);

    // Return true if we found a field ancestor that's inside the block
    return fieldAncestor !== null && blockAncestor.contains(fieldAncestor);
  }

  /**
   * Checks if a double-click event is on a field element.
   * Uses Blockly's gesture system for reliable field detection.
   *
   * @param target
   */
  private isDoubleClickOnField(target: Element): boolean {
    const workspace = this.workspace;
    const currentGesture = (workspace as any).currentGesture_;

    if (currentGesture && (currentGesture as any).startField) {
      return true;
    }

    // Fall back to DOM-based detection
    return this.isClickOnField(target);
  }

  /**
   * Accepts the current connection candidate from the drag strategy.
   */
  private acceptConnectionCandidate() {
    if (!this.isActive()) return;
    this.exit('finish');
  }

  /**
   * Checks if the given screen coordinates are over the trashcan/bin.
   *
   * @param clientX Screen X coordinate.
   * @param clientY Screen Y coordinate.
   * @returns True if the coordinates are over the trashcan.
   */
  private isClickOnBin(clientX: number, clientY: number): boolean {
    const trashcanElement = document.querySelector('.blocklyTrash');
    if (!trashcanElement) {
      return false;
    }

    // Check if click is on zoom controls - exclude these from bin detection
    const zoomElement = document.querySelector('.blocklyZoom');
    if (zoomElement) {
      const zoomRect = zoomElement.getBoundingClientRect();
      if (
        clientX >= zoomRect.left &&
        clientX <= zoomRect.right &&
        clientY >= zoomRect.top &&
        clientY <= zoomRect.bottom
      ) {
        return false; // Click is on zoom controls, not the bin
      }
    }

    // Check if click is on a toast - exclude these from bin detection
    const toastElement = document.querySelector('.blocklyToast');
    if (toastElement) {
      const toastRect = toastElement.getBoundingClientRect();
      if (
        clientX >= toastRect.left &&
        clientX <= toastRect.right &&
        clientY >= toastRect.top &&
        clientY <= toastRect.bottom
      ) {
        return false; // Click is on toast, not the bin
      }
    }

    const rect = trashcanElement.getBoundingClientRect();

    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  /**
   * Deletes the sticky block when dropped on the bin.
   */
  private deleteBlockOnBin() {
    const info = this.stickyModes.get(this.workspace);
    if (!info) return;

    const blockToDelete = info.block;
    this.exit('abort');

    // Unplug with healStack to preserve children
    blockToDelete.unplug(true);
    blockToDelete.dispose();
  }

  /**
   * Gets a block that has an intentional highlight (solid outline).
   * This includes blocks with active keyboard focus or mouse selection,
   * but NOT passive focus (dimmer outline when flyout/toolbox has focus).
   *
   * @returns The intentionally highlighted block, or null if none.
   */
  private getIntentionallyHighlightedBlock(): Blockly.BlockSvg | null {
    let block: Blockly.BlockSvg | null = null;

    // Check keyboard nav cursor first
    const cursor = this.workspace.getCursor();
    if (cursor) {
      const curNode = cursor.getCurNode();
      if (curNode) {
        if (curNode instanceof Blockly.BlockSvg) {
          block = curNode;
        } else if (
          'getSourceBlock' in curNode &&
          typeof (curNode as any).getSourceBlock === 'function'
        ) {
          block = (curNode as any).getSourceBlock();
        }
      }
    }

    // If cursor block is disposed, treat as no block (fall through to getSelected)
    if (block?.isDisposed()) {
      block = null;
    }

    // If no valid cursor block, check for mouse-selected block
    if (!block) {
      const selected = Blockly.common.getSelected();
      if (
        selected &&
        selected instanceof Blockly.BlockSvg &&
        selected.workspace === this.workspace
      ) {
        block = selected;
      }
    }

    if (!block || block.isDisposed()) {
      return null;
    }

    // Check for intentional highlight (solid outline) - NOT passive
    const pathElement = block.pathObject?.svgPath;
    const blockSvgGroup = block.getSvgRoot();

    // Active focus (keyboard nav on this block)
    const hasActiveFocus =
      pathElement?.classList.contains('blocklyActiveFocus') ?? false;
    // Mouse selection (solid yellow)
    const hasSelected =
      blockSvgGroup?.classList.contains('blocklySelected') ?? false;
    // Passive focus should NOT count (dimmer outline when flyout has focus)

    const hasIntentionalHighlight = hasActiveFocus || hasSelected;

    return hasIntentionalHighlight ? block : null;
  }

  /**
   * Finds a connection point at the given screen coordinates.
   *
   * @param clientX
   * @param clientY
   */
  private findConnectionAtPoint(clientX: number, clientY: number): any {
    const info = this.stickyModes.get(this.workspace);
    if (!info) return null;

    const dragStrategy = (info.block as any)?.dragStrategy;
    if (dragStrategy && dragStrategy.connectionHighlighter) {
      const highlightedConnection =
        dragStrategy.connectionHighlighter.findConnectionAtPoint(
          clientX,
          clientY,
        );

      if (highlightedConnection) {
        const stickyConnections = info.block.getConnections_(true);
        if (stickyConnections) {
          for (const stickyConnection of stickyConnections) {
            const connectionChecker = this.workspace.connectionChecker;
            if (
              connectionChecker.canConnect(
                stickyConnection,
                highlightedConnection,
                true,
                Infinity,
              )
            ) {
              return {
                connection: highlightedConnection,
                stickyConnection: stickyConnection,
                distance: 0,
                isHighlighted: true,
              };
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Connects the sticky block to a specific connection point.
   *
   * @param connectionInfo
   * @param clientX
   * @param clientY
   */
  private connectToClickedConnection(
    connectionInfo: any,
    clientX: number,
    clientY: number,
  ) {
    const info = this.stickyModes.get(this.workspace);
    if (!info) return;

    const {connection, stickyConnection} = connectionInfo;

    const dragStrategy = this.getDragStrategy(info.block);
    if (dragStrategy) {
      dragStrategy.connectionCandidate = {
        local: stickyConnection,
        neighbour: connection,
        distance: 0,
      };
    }

    this.exit('finish');
  }

  /**
   * Resets the sticky mode UI state.
   * Called after mover.finishMove() or mover.abortMove().
   */
  private resetStickyState() {
    const info = this.stickyModes.get(this.workspace);
    if (info) {
      info.block.getSvgRoot().classList.remove('blockly-sticky-mode');
    }

    this.stickyModes.delete(this.workspace);
    this.ignoreNextClick = false;

    // Do NOT call focusNode(workspace) here: it triggers Blockly's scroll-to-cursor
    // via a deferred rAF that runs before postDragEndCleanup's rAF, causing an
    // unwanted scroll jump on fallback. focusNode(block) in that rAF restores focus.

    // Clear touch identifier to prevent stuck gestures
    try {
      Blockly.Touch.clearTouchIdentifier();
      setTimeout(() => {
        Blockly.Touch.clearTouchIdentifier();
      }, 0);
    } catch (e) {
      // Silently fail
    }
  }

  /**
   * Exits sticky mode by returning the block to its original start position.
   * Used when clicking on empty workspace with no connection candidate.
   */
  private exitStickyModeAndDropToStart() {
    const info = this.stickyModes.get(this.workspace);
    if (!info) return;

    // Save scroll position before the fallback so we can restore it afterwards.
    const savedScrollX = this.workspace.scrollX;
    const savedScrollY = this.workspace.scrollY;

    // Use abortMove (not finishMove) so Blockly triggers revertDrag, which
    // properly reconnects the block to its original parent connection. finishMove
    // leaves the block floating with parent=none because it drops without revert.
    // setClickAndStickMode is handled inside abortMove → unpatchDragStrategy.
    if (this.mover.isMoving(this.workspace)) {
      this.mover.abortMove(this.workspace);
    }

    this.resetStickyState();

    // Restore scroll after the mover's rAF (both rAFs are queued from the same
    // event handler so they run FIFO in the same animation frame — ours last).
    requestAnimationFrame(() => {
      this.workspace.scroll(savedScrollX, savedScrollY);
    });
  }

  /**
   * Exits sticky mode by dropping the block at the specified or current position.
   *
   * @param clientX Optional screen X coordinate where to drop the block
   * @param clientY Optional screen Y coordinate where to drop the block
   */
  private exitStickyModeAndDrop(clientX?: number, clientY?: number) {
    const info = this.stickyModes.get(this.workspace);
    if (!info) {
      return;
    }

    // Clear connection candidate - Blockly will recalculate from final position
    const dragStrategy = this.getDragStrategy(info.block);
    if (dragStrategy) {
      dragStrategy.connectionCandidate = null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const moveInfo = (this.mover as any)?.moves?.get(this.workspace);

    // Update position if coordinates provided
    if (
      clientX !== undefined &&
      clientY !== undefined &&
      info.block &&
      !info.block.isDisposed()
    ) {
      const targetWorkspaceCoords =
        Blockly.utils.svgMath.screenToWsCoordinates(
          this.workspace,
          new Blockly.utils.Coordinate(clientX, clientY),
        );

      if (moveInfo) {
        const currentX = moveInfo.startLocation.x + moveInfo.totalDelta.x;
        const currentY = moveInfo.startLocation.y + moveInfo.totalDelta.y;

        const additionalDeltaX = targetWorkspaceCoords.x - currentX;
        const additionalDeltaY = targetWorkspaceCoords.y - currentY;

        moveInfo.totalDelta.x += additionalDeltaX;
        moveInfo.totalDelta.y += additionalDeltaY;

        // Move block directly to ensure positioning is correct
        info.block.moveBy(additionalDeltaX, additionalDeltaY);
      }
    }

    this.setClickAndStickMode(info.block, false);

    if (this.mover && this.mover.isMoving(this.workspace)) {
      this.mover.finishMove(this.workspace);
    }

    this.resetStickyState();
  }
}
