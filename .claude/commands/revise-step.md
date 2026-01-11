---
description: Revise a step to fix identified issues using a fresh subagent
argument-hint: <step number> <revision instructions>
allowed-tools: Task, Write
---

# Revise Step

## Parse Input

- Step number: first word of $ARGUMENTS
- Revision instructions: rest of $ARGUMENTS

## Write Revision Instructions to File

Write the revision instructions to `.claude/scratchpad/step-[N]-revision.txt`

## Spawn Subagent

Use the Task tool with this EXACT prompt:

```
You are revising Step [N] of an implementation plan.

1. Read `.claude/scratchpad/current-plan.md` to find Step [N]
2. Read `.claude/scratchpad/step-[N]-revision.txt` for what to fix
3. Read `CLAUDE.md` for project conventions
4. Make ONLY the requested revisions
5. Write a brief status (max 3 lines) to `.claude/scratchpad/step-[N]-status.txt`

Do not report back verbally. Just write the status file.
```

## Post-Revision

Read the status file and say only:
"Step [N] revised. Status: [one-line summary]. Ready for /review-step [N]"
