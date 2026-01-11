---
description: Execute a specific step from the plan using a fresh subagent
argument-hint: <step number>
allowed-tools: Task
---

# Execute Step $ARGUMENTS

## CRITICAL: Minimal Context Design

Do NOT read the plan yourself. Do NOT pass step details in the Task prompt.
The subagent reads everything it needs from files.

## Spawn Subagent

Use the Task tool with this EXACT prompt:

```
You are executing Step $ARGUMENTS of an implementation plan.

1. Read `.claude/scratchpad/current-plan.md` to find Step $ARGUMENTS
2. Read `CLAUDE.md` for project conventions
3. Execute ONLY that step
4. When done, write a brief status (max 3 lines) to `.claude/scratchpad/step-$ARGUMENTS-status.txt`

Do not report back verbally. Just write the status file.
```

## Post-Execution

After the Task completes:
1. Read `.claude/scratchpad/step-$ARGUMENTS-status.txt` (just the 3-line summary)
2. Say only: "Step $ARGUMENTS complete. Status: [one-line summary]. Ready for /review-step $ARGUMENTS"

Do NOT ask the subagent for details. Do NOT expand on what was done.
Keep main context minimal.
