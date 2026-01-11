---
description: Save your todo list to the plan file
argument-hint: <your numbered todos>
allowed-tools: Write
---

# Save Todos

Write the following to `.claude/scratchpad/current-plan.md`:

```markdown
# Plan

$ARGUMENTS
```

Then say only: "Saved [N] todos to current-plan.md. You can /clear then /work-on-plan"

Do NOT expand, reformat, or add details. Save exactly what the user wrote.
