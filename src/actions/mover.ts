/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IDragger,
  IDragStrategy,
  RenderedConnection,
  IDraggable,
  IFocusableNode,
  IBoundedElement,
  ISelectable,
} from 'blockly';
import {
  Connection,
  dragging,
  getFocusManager,
  registry,
  utils,
  WorkspaceSvg,
  ShortcutRegistry,
  BlockSvg,
  comments,
} from 'blockly';
import * as Constants from '../constants';
import {Direction, getXYFromDirection} from '../drag_direction';
import {KeyboardDragStrategy} from '../keyboard_drag_strategy';
import {Navigation} from '../navigation';
import {clearMoveHints} from '../hints';
import {MoveIndicatorBubble} from '../move_indicator';
import {isWorkspaceElement, isBlocklyUIElement} from '../dom_utils';

/**
 * The distance to move an item, in workspace coordinates, when
 * making an unconstrained move.
 */
const UNCONSTRAINED_MOVE_DISTANCE = 20;

/**
 * The amount of additional padding to include during a constrained move.
 */
const CONSTRAINED_ADDITIONAL_PADDING = 70;

/**
 * Identifier for a keyboard shortcut that commits the in-progress move.
 */
export const COMMIT_MOVE_SHORTCUT = 'commitMove';

/**
 * Whether this is an insert or a move.
 */
export enum MoveType {
  /**
   * An insert will remove the block if the move is aborted.
   */
  Insert,
  /**
   * A regular move of a pre-existing block.
   */
  Move,
}

/**
 * Low-level code for moving elements with keyboard shortcuts.
 */
export class Mover {
  /**
   * Map of moves in progress.
   *
   * An entry for a given workspace in this map means that the this
   * Mover is moving an element on that workspace, and will disable
   * normal cursor movement until the move is complete.
   */
  protected moves: Map<WorkspaceSvg, MoveInfo> = new Map();

  /** Original drag strategies per-block (WeakMap for automatic garbage collection). */
  private oldDragStrategies: WeakMap<BlockSvg, IDragStrategy> = new WeakMap();

  private moveIndicator?: MoveIndicatorBubble;

  /** Whether connection highlighting is enabled for moves. */
  private highlightConnections: boolean;

  /** Whether to use fatter connection highlights with larger click targets. */
  private fatterConnections: boolean = true;

  /** Connection highlight size: minimal, medium, or large. */
  private connectionSize: 'minimal' | 'medium' | 'large' = 'medium';

  /** Optional callback to check if auto-scrolling should be disabled. */
  private shouldDisableAutoScroll?: () => boolean;

  /** Whether to use single-block drag mode (vs stack drag). */
  private singleBlockDragMode: boolean = false;

  constructor(
    protected navigation: Navigation,
    highlightConnections = true,
    shouldDisableAutoScroll?: () => boolean,
  ) {
    this.highlightConnections = highlightConnections;
    this.shouldDisableAutoScroll = shouldDisableAutoScroll;
  }

  /**
   * Returns true iff we are able to begin moving the draggable element which
   * currently has focus on the given workspace.
   *
   * @param workspace The workspace to move on.
   * @param draggable The draggable element to try to drag.
   * @returns True iff we can begin a move.
   */
  canMove(workspace: WorkspaceSvg, draggable: IDraggable) {
    return !!(
      this.navigation.getState() === Constants.STATE.WORKSPACE &&
      this.navigation.canCurrentlyEdit(workspace) &&
      !this.moves.has(workspace) && // No move in progress.
      draggable?.isMovable()
    );
  }

  /**
   * Returns true iff we are currently moving an element on the given
   * workspace.
   *
   * @param workspace The workspace we might be moving on.
   * @returns True iff we are moving.
   */
  isMoving(workspace: WorkspaceSvg) {
    return (
      this.navigation.canCurrentlyEdit(workspace) && this.moves.has(workspace)
    );
  }

