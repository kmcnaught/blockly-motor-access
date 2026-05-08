/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {BlockSvg, dragging, utils} from 'blockly';

export class MouseDragStrategy extends dragging.BlockDragStrategy {
  private theBlock: BlockSvg;
  private static dragEnabled = true;
  private dragStarted = false;

  constructor(block: BlockSvg) {
    super(block);
    this.theBlock = block;
  }

  static setDragEnabled(enabled: boolean) {
    MouseDragStrategy.dragEnabled = enabled;
  }

  override shouldHealStack(e: PointerEvent | undefined): boolean {
    if (!this.theBlock.previousConnection) return false;
    // Default = single block drag; Alt = drag with children
    return !e?.altKey;
  }

  override startDrag(e?: PointerEvent): void {
    if (!MouseDragStrategy.dragEnabled) return;
    this.dragStarted = true;
    super.startDrag(e);
  }

  override drag(newLoc: utils.Coordinate): void {
    if (!this.dragStarted) return;
    super.drag(newLoc);
  }

  override endDrag(e?: PointerEvent): void {
    if (!this.dragStarted) return;
    super.endDrag(e);
    this.dragStarted = false;
  }

  override revertDrag(): void {
    if (!this.dragStarted) return;
    super.revertDrag();
    this.dragStarted = false;
  }
}
