# Maze Game Keyboard Shortcuts

## Page-Level Shortcuts

These shortcuts work at the page level, outside of Blockly's context.

Defined in `test/maze-game/index.ts:1594`.

| Key | Action |
|-----|--------|
| Ctrl+Alt+1 | Jump to workspace (focus first block or workspace) |
| Ctrl+Alt+2 | Jump to toolbox/flyout |
| Ctrl+Alt+R | Run the program |
| R | Run program (coding mode only) |
| H | Cycle instruction bar display mode |
| [ | Previous level |
| ] | Next level |
| F | Toggle fullscreen mode |
| G | Toggle game panel/sidebar |
| , | Previous character |
| . | Next character |
| L | Cycle language |
| Esc | Exit fullscreen mode |

## Practice Mode Shortcuts

When in practice/immediate mode, these shortcuts control the character directly.

Defined in `test/maze-game/immediate-mode.ts:231`.

| Key | Action |
|-----|--------|
| Arrow Up / W | Move forward |
| Arrow Left / A | Turn left |
| Arrow Right / D | Turn right |
| R | Reset (overrides "Run" in practice mode) |

## Notes

- All shortcuts are ignored when typing in input fields or textareas
- Page shortcuts use capture phase to handle before Blockly intercepts them
