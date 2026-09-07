---
description: How to run the full daily pipeline locally
---

## Prerequisites
- `.env` file with at least `GEMINI_API_KEY` set
- Dependencies installed (`npm install`)

## Steps

1. Run type-check to catch errors early
```bash
npm run type-check
```

2. Build the TypeScript project
```bash
npm run build
```

// turbo
3. Run the pipeline
```bash
npm start
```

## Expected Output
- `content/daily/YYYY-MM-DD_summary.md` created
- `processed_urls.json` updated with new URLs
- Discord notification sent (if `DISCORD_WEBHOOK_URL` set)
