---
description: Commit the current step with a proper commit message
argument-hint: <step number>
allowed-tools: Bash(git add:*), Bash(git commit:*), Bash(git status:*), Read, Write
---

# Commit Step $ARGUMENTS

## Read Minimal Context

1. Read `.claude/scratchpad/step-$ARGUMENTS-status.txt` for commit message basis
2. Run `git status` to see files to commit

## Commit

```bash
git add [specific files from git status]
git commit -m "step $ARGUMENTS: [brief description from status]"
```

## Update Progress

Append to `.claude/scratchpad/progress.txt`:
```
Step $ARGUMENTS: committed [hash]
```

## Report (minimal)

Say only: "Step $ARGUMENTS committed. [X] steps done. Next: /execute-step [N+1] or done."

Do NOT re-read the plan. Do NOT summarize what was implemented.
