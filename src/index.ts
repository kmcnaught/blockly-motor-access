/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Blockly from 'blockly/core';
import {NavigationController} from './navigation_controller';
import {enableBlocksOnDrag, reenableBlocksOnDelete} from './disabled_blocks';
import {registerHtmlToast} from './html_toast';
import {StickyModeController, TriggerMode} from './sticky_mode_controller';
import {MouseDragStrategy} from './mouse_drag_strategy';
import {scrollBoundsIntoView, centerBoundsInView} from './workspace_utilities';

// Re-export TriggerMode for external use
export {TriggerMode};

/** Plugin for keyboard navigation. */
export class KeyboardNavigation {
  /** The workspace. */
  protected workspace: Blockly.WorkspaceSvg;

  /** Keyboard navigation controller instance for the workspace. */
  private navigationController: NavigationController;

  /** Cursor for the main workspace. */
  private cursor: Blockly.LineCursor;

  /**
   * Focus ring in the workspace.
   */
  private workspaceFocusRing: Element | null = null;

  /**
   * Selection ring inside the workspace.
   */
  private workspaceSelectionRing: Element | null = null;

  /** Controller for click-and-stick functionality. */
  private stickyModeController: StickyModeController;

  /**
   * Used to restore monkey patch.
   */
  private oldWorkspaceResize:
    | InstanceType<typeof Blockly.WorkspaceSvg>['resize']
    | null = null;

  /**
   * Used to restore monkey patch.
   */
  private oldScrollBoundsIntoView:
    | InstanceType<typeof Blockly.WorkspaceSvg>['scrollBoundsIntoView']
    | null = null;

  /** Listener that centers the viewport when a block is clicked. */
  private blockClickScrollListener: ((e: Blockly.Events.Abstract) => void) | null = null;

  /**
   * Returns whether the plugin is currently in sticky mode (click-and-stick).
   *
   * @returns True if a block is in sticky mode, false otherwise.
   */
  get isInStickyMode(): boolean {
    return this.stickyModeController.isActive();
  }

  /**
   * Get the block currently in sticky mode, if any.
   *
   * @returns The block in sticky mode, or null if not in sticky mode.
   */
  get stickyBlock(): Blockly.BlockSvg | null {
    return this.stickyModeController.getActiveBlock();
  }