  /**
   * Returns the draggable element currently being moved on the given
   * workspace, or undefined if no move is in progress.
   *
   * @param workspace The workspace to check.
   * @returns The draggable being moved, or undefined.
   */
  getDraggable(workspace: WorkspaceSvg) {
    return this.moves.get(workspace)?.draggable;
  }

  /**
   * Enable or disable connection highlighting during move operations.
   *
   * @param enabled Whether to show connection highlights.
   */
  setHighlightConnections(enabled: boolean): void {
    this.highlightConnections = enabled;
  }

  /**
   * Enable or disable fatter connection highlights.
   *
   * @param enabled Whether to use fatter connections with larger click targets.
   */
  setFatterConnections(enabled: boolean): void {
    this.fatterConnections = enabled;
    this.connectionSize = enabled ? 'medium' : 'minimal';
    // Update any active drag strategies
    for (const [_workspace, moveInfo] of this.moves) {
      const dragStrategy = (moveInfo.draggable as any).dragStrategy;
      if (dragStrategy instanceof KeyboardDragStrategy) {
        dragStrategy.setFatterConnections(enabled);
      }
    }
  }

  /**
   * Set the connection highlight size.
   *
   * @param size The size level: 'minimal', 'medium', or 'large'.
   */
  setConnectionSize(size: 'minimal' | 'medium' | 'large'): void {
    this.connectionSize = size;
    this.fatterConnections = size !== 'minimal';
    // Update any active drag strategies
    for (const [_workspace, moveInfo] of this.moves) {
      const dragStrategy = (moveInfo.draggable as any).dragStrategy;
      if (dragStrategy instanceof KeyboardDragStrategy) {
        dragStrategy.setConnectionSize(size);
      }
    }
  }

  /**
   * Set whether to use single-block drag mode.
   * When enabled: single-block drag by default, Ctrl/Cmd for stack drag.
   * When disabled: stack drag by default, Ctrl/Cmd for single-block.
   *
   * @param enabled Whether to use single-block drag by default.
   */
  setSingleBlockDragMode(enabled: boolean): void {
    this.singleBlockDragMode = enabled;
    // Update any active drag strategies
    for (const [_workspace, moveInfo] of this.moves) {
      const dragStrategy = (moveInfo.draggable as any).dragStrategy;
      if (dragStrategy instanceof KeyboardDragStrategy) {
        dragStrategy.setSingleBlockDragMode(enabled);
      }
    }
  }

