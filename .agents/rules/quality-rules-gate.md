---
description: "Mandatory verification gate before every push and PR."
alwaysApply: true
---

# Quality Gate Rules (`quality-rules-gate`)

## 1. Mandatory gate

Every change passes cleanly before it is pushed (the same steps as the `test` job of `.github/workflows/ci.yml`; tests need `GEMINI_API_KEY`, a dummy value is enough):

```bash
GEMINI_API_KEY=dummy npm run type-check
npm run lint
npm run format:check
GEMINI_API_KEY=dummy npm run test:config
GEMINI_API_KEY=dummy npm run test:coverage
npm run build
npm run change-dev:plan-check
```

- A workflow change is also checked with `actionlint` (`go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12`).
- A prompt or Map / Reduce change also runs `npm run test:golden`.
- Never commit secrets or API keys: they are read from `process.env` through `EnvSchema` (`AGENTS.md` §5).

## 2. Documentation in the same change

When behavior, configuration, a workflow or the architecture changes, update `AGENTS.md` and the matching page under `docs/` in the same PR.