  /**
   * Constructs the keyboard navigation.
   *
   * @param workspace The workspace that the plugin will be added to.
   * @param options Options for plugin
   * @param options.allowCrossWorkspacePaste If true, will allow paste
   * option to appear enabled when pasting in a different workspace
   * than was copied from. Defaults to false. Set to true if using
   * cross-tab-copy-paste plugin or similar.
   * @param options.highlightConnections If true, will highlight all
   * valid connection points when entering move mode. Defaults to true.
   * Useful for improving mouse accessibility.
   */
  constructor(
    workspace: Blockly.WorkspaceSvg,
    options: {
      allowCrossWorkspacePaste?: boolean;
      highlightConnections?: boolean;
    } = {
      allowCrossWorkspacePaste: false,
      highlightConnections: true,
    },
  ) {
    this.workspace = workspace;

    this.stickyModeController = new StickyModeController(
      workspace,
      null as any, // Will be set after navigationController is created
    );

    this.navigationController = new NavigationController({
      allowCrossWorkspacePaste: options.allowCrossWorkspacePaste ?? false,
      highlightConnections: options.highlightConnections ?? true,
      // Disable auto-scroll during sticky mode to prevent jarring jumps at viewport edges
      shouldDisableAutoScroll: () => this.stickyModeController.isActive(),
    });
    this.navigationController.init();
    this.navigationController.addWorkspace(workspace);
    this.navigationController.enable(workspace);

    // Now set the navigation controller on the sticky mode controller
    (this.stickyModeController as any).navigationController = this.navigationController;

    this.cursor = new Blockly.LineCursor(workspace);

    // Add the event listener to enable disabled blocks on drag.
    workspace.addChangeListener(enableBlocksOnDrag);

    // Add the event listener to re-enable capacity-disabled blocks on delete.
    workspace.addChangeListener(reenableBlocksOnDelete);

    // Apply single-block mouse drag to existing blocks.
    for (const block of workspace.getAllBlocks(false)) {
      (block as Blockly.BlockSvg).setDragStrategy(
        new MouseDragStrategy(block as Blockly.BlockSvg),
      );
    }

    // Apply to newly created blocks (e.g. from flyout or XML load).
    workspace.addChangeListener((event) => {
      if (event.type !== Blockly.Events.BLOCK_CREATE) return;
      const blockEvent = event as Blockly.Events.BlockCreate;
      const ids = blockEvent.ids ?? (blockEvent.blockId ? [blockEvent.blockId] : []);
      for (const id of ids) {
        const block = workspace.getBlockById(id);
        if (block instanceof Blockly.BlockSvg) {
          block.setDragStrategy(new MouseDragStrategy(block));
        }
      }
    });

    this.stickyModeController.install();

    (window as any).keyboardNavigation = this;

    // Move the flyout for logical tab order.
    const flyout = workspace.getFlyout();
    if (flyout != null && flyout instanceof Blockly.Flyout) {
      // This relies on internals.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const flyoutElement = ((flyout as any).svgGroup_ as SVGElement) ?? null;
      flyoutElement?.parentElement?.insertBefore(
        flyoutElement,
        workspace.getParentSvg(),
      );
    }

    this.oldWorkspaceResize = workspace.resize;
    workspace.resize = () => {
      this.oldWorkspaceResize?.call(this.workspace);
      this.resizeWorkspaceRings();
    };

    this.oldScrollBoundsIntoView = workspace.scrollBoundsIntoView.bind(workspace);
    workspace.scrollBoundsIntoView = (bounds: Blockly.utils.Rect, _padding?: number) => {
      scrollBoundsIntoView(bounds, workspace);
    };

    // Clicking a block doesn't go through onNodeFocus→scrollBoundsIntoView
    // (the gesture guard blocks it). Listen for CLICK events which fire after
    // the gesture completes, and center the clicked block then.
    this.blockClickScrollListener = (event: Blockly.Events.Abstract) => {
      if (event.type !== Blockly.Events.CLICK) return;
      const clickEvent = event as Blockly.Events.Click;
      if (clickEvent.targetType !== Blockly.Events.ClickTarget.BLOCK) return;
      const block = workspace.getBlockById(clickEvent.blockId!);
      if (!(block instanceof Blockly.BlockSvg)) return;
      centerBoundsInView(block.getBoundingRectangle(), workspace);
    };
    workspace.addChangeListener(this.blockClickScrollListener);
    this.workspaceSelectionRing = Blockly.utils.dom.createSvgElement('rect', {
      fill: 'none',
      class: 'blocklyWorkspaceSelectionRing',
    });
    workspace.getSvgGroup().appendChild(this.workspaceSelectionRing);
    this.workspaceFocusRing = Blockly.utils.dom.createSvgElement('rect', {
      fill: 'none',
      class: 'blocklyWorkspaceFocusRing',
    });
    workspace.getSvgGroup().appendChild(this.workspaceFocusRing);
    this.resizeWorkspaceRings();

    registerHtmlToast();
  }

  private resizeWorkspaceRings() {
    if (!this.workspaceFocusRing || !this.workspaceSelectionRing) return;
    this.resizeFocusRingInternal(this.workspaceSelectionRing, 5);
    this.resizeFocusRingInternal(this.workspaceFocusRing, 0);
  }

  private resizeFocusRingInternal(ring: Element, inset: number) {
    const metrics = this.workspace.getMetrics();
    ring.setAttribute('x', (metrics.absoluteLeft + inset).toString());
    ring.setAttribute('y', (metrics.absoluteTop + inset).toString());
    ring.setAttribute(
      'width',
      Math.max(0, metrics.viewWidth - inset * 2).toString(),
    );
    ring.setAttribute(
      'height',
      Math.max(0, metrics.svgHeight - inset * 2).toString(),
    );
  }

  /**
   * Disables keyboard navigation for this navigator's workspace.
   */
  dispose() {
    this.workspaceFocusRing?.remove();
    this.workspaceSelectionRing?.remove();
    if (this.oldWorkspaceResize) {
      this.workspace.resize = this.oldWorkspaceResize;
    }
    if (this.oldScrollBoundsIntoView) {
      this.workspace.scrollBoundsIntoView = this.oldScrollBoundsIntoView;
    }
    if (this.blockClickScrollListener) {
      this.workspace.removeChangeListener(this.blockClickScrollListener);
    }

    // Remove the event listener that enables blocks on drag
    this.workspace.removeChangeListener(enableBlocksOnDrag);
    // Remove the event listener that re-enables blocks on delete
    this.workspace.removeChangeListener(reenableBlocksOnDelete);
    this.stickyModeController.uninstall();
    this.navigationController.dispose();
  }

