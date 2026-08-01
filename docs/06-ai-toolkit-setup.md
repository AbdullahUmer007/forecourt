# Forecourt — AI Toolkit Setup

**Version:** 1.0 — August 2026
**What this is:** the tooling you asked for — skills, a system prompt, and repo conventions — so that whoever builds this (you, a team, or an AI agent) produces the same product to the same standard every time.

---

## 1. What's in the box

| File | What it is | Where it goes |
|---|---|---|
| `forecourt-domain.skill` | UK used-car dealer domain knowledge: lifecycle, terminology, money rules, VAT margin scheme, regulatory rules, data sources, canonical calculations | Upload to Claude (skills), or unzip into `.claude/skills/` in the repo |
| `forecourt-ui.skill` | The design system as an enforceable contract: tokens, validated chart palette, screen patterns, performance budgets, definition of done | Same |
| `forecourt-feature.skill` | The engineering workflow for a feature slice, plus the multi-tenancy checklist and code-review gates | Same |
| `system-prompt.md` | A short project system prompt | Paste into Claude Project instructions, Cursor rules, or Copilot instructions |
| `CLAUDE.md` | Repository conventions — the ten rules, layout, commands, definition of done | Repository root |
| `docs/01`–`docs/05` | The specifications the skills refer to | `docs/` in the repository |

---

## 2. How to install the skills

### In Claude (desktop, web, or a Project)
Each `.skill` file is a zip archive containing a `SKILL.md` and its reference files. Upload it in Claude's skill settings. Once saved, Claude loads it automatically whenever the conversation matches the skill's description — you don't have to invoke it by name, though you can (`/forecourt-domain`).

> Note: I can deliver a skill file to you, but I can't save it into your account — whether it offers to save depends on your organisation's settings. Once you've saved it, it's available in every conversation.

### In Claude Code / an agent working in the repository
Unzip each one into `.claude/skills/`:

```
.claude/skills/
  forecourt-domain/
    SKILL.md
    references/compliance-rules.md
    references/calculations.md
  forecourt-ui/
    SKILL.md
    references/tokens.md
    references/patterns.md
  forecourt-feature/
    SKILL.md
    references/tenancy-checklist.md
```

Commit them. They are versioned with the code, which matters — when the design system or a regulatory parameter changes, the skill changes in the same commit.

### In Cursor / Copilot / another tool
Those tools don't have a skill mechanism, so flatten it: put `system-prompt.md` into the rules field, and keep `CLAUDE.md` at the repository root (Cursor reads it; so do most agents). Point the tool at `docs/` and the skill `SKILL.md` files as context.

---

## 3. Why these three skills and not one

They load at different moments and for different people:

- **`forecourt-domain`** is needed by anyone writing a spec, a feature, a test, or customer-facing copy. It is the skill that stops someone writing "trade-in", storing money as a float, or hard-coding a VAT rate.
- **`forecourt-ui`** is needed only when something visual is being built, but then it is needed in full — including the validated chart palette, which must not be re-invented.
- **`forecourt-feature`** is the workflow and the review gate. It is what a code reviewer (human or agent) checks against.

One giant skill would load 8,000 words of design tokens into a conversation about VAT. Three narrow ones each trigger on their own vocabulary.

---

## 4. What else you should set up

These matter more than the AI tooling, honestly:

**Advisers, on retainer, before you write compliance code.**
A motor-trade FCA compliance consultant and a VAT specialist. Budget roughly £1.5–3k/month. Every compliance feature gets their sign-off before it ships. This is the cheapest insurance in the plan, and the skills explicitly tell any agent not to ship compliance features without it.

**Design partners, before the architecture is finalised.**
Eight dealers matching the ICP. Two VAT-margin-heavy, one van specialist, one 3-site group. Free for twelve months in exchange for weekly access, real data and a public case study. Nothing in these specs survives contact with a real stock book unchanged.

**Data contracts, starting now.**
cap hpi / HPI Check (same parent — negotiate together), an aggregator for launch speed, and Auto Trader technology-partner status. All are sales-gated with no self-serve path and take months. They gate Release 1, not the code.

**A quarterly regulatory watch task with a named owner.**
Re-check the redress scheme's status and parameters, FCA Handbook changes to CONC/PRIN 2A/DISP, HMRC margin-scheme guidance, ICO direct-marketing guidance, and the CAP Code motoring section. Update `compliance_rules` accordingly. Put it in the calendar; it will not happen otherwise.

**The two CI gates that protect the business.**
The cross-tenant leak suite, and the three golden-file tests (no VAT line on a margin invoice; no cost-of-credit figure without a representative example; no marketing send without a consent record). If you build nothing else from this document first, build those.

---

## 5. Keeping the toolkit honest

The skills will rot if they aren't maintained. Three rules:

1. **When a spec changes, the skill changes in the same PR.** A skill that contradicts the code is worse than no skill.
2. **When a regulatory parameter changes, update `compliance-rules.md` and the `compliance_rules` table together**, and record the source URL and the date you checked.
3. **When the design system changes a colour, re-run the palette validator** against both surfaces before updating `tokens.md`. Never eyeball a colour decision.

---

## 6. A suggested first week

| Day | Do |
|---|---|
| 1 | Install the skills and the system prompt. Read `01-product-strategy.md` end to end and disagree with it in writing. |
| 2 | Start the adviser and data-provider conversations. They have the longest lead times. |
| 3–4 | Book calls with six candidate design partners. Ask each to walk you through their stock book, their Auto Trader bill and their last VAT inspection. |
| 5 | Stand up the repository skeleton: monorepo, Postgres with RLS, the tenant context, the leak test suite, and `tokens.json`. Nothing else. Get the isolation gate green before any feature exists. |

The temptation will be to start building the stock list because it's the fun part. Resist it for a week. The isolation gate and the design partners are what make everything after them cheap.
