/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Shared block-insertion heuristic used by both
 * GridCodingModeController (keyboard W/A/D shortcuts) and
 * SwitchScanController (two-switch scanning). Extracted to one place so
 * the two input modes behave identically when adding a block to the
 * workspace.
 */

import * as Blockly from 'blockly/core';

/**
 * Default workspace coordinates for the very first block in an empty
 * workspace. Mirrors `STACK_ANCHOR_X` / `STACK_ANCHOR_Y` in
 * `index.ts`; duplicated as literal defaults here to avoid an import
 * cycle and because they're stable layout constants.
 */
const DEFAULT_STACK_ANCHOR_X = 25;
const DEFAULT_STACK_ANCHOR_Y = 60;

/**
 * Insert a new block of the given type into the workspace using a
 * shared heuristic shared by both grid-coding-mode and switch-scan-mode:
 *
 *  - If the Blockly FocusManager cursor sits on a workspace block,
 *    connect the new block AFTER it. If that block has no
 *    `nextConnection`, fall back to its parent's `nextConnection` (so
 *    inserting "after" a block embedded inside an `if`/`repeat`
 *    statement input still works).
 *  - Otherwise, walk to the END of the first top-block's nextConnection
 *    chain and connect there.
 *  - If the workspace is empty, drop the new block at the stack anchor
 *    coordinates (defaults match index.ts STACK_ANCHOR_X/Y).
 *
 * Returns the inserted block so the caller can set fields, push it onto
 * an undo history, etc. The helper itself does not track history — that
 * remains a caller concern.
 *
 * @param workspace The main workspace to insert into.
 * @param blockType The Blockly block type name (e.g. `maze_moveForward`).
 * @param fields    Optional map of field-name -> value to set on the
 *     newly created block before rendering.
 * @param anchorX   Workspace x for the first block in an empty workspace.
 * @param anchorY   Workspace y for the first block in an empty workspace.
 * @returns The inserted block.
 */
export function insertBlockAfterCursor(
  workspace: Blockly.WorkspaceSvg,
  blockType: string,
  fields?: Record<string, string | number>,
  anchorX: number = DEFAULT_STACK_ANCHOR_X,
  anchorY: number = DEFAULT_STACK_ANCHOR_Y,
): Blockly.Block {
  // Figure out where the new block should attach BEFORE creating it,
  // so the new block's own previousConnection isn't accidentally
  // considered by the search.
  const connectionTarget = findInsertionConnection(workspace);

  // Group Blockly events so undo treats the insertion as one unit.
  const existingGroup = Blockly.Events.getGroup();
  if (!existingGroup) {
    Blockly.Events.setGroup(true);
  }

  try {
    const block = workspace.newBlock(blockType);

    if (fields) {
      for (const [name, value] of Object.entries(fields)) {
        block.setFieldValue(value, name);
      }
    }

    block.initSvg();

    // Position the block before connecting, so even if we don't end up
    // connecting (empty workspace path) it lands somewhere sensible.
    const blockSvg = block as Blockly.BlockSvg;
    if (!connectionTarget) {
      blockSvg.moveBy(anchorX, anchorY);
    }

    block.render();

    if (connectionTarget && block.previousConnection) {
      connectionTarget.connect(block.previousConnection);
    }

    return block;
  } finally {
    if (!existingGroup) {
      Blockly.Events.setGroup(false);
    }
  }
}

/**
 * Resolve the connection the next inserted block should attach to.
 *
 * Priority:
 * 1. Cursor block's `nextConnection`, if the FocusManager points at a
 * block on the given workspace and that block exposes one.
 * 2. Cursor block's parent's `nextConnection`, if the cursor block is
 * a tail-only block (e.g. some control blocks have no next slot).
 * 3. The end of the first top-block's `nextConnection` chain.
 *
 * Returns `null` when the workspace has no blocks at all (the caller
 * places the new block at the stack anchor in that case).
 *
 * @param workspace
 */
function findInsertionConnection(
  workspace: Blockly.WorkspaceSvg,
): Blockly.Connection | null {
  // Try the FocusManager cursor first.
  const focused = Blockly.getFocusManager().getFocusedNode();
  if (focused instanceof Blockly.BlockSvg && focused.workspace === workspace) {
    if (focused.nextConnection) {
      return focused.nextConnection;
    }
    // Block has no next connection (rare for stackable blocks) — try
    // its parent so we still insert "after" something meaningful.
    const parent = focused.getParent();
    if (parent && parent.nextConnection) {
      return parent.nextConnection;
    }
    // Fall through to chain walk.
  }

  // Walk the first top-block's chain to its tail.
  const topBlocks = workspace.getTopBlocks(true);
  if (topBlocks.length === 0) return null;

  let lastBlock = topBlocks[0];
  while (lastBlock.nextConnection?.targetBlock()) {
    lastBlock = lastBlock.nextConnection.targetBlock()!;
  }
  return lastBlock.nextConnection ?? null;
}