  /**
   * Start moving the currently-focused item on workspace, if
   * possible.
   *
   * Should only be called if canMove has returned true.
   *
   * @param workspace The workspace we might be moving on.
   * @param draggable The element to start dragging.
   * @param moveType Whether this is an insert or a move.
   * @param startPoint Where to start the move, or null to use the current
   *     location if any.
   * @returns True iff a move has successfully begun.
   * @param onMoveFinished Optional callback when move finishes.
   * @param isClickAndStick Whether this move is a click-and-stick operation.
   */
  startMove(
    workspace: WorkspaceSvg,
    draggable: IDraggable & IFocusableNode & IBoundedElement & ISelectable,
    moveType: MoveType,
    startPoint: RenderedConnection | null,
    onMoveFinished?: () => void,
    isClickAndStick = false,
  ) {
    if (draggable instanceof BlockSvg) {
      this.patchDragStrategy(draggable, moveType, startPoint, onMoveFinished, isClickAndStick);
    } else if (draggable instanceof comments.RenderedWorkspaceComment) {
      this.moveIndicator = new MoveIndicatorBubble(draggable);
    }
    // Begin dragging element.
    const DraggerClass = registry.getClassFromOptions(
      registry.Type.BLOCK_DRAGGER,
      workspace.options,
      true,
    );
    if (!DraggerClass) throw new Error('no Dragger registered');
    const dragger = new DraggerClass(draggable, workspace);

    // Set up a blur listener to end the move if the user clicks away
      const blurListener = (evt: Event) => {
      const event = evt as FocusEvent;

      const dragStrategy = (draggable as any).dragStrategy;
      const isClickAndStick = dragStrategy?.isClickAndStickMode?.();

      const newFocusTarget = event.relatedTarget as any;
      const activeElement = document.activeElement;

      // Special case: if newFocusTarget is null and activeElement is body,
      // it means we clicked on a non-focusable element (like divs in options panel).
      // This is most likely clicking outside Blockly UI, so abort the move.
      const blurredToBody = !newFocusTarget && activeElement?.tagName === 'BODY';

      if (blurredToBody) {
        this.abortMove(workspace);
        return;
      }

      // Check if we explicitly clicked on a Blockly UI element
      const newTargetIsBlockly = newFocusTarget ? isBlocklyUIElement(newFocusTarget) : false;
      const activeIsBlockly = activeElement && activeElement.tagName !== 'BODY' ? isBlocklyUIElement(activeElement) : false;
      const clickedOutsideBlockly = newFocusTarget && !newTargetIsBlockly && !activeIsBlockly;

      if (clickedOutsideBlockly) {
        // Abort the move if clicking outside the Blockly UI entirely
        this.abortMove(workspace);
        return;
      }

      if (!isClickAndStick) {
        // In normal move mode: check if we're clicking on a connection highlight
        // Check if the click target is a connection highlight or its descendant
        const isConnectionHighlight =
          (newFocusTarget && this.isConnectionHighlightElement(newFocusTarget)) ||
          (activeElement && this.isConnectionHighlightElement(activeElement));

        // Don't auto-finish if clicking on a connection highlight
        // The connection click handler will finish the move
        if (!isConnectionHighlight) {
          this.finishMove(workspace);
        }
        return;
      }

      // In click-and-stick mode: only auto-finish if focus moved to meaningful UI
      const isWorkspaceBackground =
        isWorkspaceElement(newFocusTarget) ||
        isWorkspaceElement(activeElement);

      if (!isWorkspaceBackground) {
        this.finishMove(workspace);
      }
    };
    // Record that a move is in progress and start dragging.
    workspace.setKeyboardMoveInProgress(true);
    const info = new MoveInfo(workspace, draggable, dragger, blurListener, onMoveFinished);
    this.moves.set(workspace, info);
    // Begin drag.
    dragger.onDragStart(info.fakePointerEvent('pointerdown'));
    // DON'T call updateTotalDelta() here - totalDelta should start at (0, 0)
    // The preview offset shown by forceShowPreview() is temporary visual feedback
    // and should NOT be reflected in totalDelta until the user actually moves
    // In case a block is detached, ensure that it still retains focus
    // (otherwise dragging will break). This is also the point a new block's
    // initial insert position is scrolled into view.
    workspace.getCursor().setCurNode(draggable);
    draggable.getFocusableElement().addEventListener('blur', blurListener);

    // Register a keyboard shortcut under the key combos of all existing
    // keyboard shortcuts that commits the move before allowing the real
    // shortcut to proceed. This avoids all kinds of fun brokenness when
    // deleting/copying/otherwise acting on a element in move mode.
    const shortcutKeys = Object.values(ShortcutRegistry.registry.getRegistry())
      .flatMap((shortcut) => shortcut.keyCodes)
      .filter((keyCode) => {
        return (
          keyCode &&
          ![
            utils.KeyCodes.RIGHT,
            utils.KeyCodes.LEFT,
            utils.KeyCodes.UP,
            utils.KeyCodes.DOWN,
            utils.KeyCodes.ENTER,
            utils.KeyCodes.ESC,
            utils.KeyCodes.M,
            utils.KeyCodes.BACKSPACE,
            utils.KeyCodes.DELETE,
          ].includes(
            typeof keyCode === 'number'
              ? keyCode
              : parseInt(`${keyCode.split('+').pop()}`),
          )
        );
      })
      // Convince TS there aren't undefined values.
      .filter((keyCode): keyCode is string | number => !!keyCode);

    const commitMoveShortcut = {
      name: COMMIT_MOVE_SHORTCUT,
      preconditionFn: (workspace: WorkspaceSvg) => {
        return !!this.moves.get(workspace);
      },
      callback: (workspace: WorkspaceSvg) => {
        this.finishMove(workspace);
        return false;
      },
      keyCodes: shortcutKeys,
      allowCollision: true,
    };

    ShortcutRegistry.registry.register(commitMoveShortcut);

    return true;
  }

