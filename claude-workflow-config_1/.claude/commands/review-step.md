---
description: Review changes from a completed step
argument-hint: <step number>
allowed-tools: Bash(git diff:*), Bash(git status:*), Read
---

# Review Step $ARGUMENTS

## Gather Info (minimal)

1. Read `.claude/scratchpad/step-$ARGUMENTS-status.txt` (the 3-line summary)
2. Run `git status` and `git diff` to see actual changes

## Present Review

```
## Step $ARGUMENTS Review

**Status**: [from status file]

**Files Changed**:
[from git status]

**Diff**:
[show git diff, or summarize if large]
```

Then ask: "Approve and commit? Or /revise-step $ARGUMENTS <feedback>"

Do NOT re-read the full plan. Do NOT expand on implementation details.
Keep this brief.
