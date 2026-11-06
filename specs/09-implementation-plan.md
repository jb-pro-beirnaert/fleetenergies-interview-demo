# 09 — Implementation plan

Each milestone ends with: green tests, relevant acceptance criteria checked, commit. A milestone is not started before the previous one is stable. End of V1 and end of V2 = Git tag (`v1`, `v2`) and a complete, replayable demo.

## V1 (≈ 4 to 5 days)

| Milestone | Content | Specs | Duration |
|---|---|---|---|
| **M0** | npm workspaces monorepo, shared strict TypeScript, ESLint/Prettier, `packages/contracts` (first schemas), Docker Compose with Postgres, `.env.example`, GitHub Actions CI | 00, 02, 08 | ½ d |
| **M1** | Simulator `generate`: reference data, physics, history, demo day, scenarios S1-S8, `ground-truth.json` + tests | 04 | ¾ d |
| **M2** | API: migrations, `admin/history/load` and `admin/reset` (replaced by `admin/wipe` in M6b), ingestion (telemetry, cards, messages), detector, task queue and sweep | 01, 03 | 1 d |
| **M3** | API: tool data routes, pseudonymisation, alert context, steps, verdict and decision, screen routes, statistics, OpenAPI | 03 | ½ d |
| **M4** | MCP server: 7 tools, authentication, error handling; check with the MCP inspector | 05 | ¼ d |
| **M5** | Agents: `fleet-qwen`, `smoke:tools`, generic loop, investigator agent, `investigator-v1` prompt, tests with a fake model | 06 | ¾ d |
| **M6** | Angular control room: feed, trace with per-tool renderings, verdict, review, value | 07 | ¾ d |
| **M6b** | Driven simulation: `simulation.ts` contracts, `POST /admin/wipe` (replaces `/admin/reset`), `simulator` service (state machine, control API, `simdata` volume, resume), simulation bar on the screen, end of versioned data | 00, 01, 02, 03, 04, 07, 08 | ¾ d |
| **M7** | End to end: simulation driven from the screen, full Compose, tuning of the prompt and tool descriptions on S1-S8, demo README | all | ½ d |

## V2 (≈ 1.5 days)

| Milestone | Content | Specs | Duration |
|---|---|---|---|
| **M8** | Simulator: scenarios B1-B4 and `invoices-plan.json`; generator: PDF invoices (4 templates) and messages | 04, 10 | ½ d |
| **M9** | API: invoices, text, injection detection, reconciliation; extractor (structured output, retries); `billing_mismatch` alert handled by the investigator | 03, 06 | ¾ d |
| **M10** | Invoices tab, invoice replay, end-to-end check of B1-B4 | 07 | ¼ d |

## Outside milestones, from day one
- Create the Azure account and request the GPU quota (for V5).
- Install Ollama, download `qwen2.5:7b-instruct`, create `fleet-qwen`, run `smoke:tools` as soon as M5 starts: if the model calls tools badly, we will know early.

---

# Working with Claude Code

## Setup (once)
1. Create the repo, copy `CLAUDE.md` to the root and `docs/specs/`. First commit.
2. Start Claude Code at the root: it reads `CLAUDE.md` automatically at every session.

## One milestone = one session
1. **Start from a clean context** (`/clear`) at the beginning of each milestone: the specs carry the project memory, not the conversation history.
2. **Ask for a plan first**, in plan mode, without writing code (prompt below).
3. **Review and adjust the plan**: this is when you supervise most effectively.
4. **Implement in small steps**: one step = a few files, compilation, tests, then you review the diff and commit.
5. **Close the milestone**: have the acceptance criteria checked one by one, and update the spec if something changed.

## Typical milestone start prompt
```
Milestone M2. Read CLAUDE.md, docs/specs/00-overview.md, 01-data-model.md, 02-contracts.md and 03-api.md
(V1 sections only). Do not write any code yet.
Propose an implementation plan in short steps (5 to 8), with for each one: the files created
or modified, the technical choices and the acceptance criteria it covers.
Flag any ambiguity or contradiction in the specs before starting.
```

## Typical prompt during the milestone
```
Step 3 of the plan. Implement it, add the matching tests, run them.
Show me the diff and explain in a few lines the choices that are not obvious.
Propose a commit message.
```

## Typical milestone end prompt
```
Check the acceptance criteria of M2 one by one (spec 03, V1 section, criteria 1 to 10 already relevant).
For each one: covered by which test, or how to check it by hand.
List the gaps with the spec and propose the matching spec changes.
```

## Tips
- **Contracts first**: any schema that crosses a service is written in `packages/contracts` before the code that uses it. This is what keeps the 6 applications consistent across separate sessions.
- **Keep control of the AI part** (loop, prompts, tool descriptions, validation): have every choice explained to you, and rewrite the system prompt yourself. These are the questions you will be asked.
- **Ask for tests that reproduce the hard cases** rather than coverage tests.
- **Refuse unrequested dependencies** and out-of-milestone "improvements": ask Claude to note them in an "ideas" list instead.
- **If the local model misbehaves** on a scenario, adjust the tool descriptions and the prompt first, and only then the code.
