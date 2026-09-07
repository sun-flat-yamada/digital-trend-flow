# Role-Based Comment Rule

All source code must include comments that clarify the **Role** and **Mechanism** of the component, focusing on **Data** and **Processing**.

## General Principles
- **Conciseness:** Avoid stating the obvious. Focus on the "Why" and "How" rather than just the "What".
- **Data-Centric:** Explain what data is being handled and its transformation.
- **Role-Based:** Define the specific responsibility within the overall architecture.

## Comment Structure

### 1. File Heading
Each file must start with a summary of its role in the system.
```typescript
/**
 * [Role] Handles the ingestion of data from RSS feeds.
 * [Mechanism] Fetches XML via fetch, parses using 'rss-parser', and standardizes output to 'ArticleItem'.
 */
```

### 2. Class Heading
Each class must define its identity and state management.
```typescript
/**
 * [Role] Manages the state of processed URLs to ensure idempotency.
 * [Mechanism] Loads/saves a JSON file and provides lookup/insertion methods.
 */
class StateManager { ... }
```

### 3. Method Heading
Each method must explain its logic and data transformation.
```typescript
/**
 * [Role] Fetches and parses RSS feeds for a given source.
 * [Mechanism] Performs HTTP GET, validates the response, and maps items to the internal schema.
 * @param source Feed metadata including URL and specific extraction rules.
 */
async function fetchRss(source: RssSource) { ... }
```

## Anti-Patterns
- ❌ `// This is a function to fetch RSS` (Too simple, no role/mechanism).
- ❌ `// Loops through items and adds to array` (Focuses on implementation detail rather than data/mechanism).
