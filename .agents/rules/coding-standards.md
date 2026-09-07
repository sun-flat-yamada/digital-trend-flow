# Coding Standards

## TypeScript
- Use **Strict Mode** (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`)
- All schemas defined with **Zod** in `src/core/types.ts`
- Configuration loaded in `src/core/config.ts` with Fail-Fast validation

## Functional Programming
- Prefer pure functions over classes
- Avoid deep OOP inheritance
- Use `const` and arrow functions

## Error Handling
- Use `Promise.allSettled` for batch external API calls (never `Promise.all`)
- Gracefully skip missing API keys (don't crash)
- Use `p-retry` for retryable HTTP operations (Jina Reader)
- Log warnings with `console.warn` for non-fatal failures

## Idempotency
- Every URL must be checked against `processed_urls.json` via `state_manager.ts`
- Never process the same URL twice across pipeline runs

## Citations
- Source URLs MUST be carried through all pipeline phases
- Final output MUST include inline citation links
- Never strip or lose URL metadata during Map-Reduce

## Naming Conventions
- Files: `snake_case.ts`
- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

## Documentation & Comments
- **Role-Based Comments:** Every source file, class, and method MUST have a role-based comment.
- **Focus:** Comments must focus on **Data** and **Processing Mechanisms**.
- **Content:**
    - **Role:** What is this file/class/method's responsibility in the pipeline?
    - **Mechanism:** How does it achieve its goal? (Data flow, logic, external interactions).
- **Placement:** Required at the top of files, class definitions, and method/function definitions.
- For detailed examples, see [comments.md](file:///v:/repos/sun.flat.yamada/digital-trend-flow/.agents/rules/comments.md).
