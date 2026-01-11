# Claude Code Workflow Configuration

A structured workflow system for Claude Code that enforces:
- **Plan** → **Execute** → **Review** → **Commit** cycles
- Fresh context per step via subagents (Task tool)
- Atomic commits per step
- Human checkpoints before commits

## Installation

Copy these files to your project:

```bash
cp CLAUDE.md /path/to/your/project/
cp -r .claude /path/to/your/project/
```

Or for personal (all projects) use:

```bash
cp CLAUDE.md ~/.claude/
cp -r .claude/commands ~/.claude/
```

## Available Commands

| Command | Description |
|---------|-------------|
| `/plan <task>` | Create a structured implementation plan |
| `/execute-step <N>` | Execute step N using a fresh subagent |
| `/review-step <N>` | Review changes from step N |
| `/revise-step <N> <feedback>` | Fix issues in step N |
| `/commit-step <N>` | Create atomic commit for step N |
| `/workflow <task>` | Run the full automated cycle |

## How It Works

### Context Isolation

Each step is executed by a **subagent** spawned via the Task tool. This means:
- Each step gets a fresh ~200k context window
- No context pollution from previous steps
- Main conversation stays focused on coordination

### Workflow State

Plans and progress are stored in `.claude/scratchpad/`:
- `current-plan.md` - The active implementation plan
- `workflow-state.md` - Current workflow status (for resuming)

### Human Checkpoints

The workflow pauses for approval at:
1. After plan creation
2. After each step's review
3. Before each commit

## Example Usage

```
> /workflow Add user authentication with JWT

[Claude creates plan with 5 steps]
[Presents plan]

Approve this plan? yes

[Spawns Task subagent for Step 1]
[Step 1 completes]
[Shows review]

Approve changes? yes

[Commits Step 1]

Continue to Step 2? yes

[Continues...]
```

## Customization

### Adjusting Step Granularity

Edit `/plan` command to change how steps are sized.

### Adding Pre-commit Hooks

Add to `/commit-step`:
```yaml
allowed-tools: Bash(npm run lint:*), Bash(npm test:*)
```

### Parallel Steps

For independent steps, modify `/workflow` to spawn multiple Task agents simultaneously.

## Limitations

- Subagents cannot spawn other subagents (Claude Code constraint)
- Main agent must coordinate all Task spawning
- Very large tasks may still need manual context management

## Tips

1. **Keep steps small** - Aim for steps completable in 5-15 minutes
2. **Trust the subagent** - Let it work with fresh context
3. **Review carefully** - The review phase catches scope creep
4. **One step, one commit** - Maintains clean git history
