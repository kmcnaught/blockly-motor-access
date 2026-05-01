/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {BlockSvg, dragging} from 'blockly';

export class MouseDragStrategy extends dragging.BlockDragStrategy {
  private theBlock: BlockSvg;

  constructor(block: BlockSvg) {
    super(block);
    this.theBlock = block;
  }

  override shouldHealStack(e: PointerEvent | undefined): boolean {
    if (!this.theBlock.previousConnection) return false;
    // Default = single block drag; Alt = drag with children
    return !e?.altKey;
  }
}
