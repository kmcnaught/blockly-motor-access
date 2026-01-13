# Maze Game Level Progression Restructuring

## Motivation & Goals

### Target Audience
This maze game serves users of assistive technology, specifically:
- **Mouse-only users**: Using joystick, eye gaze, or other pointing devices
- **Keyboard-only users**: Using intermediate interfaces (Grid3 AAC software) to issue keyboard commands via eye gaze or switch input

### The Problem
The current level structure has several issues:

1. **Insufficient practice per concept**: Currently only 2 levels for sequencing, which doesn't give enough time to master before introducing new concepts.

2. **Loop concept ordering**: We jump straight to "repeat until goal" which is abstract and hard to reason about. "Repeat X times" (bounded loops) are easier to understand first.

3. **Conditional complexity**: "If path to right" requires understanding what the character can "see", which is abstract. Colored squares ("if on RED square, turn left") provide a more concrete, visual condition.

4. **Grid mode limitations**: Grid mode (used within Grid3) only supports sequential blocks since users don't manipulate blocks directly. Currently only 2 valid levels exist for grid coding mode.

### Goals

1. **Better mastery opportunities**: At least 3 levels per concept to practice before progression.

2. **Scaffolded learning**: Progress from concrete to abstract concepts:
   - Bounded loops before unbounded loops
   - Colored square conditions before path detection conditions

3. **Grid mode support**: Ensure enough sequencing-only levels for grid mode users to practice.

4. **QoL for assistive tech**: Simple UI, clear stage progression, concept introduction dialogs to orient users.

---

## Design Decisions

### Concept Progression (6 Stages)

| Stage | Concept | Why This Order |
|-------|---------|----------------|
| 1 | Sequencing | Foundation - forward, left, right |
| 2 | Repeat X Times | Bounded loops are easier to reason about |
| 3 | Repeat Until | Unbounded loops, more abstract |
| 4 | Colored Conditionals | Concrete/visual - "am I on red?" |
| 5 | Path Conditionals | Abstract/sensing - "is there a path?" |
| 6 | If-Else | Full decision-making |

### UI Layout

- **Stage dropdown**: In instructions header (next to 'info' button)
- **Level display**: By the maze, shows "Level X/Y" within current stage
- **Concept modal**: Shows when entering a new stage

### New Blocks

1. **maze_repeatTimes**: Dropdown (2,3,4,5)
2. **maze_ifColor**: Checks if standing on RED or BLUE square

### Colored Squares

- New maze cell types: RED=4, BLUE=5
- Walkable squares with color overlay

### Mode Logic

| Mode | Available Blocks | Accessible Stages |
|------|-----------------|-------------------|
| Practice | Sequential only | Stage 1 |
| Grid | Sequential only | Stage 1 |
| Coding | Full toolbox | All stages |

The mode determines which stages are accessible. Stage selector is hidden in practice/grid modes.

---

## Stage Structure

| Stage | Concept | Levels | New Blocks | Grid/Practice |
|-------|---------|--------|------------|---------------|
| 1 | Sequencing | 6 | moveForward, turn | Yes |
| 2 | Repeat X Times | 4 | + maze_repeatTimes | No |
| 3 | Repeat Until | 4 | + maze_forever | No |
| 4 | Colored Conditionals | 4 | + maze_ifColor | No |
| 5 | Path Conditionals | 4 | + maze_if | No |
| 6 | If-Else | 4 | + maze_ifElse | No |

**Total: 26 coding levels** (up from 10)

---

## New Blocks

### maze_repeatTimes
```
repeat [2/3/4/5] times
  [statement]
```
- Dropdown for count (simpler than typing)
- Generates: `for (var i = 0; i < N; i++) { ... }`

### maze_ifColor
```
if on [RED/BLUE]
  [statement]
```
- Dropdown for color
- Generates: `if (isOnRed/isOnBlue()) { ... }`

---

## New Maze Cell Types

