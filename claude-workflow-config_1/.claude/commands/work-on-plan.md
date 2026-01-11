---
description: Execute the plan from current-plan.md step by step
allowed-tools: Task, Read, Bash(git:*)
---

# Work on Plan

## Startup

1. Read `.claude/scratchpad/current-plan.md` to find all todos
2. Read `.claude/scratchpad/progress.txt` to see what's done (if exists)
3. Find the next incomplete step

## For Each Step

### 1. Plan
Say: "Planning step N..."

Spawn Task with this prompt:
```
Read step N from .claude/scratchpad/current-plan.md

This is a high-level todo. Create a detailed implementation plan:
- Think carefully about the best approach
- Consider edge cases and potential issues
- Break into sub-steps if complex
- Note which files need changes

Write your detailed plan to .claude/scratchpad/step-N-plan.txt

Keep it focused but thorough. This plan guides your implementation.
```

After Task completes, say: "Step N planned. Executing..."

### 2. Execute
Spawn Task with this prompt:
```
Read your plan from .claude/scratchpad/step-N-plan.txt
Read CLAUDE.md for project conventions

Execute your plan carefully.

When done, write status (max 3 lines) to .claude/scratchpad/step-N-status.txt
```

### 3. Review
After Task completes:
1. Read `.claude/scratchpad/step-N-status.txt`
2. Run `git diff --stat`
3. Say: "Step N done. Status: [1 line]. Files: [list]. Approve?"

Wait for user response.

### 4. Revise (if needed)
If user requests changes:

Spawn Task with this prompt:
```
Read .claude/scratchpad/step-N-plan.txt for context
Read CLAUDE.md for project conventions

Revision requested: [user feedback]

Make the requested changes.
Update .claude/scratchpad/step-N-status.txt with new status.
```

Then re-review.

### 5. Commit (on approval)
```bash
git add .
git commit -m "step N: [from status]"
```

Append to `.claude/scratchpad/progress.txt`:
```
Step N: done
```

Say: "Committed. Continuing to step N+1..."

## Loop

Continue until all steps complete or user says stop.

## Context Rules

- Do NOT keep step details in conversation
- Each step: ~4 lines in main context max
- All plans, details, status live in files
