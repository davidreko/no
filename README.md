# no

**The AI coding agent that pushes back.**

Every AI coding tool is a people-pleaser. Ask it to build something unnecessary and it'll build it beautifully. `no` has a built-in judge - a second LLM pass that reviews the plan before any code gets written. It catches overengineering, scope creep, and premature abstraction *before* they become code.

```
  +-- judge --- pushback ----------------------------------------+
  |                                                              |
  |  x Do you actually need Redis? The user said                 |
  |    "caching" not "distributed caching." Start                |
  |    with a Map and a setTimeout.                              |
  |                                                              |
  |  x A "cache middleware" and "per-endpoint TTL                |
  |    config" - you're turning 3 lines of code                  |
  |    into an architecture. Just memoize the                    |
  |    fetch calls.                                              |
  |                                                              |
  |  > Simpler approach                                          |
  |    Add a cache Map<string, {data, expiry}> at                |
  |    module scope in client.ts. Check before                   |
  |    fetch, store after. ~15 lines. Done.                      |
  |                                                              |
  +--------------------------------------------------------------+
```

## Why

You've seen it: you ask an AI to "make the email sending pluggable" and it builds an EmailProvider interface, a SendGridProvider class, a factory with a registry pattern, and a barrel export. Four new files for one integration you're not even planning to swap.

The cost of building the wrong thing is 10x the cost of a 30-second review. `no` adds that review - automatically, before execution, every time the task is non-trivial.

## Install

```bash
npx nah-cli
```

Or install globally:

```bash
npm install -g nah-cli
```

Requires an Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Run `no init` for a guided setup.

## How it works

```
You type a task
    |
Planner reads your codebase and produces a structured plan
    |
Judge reviews the plan - can read your code to verify claims
    |
You decide: [g]o  [r]evise  [c]ancel
    |
Agent executes the approved plan
```

Simple tasks (fix a typo, rename a variable) skip the judge automatically. Everything else gets reviewed.

## Usage

```bash
# Interactive REPL
no

# One-shot
no "fix the typo in README.md"
no "add error handling to the fetch calls in src/api.ts"

# Pipe support
git diff | no "review this"
cat error.log | no "fix this"

# Pre-commit review
no review
```

### The Judge

The judge is the core of `no`. It's a separate LLM pass that acts like a skeptical senior engineer - one who's been burned by overengineering.

**What it catches:**
- An interface + factory + registry for one email provider
- Winston with file rotation in a 12-file CLI tool
- A config system for three hardcoded settings
- Four new files when editing one would do
- Any plan that's 7 steps when 2 would work

**Verdicts:**
- **looks-good** - plan is proportionate, proceed.
- **pushback** - overengineered or doing more than asked. Suggests a simpler alternative.
- **hard-no** - fundamentally wrong or dangerous.

The judge has read-only access to your codebase. It can verify the planner's claims - check if files exist, read function signatures, confirm assumptions. It submits structured verdicts via tool use, not fragile text parsing.

If the judge pushes back and you choose "revise", the planner gets the feedback and produces a new plan without re-reading files it already analyzed. Up to 2 revisions, then you decide.

### Options

```
--dry-run        Show plan + judge review, don't execute
--model          Model to use (default: claude-sonnet-4-6)
--judge-model    Model for the judge (default: same as --model)
```

### REPL commands

Type `/` to open the command menu, or type commands directly:

| Command   | Description                    |
|-----------|--------------------------------|
| `/clear`  | Clear conversation history     |
| `/cost`   | Show token usage and cost      |
| `/exit`   | Quit                           |
| `/model`  | Change model                   |
| `/plan`   | Plan-only next task (no exec)  |
| `/resume` | Resume last saved session      |
| `/review` | Judge your staged git changes  |
| `/undo`   | Revert last task's changes     |

## Safety

- **Dangerous command detection** - flags `rm -rf /`, `git push --force`, `curl | bash`, etc.
- **Project sandboxing** - tools can't read or write outside the project root
- **Permission prompts** - write operations always ask first
- **Git undo** - `/undo` reverts the last task's changes via git stash

## Configuration

Run `no init` to create `.no/config.json`:

```json
{
  "model": "claude-sonnet-4-6",
  "judgeModel": "claude-sonnet-4-6",
  "thinking": "complex",
  "alwaysAllow": []
}
```

Add project context in `.no/memory.md` - it's included in the system prompt for both the agent and the judge.

## Development

```bash
git clone https://github.com/davidreko/no.git && cd no
pnpm install
pnpm dev           # Run with tsx
pnpm build         # Compile to dist/
pnpm test          # Run tests
pnpm eval          # Run judge eval suite (22 cases)
```

## License

MIT
