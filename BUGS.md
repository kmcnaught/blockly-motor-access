# Known Bugs

## Move Mode: Down Arrow on Top Block of Stack

**Status:** Needs Replication & Investigation

**Description:**
With a stack of blocks, putting the top block into move mode then pressing DOWN moves it to the original position rather than moving one position down.

**Reported in:** Testing Session 1 (Grid-based user)

**Investigation Notes:**

The move mode uses a constrained movement system in `src/keyboard_drag_strategy.ts`:

1. `searchNode` tracks the current connection point during moves
2. `findTraversalCandidate()` (line 304) finds the next valid connection when arrow keys are pressed
3. Connections are stored in `allConnections`, sorted by Y then X coordinates (top to bottom, left to right)

**Potential Issues:**
- When pressing DOWN, the code traverses to `allConnections[potentialIndex + 1]` (line 321)
- If at the end of the array, it wraps to `allConnections[0]`
- For a top block of a stack, this might incorrectly wrap back to the original position
- The loop termination condition `if (potential == this.searchNode) break;` (line 336) may fire too early

**Reproduction Steps Needed:**
1. Create a workspace with multiple available connection points
2. Create a stack of 2-3 blocks
3. Put the topmost block into move mode (press M)
4. Press DOWN arrow
5. Observe if block jumps to original position or moves down correctly

**Related Code:**
- `src/keyboard_drag_strategy.ts:304-339` - findTraversalCandidate()
- `src/keyboard_drag_strategy.ts:429-458` - createInitialCandidate()
- `src/actions/move.ts:140-170` - move_down_constrained shortcut

**Potential Fixes to Consider:**
- Skip the current `searchNode` connection when traversing
- Handle edge case where block is already at "bottom-most" valid position
- Consider special handling for top blocks in stacks
