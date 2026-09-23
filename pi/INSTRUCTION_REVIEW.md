# Baseline intention review

Baseline: `94d10a650b3d10198043afa602d4887fbeee34ce`. This is migration evidence, not an agent prompt.

| Intention | Owner / coverage |
| --- | --- |
| Narrow, non-duplicated instructions | Root `AGENTS.md` and focused skills. |
| Consequential human decisions | Spec obtains explicit semantic approval; build resolves ordinary implementation choices; ship obtains human agreement on meaningful repair directions and explicit local review convergence. |
| No ship coordinator or writing handoff | `dev-ship` owns local repair, verification and candidate-history refinement; optional read-only review supplies evidence. |
| Fresh, bounded investigations | The `explore` tool contract owns the general material-cost trigger; native SDK worker sessions, `review`, and Agent Hub tests cover isolation and lifecycle. |
| No remote publishing or integration | `dev-ship` leaves a reviewed local candidate; the human owns integration and remote publishing. |
| Explicit model selection | `roles.toml` maps every public and internal role to one model. |
