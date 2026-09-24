# Baseline intention review

Baseline: `94d10a650b3d10198043afa602d4887fbeee34ce`. This is migration evidence, not an agent prompt.

| Intention | Owner / coverage |
| --- | --- |
| Narrow, non-duplicated instructions | Root `AGENTS.md` and focused skills. |
| Consequential human decisions | Spec obtains explicit semantic approval; build resolves ordinary implementation choices; review owns CTO-facing technical convergence and consequential repair decisions; ship has no semantic decision authority. |
| Review is the senior engineering phase | `dev-review` directly reviews, repairs, integrates local `main`, and grows the CTO's system understanding; no Reviewer sub-agent owns judgment. |
| Fresh, bounded investigations | The `explore` tool contract owns material read-only investigation; Review remains foreground and may use Explorer or Verifier as evidence helpers. |
| Mechanical shipping | `dev-ship` only repackages the reviewed tree into an isolated linear `ship/<name>` branch and proves equivalence; the human owns integration and remote publishing. |
| Explicit model selection | `roles.toml` maps every public and internal role to one model. |
