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
