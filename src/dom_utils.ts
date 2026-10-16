/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks if a DOM element or SVG target is workspace-related.
 * Handles both regular DOM elements and SVG elements (which on touch devices
 * return SVGAnimatedString objects for className).
 *
 * @param target The element to check (can be Element, SVGAnimatedString, or null)
 * @returns True if the target is workspace-related or null/undefined
 */
export function isWorkspaceElement(target: any): boolean {
  // Null/undefined means clicked empty space → workspace
  if (!target) return true;

  // Handle SVGAnimatedString (happens with SVG elements on touch devices)
  // These have baseVal and animVal properties containing the actual class name
  if (target.baseVal !== undefined) {
    const className = target.baseVal || target.animVal || '';
    return className.includes('blocklyWorkspace') ||
           className.includes('blocklyMainBackground') ||
           className.includes('blocklySvg');
  }

  // Handle regular DOM elements with classList
  const classList = target.classList;
  if (classList) {
    return classList.contains('blocklyMainBackground') ||
           classList.contains('blocklySvg') ||
           classList.contains('blocklyWorkspace');
  }

  return false;
}

/**
 * Checks if a DOM element is part of the Blockly UI (workspace, toolbox, flyout, etc.)
 * or is completely outside the Blockly context (like control panels, instructions, etc.).
 *
 * @param target The element to check
 * @returns True if the element is part of the Blockly UI, false if it's external UI
 */
export function isBlocklyUIElement(target: any): boolean {
  if (!target) return true; // Null/undefined means empty space

  // Walk up the DOM tree to check if we're inside Blockly's container
  let current = target;
  while (current) {
    // Check for Blockly-specific classes/IDs that indicate we're in the Blockly UI
    if (current.classList) {
      if (
        current.classList.contains('blocklyWorkspace') ||
        current.classList.contains('blocklyMainBackground') ||
        current.classList.contains('blocklySvg') ||
        current.classList.contains('blocklyToolboxDiv') ||
        current.classList.contains('blocklyFlyout') ||
        current.classList.contains('blocklyFlyoutBackground') ||
        current.classList.contains('blocklyWidgetDiv') ||
        current.classList.contains('blocklyDropDownDiv') ||
        current.classList.contains('blocklyBlockCanvas') ||
        current.classList.contains('blocklyBubbleCanvas')
      ) {
        return true;
      }
    }

    // Check for common Blockly container IDs
    if (current.id === 'blocklyDiv') {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

/**
 * Minimal structural interface for a block-like object that exposes its SVG
 * group. Kept here so this module stays independent of Blockly type imports.
 */
interface BlockWithSvgRoot {
  getSvgRoot(): SVGElement | null | undefined;
}

/**
 * Flashes a brief landing glow on the given block to make the destination of
 * a just-committed move obvious. Safe to call back-to-back on the same block —
 * the animation restarts each time. Deferred one frame so any synchronous
 * re-render triggered by the committing code finishes before we tag the
 * post-render SVG root.
 */
export function pulseBlockLandingGlow(
  block: BlockWithSvgRoot | null | undefined,
): void {
  if (!block) return;
  requestAnimationFrame(() => {
    const el = block.getSvgRoot();
    if (!el) return;
    el.classList.remove('blocklyMoveLandingPulse');
    // Force a reflow so re-adding the class restarts the animation.
    void el.getBoundingClientRect();
    el.classList.add('blocklyMoveLandingPulse');
    const onEnd = () => {
      el.classList.remove('blocklyMoveLandingPulse');
      el.removeEventListener('animationend', onEnd);
    };
    el.addEventListener('animationend', onEnd);
  });
}