  /**
   * Finish moving the currently-focused item on workspace.
   *
   * Should only be called if isMoving has returned true.
   *
   * @param workspace The workspace on which we are moving.
   * @returns True iff move successfully finished.
   */
  finishMove(workspace: WorkspaceSvg) {
    if (!this.moves.has(workspace)) {
      return false;
    }

    const info = this.preDragEndCleanup(workspace);

    // Compute the target position for the block before calling onDragEnd.
    //
    // For click-and-stick with a connection candidate: position the block so that
    // its local connection aligns exactly with the neighbour connection. This prevents
    // the target block from jumping (e.g. when inserting at the top of a stack, the
    // target stack stays put and the dragged block slides into place above it).
    //
    // Without this, moveDuringDrag would place the block at the mouse position
    // (startLoc + totalDelta), which may be far from the snap position, causing
    // Blockly to reposition the target block to compensate.
    //
    // For keyboard moves (non-click-stick) or drops with no candidate: use the
    // standard startLoc + totalDelta to undo any forceShowPreview offset.
    let targetPos: utils.Coordinate;
    if (info.draggable instanceof BlockSvg) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dragStrategy = (info.draggable as any).dragStrategy;
      // Note: don't check isClickAndStickMode() — it's already been set to false
      // by StickyModeController.exit() before finishMove() is called. Instead,
      // check for a connection candidate directly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const candidate = (dragStrategy as any)?.connectionCandidate;

      if (candidate) {
        // Align block so local connection lands exactly on neighbour connection.
        //
        // We use startLocation (not the drift position after forceShowPreview) because
        // connection positions (local.x/y) are not updated for the forceShowPreview drift
        // that happens during onDragStart. They reflect the block at startLocation.
        // Using the post-drift position would carry a permanent offset equal to the drift.
        //
        // targetPos = startLocation + (neighbour - local)
        const {local, neighbour} = candidate;
        targetPos = new utils.Coordinate(
          info.startLocation.x + neighbour.x - local.x,
          info.startLocation.y + neighbour.y - local.y,
        );
      } else {
        targetPos = new utils.Coordinate(
          info.startLocation.x + info.totalDelta.x,
          info.startLocation.y + info.totalDelta.y,
        );
      }
    } else {
      targetPos = new utils.Coordinate(
        info.startLocation.x + info.totalDelta.x,
        info.startLocation.y + info.totalDelta.y,
      );
    }

    // Move the block to the correct position before calling onDragEnd.
    if (info.draggable instanceof BlockSvg) {
      info.draggable.moveDuringDrag(targetPos);
    }

    const savedScrollX = workspace.scrollX;
    const savedScrollY = workspace.scrollY;

    info.dragger.onDragEnd(
      info.fakePointerEvent('pointerup'),
      new utils.Coordinate(0, 0),
    );

    if (workspace.scrollX !== savedScrollX || workspace.scrollY !== savedScrollY) {
      workspace.scroll(savedScrollX, savedScrollY);
    }