  /**
   * Toggle visibility of a help dialog for the keyboard shortcuts.
   */
  toggleShortcutDialog(): void {
    this.navigationController.shortcutDialog.toggle(this.workspace);
  }

  /**
   * Enable or disable connection highlighting during move operations.
   *
   * @param enabled Whether to show connection highlights when moving blocks.
   */
  setHighlightConnections(enabled: boolean): void {
    this.navigationController.setHighlightConnections(enabled);
  }

  /**
   * Enable or disable fatter connection highlights.
   *
   * @param enabled Whether to use fatter connections with larger click targets.
   */
  setFatterConnections(enabled: boolean): void {
    this.navigationController.setFatterConnections(enabled);
  }

  /**
   * Set the connection highlight size.
   *
   * @param size The size level: 'minimal', 'medium', or 'large'.
   */
  setConnectionSize(size: 'minimal' | 'medium' | 'large'): void {
    this.navigationController.setConnectionSize(size);
  }

  /**
   * Set the trigger mode for entering sticky move mode.
   *
   * @param mode The trigger mode to use (DOUBLE_CLICK, SHIFT_CLICK, FOCUSED_CLICK, MODE_TOGGLE, or GRIP_CLICK).
   */
  setTriggerMode(mode: TriggerMode): void {
    this.stickyModeController.setTriggerMode(mode);
  }

  /**
   * Enable or disable keeping the block on the mouse cursor during sticky move.
   *
   * @param enabled Whether the block should follow the cursor (true) or stay at click position (false).
   */
  setKeepBlockOnMouse(enabled: boolean): void {
    this.stickyModeController.setKeepBlockOnMouse(enabled);
  }

  /**
   * Enable or disable click-to-move (sticky mode).
   *
   * @param enabled Whether to allow click-to-move functionality.
   */
  setClickToMoveEnabled(enabled: boolean): void {
    this.stickyModeController.setEnabled(enabled);
  }

  /**
   * Enable or disable single-block drag mode.
   * When enabled: single-block drag by default, Ctrl/Cmd for stack drag.
   * When disabled: stack drag by default (current behavior), Ctrl/Cmd for single-block.
   *
   * @param enabled Whether to use single-block drag by default.
   */
  setSingleBlockDragMode(enabled: boolean): void {
    this.navigationController.setSingleBlockDragMode(enabled);
  }

  /**
   * Set a callback that fires when sticky mode is entered via click.
   *
   * @param callback The callback to invoke when entering sticky mode.
   */
  setOnStickyModeEnterCallback(
    callback: (block: Blockly.BlockSvg) => void,
  ): void {
    this.stickyModeController.setOnEnterCallback(callback);
  }

  /**
   * Set a callback that fires when a keyboard move is initiated.
   *
   * @param callback The callback to invoke when starting a keyboard move.
   */
  setOnKeyboardMoveCallback(
    callback: (draggable: Blockly.IDraggable & Blockly.IFocusableNode) => void,
  ): void {
    this.navigationController.setOnKeyboardMoveCallback(callback);
  }

  /**
   * Set a callback that fires when sticky mode is exited via click.
   *
   * @param callback The callback to invoke when exiting sticky mode.
   */
  setOnStickyModeExitCallback(callback: () => void): void {
    this.stickyModeController.setOnExitCallback(callback);
  }

  /**
   * Set a callback that fires when a keyboard move finishes.
   *
   * @param callback The callback to invoke when a keyboard move finishes.
   */
  setOnMoveFinishedCallback(callback: () => void): void {
    this.navigationController.setOnMoveFinishedCallback(callback);
  }

  /**
   * Ensures the workspace cursor is initialized to a valid position.
   * This is useful after programmatically focusing the workspace to ensure
   * arrow key navigation works immediately.
   *
   * If the cursor is already on a valid node, this is a no-op.
   * Otherwise, it positions the cursor on the first block (or workspace if no blocks).
   */
  ensureWorkspaceCursorInitialized(): void {
    this.navigationController.getNavigation().defaultWorkspaceCursorPositionIfNeeded(this.workspace);
  }

  /**
   * Registers a default toolbox implementation that doesn't handle
   * keydown events, since we now handle them in this plugin. If you
   * use the default toolbox, call this function before calling
   * `Blockly.inject`. If you use a custom toolbox, override the
   * `onKeyDown_` method in your toolbox implementation to make it a no-op.
   */
  static registerNavigationDeferringToolbox() {
    this.registerNavigationDeferringToolbox();
  }

