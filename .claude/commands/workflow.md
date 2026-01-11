---
description: Run the full plan-execute-review-commit workflow
argument-hint: <task description or numbered list>
allowed-tools: Task, Write, Bash(git:*)
---

# Full Workflow: $ARGUMENTS

## Phase 1: Create Plan

Write a plan to `.claude/scratchpad/current-plan.md` based on: $ARGUMENTS

Format:
```markdown
# Plan

## Step 1: [title]
Goal: [what to accomplish]
Files: [expected files]
Verify: [how to test]

## Step 2: [title]
...
```

Present a **brief summary** (just step titles, 1 line each) and ask: "Approve?"

Do NOT keep the full plan in conversation. It lives in the file.

---

## Phase 2: Execute Loop

After approval, for each step N:

1. Say: "Executing step N..."
2. Spawn Task: "Read step N from `.claude/scratchpad/current-plan.md`, execute it, write status to `.claude/scratchpad/step-N-status.txt`"
3. Read status file (3 lines max)
4. Show `git diff --stat` (file names only, not full diff)
5. Ask: "Approve step N?" 
6. If yes: `git add . && git commit -m "step N: [from status]"`
7. Log to `.claude/scratchpad/progress.txt`
8. Continue to N+1

---

## Context Rules

**Main conversation should only contain:**
- Initial request
- Plan summary (titles only)
- Per step: "Executing N..." → "Status: [1 line]" → "Approve?" → "Committed"

**Everything else lives in files:**
- Full plan: `current-plan.md`
- Step details: subagent reads from file
- Status: `step-N-status.txt`
- Progress: `progress.txt`

---

## Checkpoints

Pause for user input:
1. ✋ After plan summary → "Approve plan?"
2. ✋ After each step status → "Approve step N?"

Never auto-proceed.
