# Dependency review

Pins below were checked against the published package source and entrypoints. The lockfile fixes transitive versions and integrity hashes. Installation uses `npm ci --ignore-scripts`; no package installation hooks run. This is a targeted review, not a complete supply-chain audit or sandbox guarantee.

| Package | Pin | Purpose / reviewed boundary |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | 0.87.0 | Native sessions, authentication, tools, Markdown/Mermaid and cancellation. SDK integration is exercised without live provider calls. |
| `@narumitw/pi-lsp` | 0.49.8 | Published `dist/index.ts`; launches configured local language servers. Diagnostics and fixes are explicit tools. Server binaries/configuration remain trusted user inputs. |
| `@narumitw/pi-github-pr` | 0.49.8 | Published entrypoint and `gh`-based PR status polling. It is a status display, not our approval authority or a replacement for reading review threads. |
| `@narumitw/pi-chrome-devtools` | 0.53.4 | Published entrypoint/browser manager. First use may attach to local port 9222 or launch an isolated browser. Browser evaluation is privileged; use a development profile. Experimental WebMCP stays opt-in. |
| `@narumitw/pi-usage` | 0.60.10 | Published usage/auth request paths validate effective provider origins before sending credentials to official usage endpoints. No account/reset actions are added by our workflow. |
| `pi-web-access` | 0.30.0 | Published fetch/search routing. Queries go to search providers; selected URLs/content can leave the machine. Browser-cookie access and hosted fetch fallbacks remain upstream opt-ins; we do not enable them. |
| `pi-mcp-adapter` | 2.34.0 | Published entrypoint/configuration. No MCP servers, commands, credentials, or auto-connect rules are shipped by this repository. User-configured servers can execute commands and access data. |
| `@juicesharp/rpiv-todo` | 2.10.1 | Existing requested task/progress interaction. |
| `@juicesharp/rpiv-ask-user-question` | 2.10.1 | Existing requested structured choices and Markdown previews for interactive Spec/Plan. Code-owned final gates use Pi dialogs without another model call. |

`@toon-format/toon` 4.1.1 reads existing contracts; `proper-lockfile` 4.1.2 prevents concurrent workflow writers. There is no `pi-subagents`, generated agent registry, fleet, scheduler, or subagent IPC dependency.

The native loader test loads all published entrypoints. Worker sessions load only web access plus LSP/browser tools for implementation; PR/usage UI and MCP server configuration remain in the foreground. Explorer has no shell, write/edit, browser-control, or recursive delegation tool. This is a capability boundary, not an OS sandbox against malicious installed code.

The dependency inspection on 2026-09-20 reported no npm advisories. This does not certify plugins as harmless: a package or configured tool can still perform sensitive operations within its intended capability. Future updates require reviewing changed source and rerunning native integration tests.
