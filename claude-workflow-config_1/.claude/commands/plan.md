---
description: Create a structured implementation plan with discrete steps
argument-hint: <feature or task description>
allowed-tools: Write
---

# Planning Phase

Create a detailed implementation plan for: $ARGUMENTS

## Write Plan to File

Save to `.claude/scratchpad/current-plan.md`:

```markdown
# Plan: [brief title]

## Step 1: [title]
**Goal**: [specific outcome]
**Files**: [files to create/modify]
**Verify**: [how to confirm success]

## Step 2: [title]
**Goal**: 
**Files**: 
**Verify**: 

[Continue for all steps...]
```

## Present Summary ONLY

In the conversation, show ONLY:

```
Plan created with N steps:
1. [step 1 title]
2. [step 2 title]
3. [step 3 title]
...

Approve? Then run /execute-step 1
```

Do NOT show goals, files, or verification details in conversation.
Full plan is in the file. User can read it if they want details.
