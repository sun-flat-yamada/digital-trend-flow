---
description: How to test scoring and filtering logic without API costs
---

## Steps

// turbo
1. Run the dry-run CLI with a target URL
```bash
npm run debug:filter "https://venturebeat.com/ai/"
```

## What It Does
- Fetches content via Jina Reader API
- Runs the scorer (exclusion rules + keyword matching)
- Displays score breakdown and pass/fail result
- Does NOT invoke Gemini API (zero LLM cost)

## When to Use
- After modifying `config.yml` (exclusion rules, scoring weights)
- After modifying `src/filtering/scorer.ts`
- To verify a specific URL would pass or fail the filter