    this.postDragEndCleanup(workspace, info);
    return true;
  }

  /**
   * Abort moving the currently-focused item on workspace.
   *
   * Should only be called if isMoving has returned true.
   *
   * @param workspace The workspace on which we are moving.
   * @returns True iff move successfully aborted.
   */
  abortMove(workspace: WorkspaceSvg) {
    if (!this.moves.has(workspace)) {
      return false;
    }

    const info = this.preDragEndCleanup(workspace);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dragStrategy = (info.draggable as any)
      .dragStrategy as KeyboardDragStrategy;
    this.patchDragger(info.dragger as dragging.Dragger, dragStrategy.moveType);

    // Save the position so we can put the cursor in a reasonable spot.
    // @ts-expect-error Access to private property connectionCandidate.
    const target = dragStrategy.connectionCandidate?.neighbour;

    // Prevent the strategy connecting the block so we just delete one block.
    // @ts-expect-error Access to private property connectionCandidate.
    dragStrategy.connectionCandidate = null;

    info.dragger.onDragEnd(
      info.fakePointerEvent('pointerup'),
      info.startLocation,
    );

    if (dragStrategy.moveType === MoveType.Insert && target) {
      workspace.getCursor().setCurNode(target);
    }

    this.postDragEndCleanup(workspace, info);
    return true;
  }

  /**
   * Common clean-up for finish/abort.
   *
   * @param workspace The workspace on which we are moving.
   * @returns The info for the element.
   */
  private preDragEndCleanup(workspace: WorkspaceSvg) {
    ShortcutRegistry.registry.unregister(COMMIT_MOVE_SHORTCUT);
    clearMoveHints(workspace);

    const info = this.moves.get(workspace);
    if (!info) throw new Error('no move info for workspace');

    // Remove the blur listener before ending the drag
    info.draggable
      .getFocusableElement()
      .removeEventListener('blur', info.blurListener);

    return info;
  }

  /**
   * Common clean-up for finish/abort.
   *
   * @param workspace The workspace on which we are moving.
   * @param info The info for the element.
   */
  private postDragEndCleanup(workspace: WorkspaceSvg, info: MoveInfo) {
    this.moveIndicator?.dispose();
    this.moveIndicator = undefined;
    if (info.draggable instanceof BlockSvg) {
      this.unpatchDragStrategy(info.draggable);
    }
    this.moves.delete(workspace);
    workspace.setKeyboardMoveInProgress(false);

    if (info.onMoveFinished) {
      info.onMoveFinished();
    }

    // Render on next frame for proper block positioning
    requestAnimationFrame(() => {
      if (info.draggable instanceof BlockSvg) {
        let rootBlock = info.draggable;
        let parent = info.draggable.getParent();
        while (parent instanceof BlockSvg) {
          rootBlock = parent;
          parent = parent.getParent() as BlockSvg;
        }

        rootBlock.render();

        if (rootBlock !== info.draggable) {
          info.draggable.render();
        }
      }

      workspace.render();

      // scrollCurrentElementIntoView looks up this.moves.get(workspace) which is
      // already cleared at this point — call scrollBoundsIntoView directly.
      if (info.draggable instanceof BlockSvg && !this.shouldDisableAutoScroll?.()) {
        workspace.scrollBoundsIntoView(info.draggable.getBoundingRectangleWithoutChildren());
      }

      getFocusManager().focusNode(info.draggable);
    });
  }

  /**
   * Action to move the item being moved in the given direction,
   * constrained to valid attachment points (if any).
   *
   * @param workspace The workspace to move on.
   * @param direction The direction to move the dragged item.
   * @returns True iff this action applies and has been performed.
   */
  moveConstrained(workspace: WorkspaceSvg, direction: Direction) {
    if (!workspace) return false;
    const info = this.moves.get(workspace);
    if (!info) throw new Error('no move info for workspace');

    if (info.draggable instanceof comments.RenderedWorkspaceComment) {
      return this.moveUnconstrained(workspace, direction);
    }

    info.dragger.onDrag(
      info.fakePointerEvent('pointermove', direction),
      info.totalDelta.clone().scale(workspace.scale),
    );

    info.updateTotalDelta();
    this.scrollCurrentElementIntoView(
      workspace,
      CONSTRAINED_ADDITIONAL_PADDING,
    );
    return true;
  }

  /**
   * Action to move the item being moved in the given direction,
   * without constraint.
   *
   * @param workspace The workspace to move on.
   * @param direction The direction to move the dragged item.
   * @returns True iff this action applies and has been performed.
   */
  moveUnconstrained(workspace: WorkspaceSvg, direction: Direction): boolean {
    if (!workspace) return false;
    const info = this.moves.get(workspace);
    if (!info) throw new Error('no move info for workspace');

    const {x, y} = getXYFromDirection(direction);
    info.totalDelta.x += x * UNCONSTRAINED_MOVE_DISTANCE * workspace.scale;
    info.totalDelta.y += y * UNCONSTRAINED_MOVE_DISTANCE * workspace.scale;

    info.dragger.onDrag(
      info.fakePointerEvent('pointermove'),
      info.totalDelta.clone().scale(workspace.scale),
    );
    this.scrollCurrentElementIntoView(workspace);
    this.moveIndicator?.updateLocation();
    return true;
  }

  /**
   * Monkeypatch: replace the block's drag strategy and cache the old value.
   *
   * @param block The block to patch.
   * @param moveType Whether this is an insert or a move.
   * @param startPoint Where to start the move, or null to use the current
   *     location if any.
   * @param onMoveFinished
   */
  private patchDragStrategy(
    block: BlockSvg,
    moveType: MoveType,
    startPoint: RenderedConnection | null,
    onMoveFinished?: () => void,
    isClickAndStick = false,
  ) {
    // @ts-expect-error block.dragStrategy is private.
    const currentStrategy = block.dragStrategy;

    this.oldDragStrategies.set(block, currentStrategy);

    const onMoveComplete = () => {
      const workspace = block.workspace as WorkspaceSvg;
      this.finishMove(workspace);
    };

    const keyboardDragStrategy = new KeyboardDragStrategy(
      block,
      moveType,
      startPoint,
      this.highlightConnections,
      onMoveComplete,
      onMoveFinished,
    );
    keyboardDragStrategy.setFatterConnections(this.fatterConnections);
    keyboardDragStrategy.setConnectionSize(this.connectionSize);
    keyboardDragStrategy.setSingleBlockDragMode(this.singleBlockDragMode);
    if (isClickAndStick) {
      keyboardDragStrategy.setClickAndStickMode(true);
    }
    block.setDragStrategy(keyboardDragStrategy);
  }

  /**
   * Undo the monkeypatching of the block's drag strategy.
   *
   * @param block The block to patch.
   */
  private unpatchDragStrategy(block: BlockSvg) {
    try {
      // @ts-expect-error block.dragStrategy is private
      const currentStrategy = block.dragStrategy;
      if (currentStrategy instanceof KeyboardDragStrategy) {
        currentStrategy.setClickAndStickMode(false);
        currentStrategy.connectionHighlighter.clearHighlights();
      }

      const oldStrategy = this.oldDragStrategies.get(block);
      if (oldStrategy) {
        block.setDragStrategy(oldStrategy);
        this.oldDragStrategies.delete(block);
      }
    } catch (error) {
      // Silently fail during cleanup
    }
  }

  /**
   * Scrolls the current element into view.
   *
   * @param workspace The workspace to get current element from.
   * @param padding Amount of spacing to put between the bounds and the edge of
   *     the workspace's viewport.
   */
  private scrollCurrentElementIntoView(workspace: WorkspaceSvg, padding = 0) {
    if (this.shouldDisableAutoScroll?.()) {
      return;
    }

    const draggable = this.moves.get(workspace)?.draggable;
    if (draggable) {
      const bounds = (
        draggable instanceof BlockSvg
          ? draggable.getBoundingRectangleWithoutChildren()
          : draggable.getBoundingRectangle()
      ).clone();
      bounds.top -= padding;
      bounds.bottom += padding;
      bounds.left -= padding;
      bounds.right += padding;
      workspace.scrollBoundsIntoView(bounds);
    }
  }

  /**
   * Checks if an element is a connection highlight or is contained within one.
   *
   * @param element The element to check.
   * @returns True if the element is or is inside a connection highlight.
   */
  private isConnectionHighlightElement(element: any): boolean {
    if (!element || !element.classList) return false;

    // Check if this element or any ancestor has the connection highlight class
    let current = element;
    while (current) {
      if (
        current.classList?.contains('blocklyPotentialConnection') ||
        current.classList?.contains('blocklyConnectionHighlightLayer')
      ) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  /**
   * Monkeypatch: override either wouldDeleteDraggable or shouldReturnToStart,
   * based on whether this was an insertion of a new block or a movement of
   * an existing element.
   *
   * @param dragger The dragger to patch.
   * @param moveType Whether this is an insert or a move.
   */
  private patchDragger(dragger: dragging.Dragger, moveType: MoveType) {
    if (moveType === MoveType.Insert) {
      // Monkey patch dragger to trigger delete.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dragger as any).wouldDeleteDraggable = () => true;
    } else {
      // Monkey patch dragger to trigger call to draggable.revertDrag.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dragger as any).shouldReturnToStart = () => true;
    }
  }
}

/**
 * Information about the currently in-progress move for a given
 * Workspace.
 */
export class MoveInfo {
  /** Total distance moved, in workspace units. */
  totalDelta = new utils.Coordinate(0, 0);
  readonly parentNext: Connection | null = null;
  readonly parentInput: Connection | null = null;
  readonly startLocation: utils.Coordinate;
  readonly onMoveFinished?: () => void;

  constructor(
    readonly workspace: WorkspaceSvg,
    readonly draggable: IDraggable & IFocusableNode & IBoundedElement,
    readonly dragger: IDragger,
    readonly blurListener: EventListener,
    onMoveFinished?: () => void,
  ) {
    if (draggable instanceof BlockSvg) {
      this.parentNext = draggable.previousConnection?.targetConnection ?? null;
      this.parentInput = draggable.outputConnection?.targetConnection ?? null;
    }
    this.startLocation = draggable.getRelativeToSurfaceXY();
    this.onMoveFinished = onMoveFinished;
  }

  /**
   * Create a fake pointer event for dragging.
   *
   * @param type Which type of pointer event to create.
   * @param direction The direction if this movement is a constrained drag.
   * @returns A synthetic PointerEvent that can be consumed by Blockly's
   *     dragging code.
   */
  fakePointerEvent(type: string, direction?: Direction): PointerEvent {
    const coordinates = utils.svgMath.wsToScreenCoordinates(
      this.workspace,
      new utils.Coordinate(
        this.startLocation.x + this.totalDelta.x,
        this.startLocation.y + this.totalDelta.y,
      ),
    );
    const tilts = getXYFromDirection(direction);
    return new PointerEvent(type, {
      clientX: coordinates.x,
      clientY: coordinates.y,
      tiltX: tilts.x,
      tiltY: tilts.y,
    });
  }

  /**
   * The keyboard drag may have moved a block to an appropriate location
   * for a preview. Update the saved delta to reflect the element's new
   * location, so that it does not jump during the next unconstrained move.
   */
  updateTotalDelta() {
    if (this.draggable instanceof BlockSvg) {
      this.totalDelta = new utils.Coordinate(
        this.draggable.relativeCoords.x - this.startLocation.x,
        this.draggable.relativeCoords.y - this.startLocation.y,
      );
    } else {
      this.totalDelta = new utils.Coordinate(
        this.draggable.getBoundingRectangle().left - this.startLocation.x,
        this.draggable.getBoundingRectangle().top - this.startLocation.y,
      );
    }
  }
}
