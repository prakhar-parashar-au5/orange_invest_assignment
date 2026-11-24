# AGENTS.md

orange-invest: a chat assistant over a user's own bank and Paytm statements. `server/` is the
Express + MySQL API, `client/` is the React (Vite) app. Run instructions are in `README.md`.

## Agent skills

### Issue tracker

Local markdown under `docs/issues/<feature-slug>/`, no GitHub Issues for now. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, recorded as a `Status:` line. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` plus `docs/adr/`, both created lazily by `/domain-modeling`. See `docs/agents/domain.md`.
