/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BlockSvg,
  clipboard,
  ContextMenuRegistry,
  ICopyable,
  ShortcutRegistry,
  utils,
  comments,
  ICopyData,
  Events,
  renderManagement,
  getFocusManager,
} from 'blockly';
import * as Constants from '../constants';
import {getMenuItem} from '../shortcut_formatting';
import type {Navigation} from '../navigation';

/**
 * Duplicate action that adds a keyboard shortcut for duplicate and overrides
 * the context menu item to show it if the context menu item is registered.
 */
export class DuplicateAction {
  private duplicateShortcut: ShortcutRegistry.KeyboardShortcut | null = null;
  private uninstallHandlers: Array<() => void> = [];
  private navigation: Navigation;

  constructor(navigation: Navigation) {
    this.navigation = navigation;
  }

  /**
   * Install the shortcuts and override context menu entries.
   *
   * No change is made if there's already a 'duplicate' shortcut.
   */
  install() {
    this.duplicateShortcut = this.registerDuplicateShortcut();
    if (this.duplicateShortcut) {
      this.uninstallHandlers.push(
        overrideContextMenuItemForShortcutText(
          'blockDuplicate',
          Constants.SHORTCUT_NAMES.DUPLICATE,
        ),
      );
      this.uninstallHandlers.push(
        overrideContextMenuItemForShortcutText(
          'commentDuplicate',
          Constants.SHORTCUT_NAMES.DUPLICATE,
        ),
      );
    }
  }

  /**
   * Unregister the shortcut and reinstate the original context menu entries.
   */
  uninstall() {
    this.uninstallHandlers.forEach((handler) => handler());
    this.uninstallHandlers.length = 0;
    if (this.duplicateShortcut) {
      ShortcutRegistry.registry.unregister(this.duplicateShortcut.name);
    }
  }

  /**
   * Position a duplicated block near its source block when connection isn't possible.
   *
   * @param sourceBlock The original block that was duplicated.
   * @param duplicatedBlock The newly created duplicate block.
   */
  private positionNearSourceBlock(
    sourceBlock: BlockSvg,
    duplicatedBlock: BlockSvg,
  ): void {
    const sourceXY = sourceBlock.getRelativeToSurfaceXY();
    const DUPLICATE_OFFSET_X = 20;
    const DUPLICATE_OFFSET_Y = 20;

    duplicatedBlock.moveBy(
      sourceXY.x + DUPLICATE_OFFSET_X,
      sourceXY.y + DUPLICATE_OFFSET_Y,
    );
    duplicatedBlock.snapToGrid();
  }

  /**
   * Create and register the keyboard shortcut for the duplicate action.
   * Same behaviour as for the core context menu.
   * Skipped if there is a shortcut with a matching name already.
   */
  private registerDuplicateShortcut(): ShortcutRegistry.KeyboardShortcut | null {
    if (
      ShortcutRegistry.registry.getRegistry()[
        Constants.SHORTCUT_NAMES.DUPLICATE
      ]
    ) {
      return null;
    }

    const shortcut: ShortcutRegistry.KeyboardShortcut = {
      name: Constants.SHORTCUT_NAMES.DUPLICATE,
      // Equivalent to the core context menu entry.
      preconditionFn(workspace, scope) {
        const {focusedNode} = scope;
        if (focusedNode instanceof BlockSvg) {
          return (
            !focusedNode.isInFlyout &&
            focusedNode.isDeletable() &&
            focusedNode.isMovable() &&
            focusedNode.isDuplicatable()
          );
        } else if (focusedNode instanceof comments.RenderedWorkspaceComment) {
          return focusedNode.isMovable();
        }
        return false;
      },
      callback: (workspace, e, shortcut, scope) => {
        const copyable = scope.focusedNode as ICopyable<ICopyData>;
        const data = copyable.toCopyData();
        if (!data) return false;

        // Only do smart positioning if we're duplicating a block
        const sourceBlock =
          scope.focusedNode instanceof BlockSvg ? scope.focusedNode : null;

        // Create event group for atomic undo/redo
        const existingGroup = Events.getGroup();
        if (!existingGroup) {
          Events.setGroup(true);
        }

        // Paste the block using Blockly's clipboard
        const pastedBlock = clipboard.paste(data, workspace) as BlockSvg;

        if (pastedBlock && sourceBlock) {
          // Try to connect to the source block using navigation logic
          const insertStartPoint = this.navigation.findInsertStartPoint(
            sourceBlock,
            pastedBlock,
          );

          if (insertStartPoint) {
            this.navigation.insertBlock(pastedBlock, insertStartPoint);
          } else {
            // If we can't connect, position near the source block
            this.positionNearSourceBlock(sourceBlock, pastedBlock);
          }

          // Focus the new block
          renderManagement.finishQueuedRenders().then(() => {
            getFocusManager().focusNode(pastedBlock);
          });
        }
        // If sourceBlock is null, clipboard.paste() uses default positioning

        // Close event group if we created one
        if (!existingGroup) {
          Events.setGroup(false);
        }

        return !!pastedBlock;
      },
      keyCodes: [utils.KeyCodes.D],
    };
    ShortcutRegistry.registry.register(shortcut);
    return shortcut;
  }
}

/**
 * Replace a context menu item to add shortcut text to its displayText.
 *
 * Nothing happens if there is not a matching context menu item registered.
 *
 * @param registryId Context menu registry id to replace if present.
 * @param shortcutName The corresponding shortcut name.
 * @returns A function to reinstate the original context menu entry.
 */
function overrideContextMenuItemForShortcutText(
  registryId: string,
  shortcutName: string,
): () => void {
  const original = ContextMenuRegistry.registry.getItem(registryId);
  if (!original || 'separator' in original) {
    return () => {};
  }

  const override: ContextMenuRegistry.RegistryItem = {
    ...original,
    displayText: (scope: ContextMenuRegistry.Scope) => {
      const displayText =
        typeof original.displayText === 'function'
          ? original.displayText(scope)
          : original.displayText;
      if (displayText instanceof HTMLElement) {
        // We can't cope in this scenario.
        return displayText;
      }
      return getMenuItem(displayText, shortcutName);
    },
  };
  ContextMenuRegistry.registry.unregister(registryId);
  ContextMenuRegistry.registry.register(override);

  return () => {
    ContextMenuRegistry.registry.unregister(registryId);
    ContextMenuRegistry.registry.register(original);
  };
}
