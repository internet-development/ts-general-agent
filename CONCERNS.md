# CONCERNS.md

## 1. LLM Behavioral Non-Compliance

The model occasionally ignores role/echo/silence guidance in space participation and ritual threads.

**Mitigations in place:** 14-check post-generation validation (observer enforcement, dynamic saturation, multi-strategy ensemble echo detection, role message budgets, concept novelty), ritual role differentiation (SHA-256 % 3), commitment normalization + validation at parse time. LLM-as-judge echo detection catches borderline ensemble scores (0.35–0.52).

**Residual: <1%** — adversarial-grade paraphrasing only a full embedding model would catch.

**Confidence workspace improves if further addressed: <1%**

---

## 2. GitHub API Eventual Consistency

In narrow timing windows, two agents can both pass pre-checks for task claiming before either write is visible.

**Mitigations in place:** Two-phase consensus claim protocol with stability-based verification (primary 5s delay + conditional extensions), post-execution claim verification (GATE 5).

**Residual: ~0.1%** — would require external coordination (Redis, etcd) to fully close.

**Confidence workspace improves if further addressed: <0.5%**

---

## 3. Multi-Agent Collaboration Quality

Agents in the space historically created duplicate artifacts instead of collaborating on one. Root causes were: 300-char message schema limit preventing rich descriptions, aggressive conversation suppression preventing deliberation, and no prompt guidance for building on each other's work.

**Mitigations in place:** Schema message limit removed (space is local), skill prompt rewritten to encourage peer-to-peer engagement and ONE-artifact-per-request discipline, discussion mode thresholds significantly raised (saturation bonus 10, role budget 4x, observer threshold 8), token budget compression threshold raised from 6K to 20K tokens, reflection sharing no longer truncated, @mention short-circuit removed (all agents get LLM calls even when host addresses one by name — soft guidance via prompt instead of hard block), non-owner discussion block removed (non-owners can discuss and offer perspectives — only blocked from making direct action promises), non-owner action pattern narrowed to direct declarations of intent only (I'll, I will, Let me — not "I can", "we can" which caught questions), list validator narrowed to structural markers (lines starting with bullets/numbers, not inline parentheticals), empty promise validator narrowed to first-person action declarations.

**Residual: ~3%** — LLM may still occasionally create duplicate issues when multiple agents process the same host message in the same cycle before claims propagate. The claim system mitigates this at the server level but there's a brief window.

**Confidence workspace improves if further addressed: 10%** — Further improvement possible with a deliberation protocol where agents explicitly coordinate before committing (e.g., a "propose" → "endorse" → "commit" cycle).