Extend SquareType enum:
```typescript
enum SquareType {
  WALL = 0,
  OPEN = 1,
  START = 2,
  FINISH = 3,
  RED = 4,    // New
  BLUE = 5,   // New
}
```

Colored squares are walkable and render with a semi-transparent color overlay.

---

## UI Changes

### Stage Selector
- Dropdown in the **instructions header** (next to 'info' button)
- Auto-updates when progressing through levels
- Can skip to any stage (for users who want to jump ahead)

### Level Display
- Level numbers stay **by the maze** (current location)
- Shows level within current stage (e.g., "Level 2/6")
- Back/Next buttons navigate within and across stages

### Concept Introduction Modal
- Shows when entering a new stage (via dropdown or level progression)
- Displays: stage name, concept description, preview of new blocks

---

## Maze Data Structure

Unified maze array with stage metadata:
```typescript
interface MazeLevel {
  maze: number[][];
  stage: number;           // 1-6
  maxBlocks: number;       // Infinity for unlimited
}
```

- Keep all current mazes (10 coding + 8 practice)
- Add new mazes for expanded stages
- Each maze tagged with its stage number

---

## Implementation Steps

### Step 1: Data Structures
- [ ] Create MazeLevel interface with maze, stage, maxBlocks
- [ ] Consolidate MAZES + PRACTICE_MAZES into unified LEVELS array
- [ ] Tag existing mazes with stage number (current practice + L1-2 = Stage 1)
- [ ] Extend SquareType enum (RED=4, BLUE=5)
- [ ] Add STAGES configuration array
- [ ] Add new message keys (blocks, stages, concepts)

### Step 2: New Blocks
- [ ] Add maze_repeatTimes block definition + generator
- [ ] Add maze_ifColor block definition + generator
- [ ] Add interpreter APIs: isOnRed(), isOnBlue()

### Step 3: Colored Tile Rendering
- [ ] Update computeTileShapes for colored tiles
- [ ] Add color overlay rendering in draw()
- [ ] Ensure colored squares are walkable

### Step 4: New Maze Layouts
- [ ] Keep all 18 existing mazes (10 coding + 8 practice)
- [ ] Design new mazes to fill out stages (especially Stage 2-6)
- [ ] Add colored squares to Stage 4 mazes
- [ ] Update level instructions/hints

### Step 5: Stage UI
- [ ] Add stage dropdown to instructions header (next to 'info')
- [ ] Update level display by maze to show "Level X/Y" within stage
- [ ] Add concept introduction modal markup
- [ ] Implement stage selector logic (updates levels, toolbox)
- [ ] Implement concept intro display (on every stage change)
- [ ] Update toolbox generation per stage

### Step 6: Mode-Based Stage Filtering
- [ ] Practice/grid modes: filter to Stage 1 mazes only
- [ ] Hide stage selector in practice/grid modes
- [ ] Coding mode: all stages accessible

### Step 7: Testing & Polish
- [ ] Test all levels are solvable
- [ ] Test colored squares with all skins
- [ ] Test stage progression and modals
- [ ] Test grid mode filtering
- [ ] Add French translations

---

## Files to Modify

| File | Changes |
|------|---------|
| `maze.ts` | SquareType, isOnColor(), colored rendering, unified LEVELS array |
| `blocks.ts` | maze_repeatTimes, maze_ifColor blocks + generators |
| `index.ts` | STAGES config, stage selector, concept modal, toolbox per stage |
| `index.html` | Stage dropdown, concept modal markup |
| `maze.css` | Stage selector styles, modal styles, color indicators |
| `messages.ts` | New block/stage/concept message keys |
| `grid-coding-mode.ts` | Update for new level structure |

---

## Verification

1. **Manual testing**: Play through all levels in coding mode
2. **Grid mode**: Confirm limited to Stage 1 levels
3. **Practice mode**: Confirm limited to Stage 1 levels
4. **Stage transitions**: Concept modals appear on stage change
5. **i18n**: French translations work
6. **Visual**: Colored squares render correctly on all skins