  /**
   * Register CSS used by the plugin.
   * This is broken up into sections by purpose, with some notes about
   * where it should eventually live.
   * Must be called before `Blockly.inject`.
   */
  static registerKeyboardNavigationStyles() {
    // Enable the delete icon for comments.
    //
    // This should remain in the plugin for the time being because we do
    // not want to display the delete icon by default.
    Blockly.Css.register(`
  .blocklyDeleteIcon {
    display: block;
  }
`);

    // Set variables that will be used to control the appearance of the
    // focus indicators.  Attach them to the injectionDiv since they will
    // apply to things contained therein.
    //
    // This should be moved to core, either to core/css.ts
    // or to core/renderers/.
    Blockly.Css.register(`
  .injectionDiv {
    --blockly-active-node-color: #ff6600;
    --blockly-active-tree-color: #ff6600;
    --blockly-selection-width: 5px;
  }

  /* Override Blockly's default selection stroke to use our orange color */
  .blocklySelected > .blocklyPath {
    stroke: #ff6600 !important;
  }
`);

    // Styling focusing blocks, connections and fields.
    //
    // This should be moved to core, being integrated into the
    // existing styling of renderers in core/renderers/*/constants.ts.
    //
    // Many selectors include .blocklyKeyboardNavigation to ensure keyboard
    // nav is on (via the heuristic). This class is added/removed from body.
    Blockly.Css.register(`
  /* Active focus cases: */
  /* Blocks with active focus. */
  .blocklyKeyboardNavigation
    .blocklyActiveFocus:is(.blocklyPath, .blocklyHighlightedConnectionPath),
  /* Fields with active focus, */
  .blocklyKeyboardNavigation
    .blocklyActiveFocus.blocklyField
    > .blocklyFieldRect,
  /* Icons with active focus. */
  .blocklyKeyboardNavigation
    .blocklyActiveFocus.blocklyIconGroup
    > .blocklyIconShape:first-child {
    stroke: var(--blockly-active-node-color);
    stroke-width: var(--blockly-selection-width);
  }

  /* Passive focus cases: */
  /* Blocks with passive focus except when widget/dropdown div in use. */
  .blocklyKeyboardNavigation:not(
          :has(
              .blocklyDropDownDiv:focus-within,
              .blocklyWidgetDiv:focus-within
            )
        )
    .blocklyPassiveFocus:is(
      .blocklyPath:not(.blocklyFlyout .blocklyPath),
      .blocklyHighlightedConnectionPath
    ),
  /* Fields with passive focus except when widget/dropdown div in use. */
  .blocklyKeyboardNavigation:not(
          :has(
              .blocklyDropDownDiv:focus-within,
              .blocklyWidgetDiv:focus-within
            )
        )
    .blocklyPassiveFocus.blocklyField
    > .blocklyFieldRect,
  /* Icons with passive focus except when widget/dropdown div in use. */
  .blocklyKeyboardNavigation:not(
          :has(
              .blocklyDropDownDiv:focus-within,
              .blocklyWidgetDiv:focus-within
            )
        )
    .blocklyPassiveFocus.blocklyIconGroup
    > .blocklyIconShape:first-child {
    stroke: var(--blockly-active-node-color);
    stroke-dasharray: 5px 3px;
    stroke-width: var(--blockly-selection-width);
  }

  /* Workaround for unexpectedly hidden connection path due to core style. */
  .blocklyKeyboardNavigation
    .blocklyPassiveFocus.blocklyHighlightedConnectionPath {
    display: unset !important;
  }
`);

    // Styling for focusing the toolbox and flyout.
    //
    // This should be moved to core, to core/css.ts if not to somewhere
    // more specific in core/toolbox/.
    Blockly.Css.register(`
  /* Different ways for toolbox/flyout to be the active tree: */
  /* Active focus in the flyout. */
  .blocklyKeyboardNavigation .blocklyFlyout:has(.blocklyActiveFocus),
  /* Active focus in the toolbox. */
  .blocklyKeyboardNavigation .blocklyToolbox:has(.blocklyActiveFocus),
  /* Active focus on the toolbox/flyout. */
  .blocklyKeyboardNavigation
    .blocklyActiveFocus:is(.blocklyFlyout, .blocklyToolbox) {
    outline-offset: calc(var(--blockly-selection-width) * -1);
    outline: var(--blockly-selection-width) solid
      var(--blockly-active-tree-color);
  }

  /* Show outline when toolbox/flyout is directly focused (e.g., tabbed to). */
  .blocklyKeyboardNavigation .blocklyToolbox:focus-visible,
  .blocklyKeyboardNavigation .blocklyFlyout:focus-within {
    outline-offset: calc(var(--blockly-selection-width) * -1);
    outline: var(--blockly-selection-width) solid
      var(--blockly-active-tree-color);
  }

  /* Suppress default outline. */
  .blocklyKeyboardNavigation
    .blocklyToolboxCategoryContainer:focus-visible {
    outline: none;
  }

  /* Flyout label with passive focus (e.g. just tabbed to flyout). */
  .blocklyKeyboardNavigation
    .blocklyPassiveFocus.blocklyFlyoutLabel
    > .blocklyFlyoutLabelBackground {
    stroke: var(--blockly-active-tree-color);
    stroke-width: var(--blockly-selection-width);
  }

  /* Flyout label focused via Tab key (before keyboard nav is active). */
  .blocklyFlyoutLabel:focus > .blocklyFlyoutLabelBackground,
  .blocklyFlyoutLabel:focus-visible > .blocklyFlyoutLabelBackground {
    stroke: #60a5fa;
    stroke-width: 3px;
  }

  /* Suppress default outline on flyout label - visual focus is the stroke on background. */
  .blocklyFlyoutLabel:focus,
  .blocklyFlyoutLabel:focus-visible {
    outline: none;
  }
`);

    // Styling for focusing the Workspace.
    //
    // This should be move to core, probably to core/css.ts.
    Blockly.Css.register(`
  /* Different ways for the workspace to be the active tree: */
  /* Active focus within workspace. */
  .blocklyKeyboardNavigation
    .blocklyWorkspace:has(.blocklyActiveFocus)
    .blocklyWorkspaceFocusRing,
  /* Active focus within drag layer. */
  .blocklyKeyboardNavigation
    .blocklySvg:has(~ .blocklyBlockDragSurface .blocklyActiveFocus)
    .blocklyWorkspaceFocusRing,
  /* Active focus on workspace. */
  .blocklyKeyboardNavigation
    .blocklyWorkspace.blocklyActiveFocus
    .blocklyWorkspaceFocusRing,
  /* Focus in widget/dropdown div considered to be in workspace. */
  .blocklyKeyboardNavigation:has(
    .blocklyWidgetDiv:focus-within,
    .blocklyDropDownDiv:focus-within
  )
    .blocklyWorkspace
    .blocklyWorkspaceFocusRing,
  /* Show focus ring when workspace is directly focused (e.g., tabbed to). */
  .blocklyKeyboardNavigation
    .blocklyWorkspace:focus-visible
    .blocklyWorkspaceFocusRing {
    stroke: var(--blockly-active-tree-color);
    stroke-width: calc(var(--blockly-selection-width) * 2);
  }

  /* The workspace itself is the active node. */
  .blocklyKeyboardNavigation
    .blocklyWorkspace.blocklyActiveFocus
    .blocklyWorkspaceSelectionRing {
    stroke: var(--blockly-active-node-color);
    stroke-width: var(--blockly-selection-width);
  }
  
  /* The workspace itself is the active node. */
  .blocklyKeyboardNavigation
    .blocklyBubble.blocklyActiveFocus
    .blocklyDraggable {
    stroke: var(--blockly-active-node-color);
    stroke-width: var(--blockly-selection-width);
  }
`);

    // Keyboard-nav-specific styling for the context menu.
    //
    // This should remain in the plugin for the time being because the
    // classes selected are currently only defined in the plugin.
    Blockly.Css.register(`
  .blocklyRTL .blocklyMenuItemContent .blocklyShortcutContainer {
    flex-direction: row-reverse;
  }
  .blocklyMenuItemContent .blocklyShortcutContainer {
    width: 100%;
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }
  .blocklyMenuItemContent .blocklyShortcutContainer .blocklyShortcut {
    color: #ccc;
  }
`);

    // Styling for connection highlighting during move mode.
    //
    // This should remain in the plugin for the time being because these
    // classes are specific to the keyboard navigation plugin's move functionality.
    Blockly.Css.register(`
  /* Clean highlighting for potential connection points */
  .blocklyPotentialConnection {
    stroke: #00ff00 !important;
    stroke-width: 3px !important;
    stroke-dasharray: 4,2 !important;
    /* fill is set inline to support overlapping connection logic - don't override here */
    z-index: 9999 !important;
    pointer-events: auto !important;
    display: block !important;
  }

  /* Ensure highlights are visible in keyboard navigation mode */
  .blocklyKeyboardNavigation .blocklyPotentialConnection {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  }
`);

    // Register classes used by the shortcuts modal
    Blockly.Css.register(`
:root {
  --divider-border-color: #eee;
  --key-border-color: #ccc;
  --shortcut-modal-border-color: #9aa0a6;
}

.shortcut-modal {
  border: 1px solid var(--shortcut-modal-border-color);
  border-radius: 12px;
  box-shadow: 6px 6px 32px rgba(0,0,0,.5);
  flex-direction: column;
  gap: 12px;
  margin: auto;
  max-height: 82vh;
  max-width: calc(100% - 10em);
  padding: 24px 12px 24px 32px;
  position: relative;
  z-index: 99;
}

.shortcut-modal[open] {
  display: flex;
}

.shortcut-modal .close-modal {
  border: 0;
  background: transparent;
  float: inline-end;
  margin: 0 0 0 0;
  position: absolute;
  top: 16px;
  right: 24px;
}

.shortcut-modal h1 {
  font-weight: 600;
  font-size: 1.2em;
}

.shortcut-modal:before {
  background: radial-gradient(rgba(244, 244, 244, 0.43), rgba(75, 75, 75, 0.51));
  align-items: center;
  display: block;
  font-family: Roboto;
  height: 100%;
  justify-content: center;
  left: 0;
  position: absolute;
  top: 0;
  width: 100%;
}

.shortcut-tables {
  display: grid;
  align-items: start;
  grid-template-columns: 1fr;
  row-gap: 1em;
  column-gap: 2em;
}

@media (min-width: 950px) {
  .shortcut-tables {
    grid-template-columns: 1fr 1fr
  }
}

@media (min-width: 1360px) {
  .shortcut-tables {
    grid-template-columns: 1fr 1fr 1fr
  }
}

.shortcut-table {
  border-collapse: collapse;
  font-family: Roboto;
  font-size: .9em;
}

.shortcut-table th {
  padding-inline-end: 0.5em;
  text-align: left;
  text-wrap: nowrap;
  vertical-align: baseline;
}

.shortcut-table td:first-child {
  text-wrap: auto;
  width: 40%;
}

.shortcut-table tr:has(+ .category) {
  --divider-border-color: transparent;
  margin-end: 1em;
}

.shortcut-table tr:not(.category, :last-child) {
  border-bottom: 1px solid var(--divider-border-color);
}

.shortcut-table td {
  padding: 0.2em 1em 0.3em 0;
  text-wrap: nowrap;
}

.shortcut-table h2 {
  border-bottom: 1px solid #999;
  font-size: 1em;
  padding-block-end: 0.5em;
}

.shortcut-table .key {
  border: 1px solid var(--key-border-color);
  border-radius: 8px;
  display: inline-block;
  margin: 0 4px;
  min-width: 2em;
  padding: .3em .5em;
  text-align: center;
}

.shortcut-table .separator {
  color: gray;
  display: inline-block;
  padding: 0 0.5em;
}

.shortcut-container {
  font-size: 0.95em;
  overflow: auto;
  padding: 0.5em;
}

.shortcut-combo {
  display: inline-block;
  padding: 0.25em 0;
  text-wrap: nowrap;
}

/* Styling for blocks in sticky mode (click and stick) */
.blockly-sticky-mode {
  filter: drop-shadow(0 0 10px rgba(0, 255, 0, 0.8)) !important;
  opacity: 0.9 !important;
}

/* Use child combinator (>) to only style the immediate block, not descendants */
.blockly-sticky-mode > .blocklyPath {
  stroke: #00ff00 !important;
  stroke-width: 3 !important;
}

/* Styling for move grip handle */
.blockly-move-grip {
  cursor: grab;
  transition: opacity 0.2s ease;
}

.blockly-move-grip:hover {
  opacity: 0.8;
}

.blockly-move-grip:active {
  cursor: grabbing;
}

.blockly-move-grip-background {
  pointer-events: all;
}

.blockly-move-grip-dot {
  pointer-events: none;
}

/* Ensure grip is visible above block elements */
.blocklyKeyboardNavigation .blockly-move-grip {
  z-index: 100;
}

`);
  }

}

// Export build info components for use by plugin consumers
export {createBuildInfoComponent, registerBuildInfoStyles, updateBuildInfo, startBuildInfoAutoRefresh} from './build_info_component';
export {BUILD_INFO} from './build_info';
