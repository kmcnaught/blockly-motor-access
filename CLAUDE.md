# Maze Game Context

## Overview
The maze game is a Blockly-based puzzle game where users create block programs to navigate a character through a maze.

## Key Files
- `maze/` - Main maze game directory
- `maze/main.ts` - Entry point
- `maze/maze.ts` - Core maze logic

## Custom Instructions
We are working on improving the maze game for a specific audience: those using assistive tech either 
to be "mouse only" users (joystick, eye gaze) or "keyboard only" users (with an intermediate interface 
to let them use eye gaze or switch input to issue keyboard commands), so we are making sure we
have as much simple scaffolding and UI QoL features to make the UI easy and give people a chance
to practice using their assistive tech before graduating to harder block-based programming environments

In grid mode, we remove a lot of the web based UI and users access the page via Grid3 which provides the
UI via buttons that send keyboard controls. 


# Project Workflow Configuration

## Core Principle: Minimal Main Context

The main conversation is a **coordinator only**. It should contain:
- User requests
- Brief status updates (1-2 lines per step)
- Approval prompts

**All details live in files**, not in conversation:
- Plans → `.claude/scratchpad/current-plan.md`
- Step status → `.claude/scratchpad/step-N-status.txt`
- Progress → `.claude/scratchpad/progress.txt`

## Workflow: Plan → Execute → Review → Commit

### 1. PLANNING
- Write detailed plan to `current-plan.md`
- Show user only step titles (1 line each)
- Wait for approval

### 2. EXECUTION (per step)
- Spawn Task subagent
- Subagent reads plan from file, executes, writes status to file
- Main context receives only: "Step N complete. Status: [1 line]"

### 3. REVIEW
- Show `git diff --stat` (filenames only)
- Read 3-line status from file
- Ask for approval

### 4. COMMIT
- Atomic commit for this step only
- Log to progress.txt
- Move to next step

## Subagent Rules

- Subagents read from `.claude/scratchpad/` files
- Subagents write status to `.claude/scratchpad/step-N-status.txt`
- Main conversation does NOT pass step details in Task prompt
- Main conversation does NOT ask subagent to "report back"

## Commands

| Command | Purpose |
|---------|---------|
| `/plan <task>` | Create plan, show summary |
| `/execute-step <N>` | Run step via subagent |
| `/review-step <N>` | Show diff + status |
| `/revise-step <N> <feedback>` | Fix issues via subagent |
| `/commit-step <N>` | Commit this step |
| `/workflow <task>` | Full automated cycle |

## Why This Matters

Tasks may be unrelated. Fresh context per step prevents:
- Context pollution between unrelated work
- Confusion from irrelevant prior implementation details
- Context window exhaustion on long task lists
