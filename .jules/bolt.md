---
version: 1.0.0
last_audited: 2026-06-12
status: verified
---

## 2026-02-16 - O(N) array search inside object traversal is a major bottleneck
**Learning:** Checking for substrings across an array of terms (`SENSITIVE_FIELD_NAMES.some(term => key.includes(term))`) is extremely slow, especially when executed inside a deep recursive sanitization loop that checks every single object key.
**Action:** Use a pre-compiled Regular Expression (`new RegExp(terms.join('|'), 'i')`) instead. This provides an O(1) lookup in V8 and significantly reduces recursive overhead. Path alias (`@/`) imports in vitest/bun test can be tricky without proper config, but do not override them just to test a unit file locally as they break repo standards.
## 2026-05-15 - Replaced O(N²) loop with O(N) lookup in DashboardOverview.tsx\n**Learning:** The useMemo hook mapping defaultApps and searching inside integrationsQuery.data was an O(N*M) bottleneck.\n**Action:** Use a JavaScript Map (integrationsMap) for O(1) lookups inside the iteration, effectively reducing complexity to O(N+M).
## YYYY-MM-DD - WorkflowBuilder Canvas Drag Optimization
**Learning:** High-polling mice (e.g. 1000Hz) trigger `onMouseMove` excessively in React, which can flood the render queue and cause visual lag during SVG node drags. Standard debouncing/throttling might skip important final coordinate updates or stutter.
**Action:** Always use `requestAnimationFrame` for high-frequency interactive canvas/SVG state updates (e.g. node dragging), tracking the `latestPosRef` and clearing the frame loop when interaction ceases, to perfectly sync with the browser refresh rate (~60 FPS).
## 2026-05-24 - Replaced O(N log N) sort with O(N) reduce for finding max string date
**Learning:** Sorting an array of date strings using `.sort().reverse()[0]` just to find the latest date introduces unnecessary O(N log N) overhead. While N might be small in certain cases, it's an inefficient pattern for finding a simple maximum.
**Action:** Use `.reduce((max, current) => (current !== null && (!max || current > max)) ? current : max, null)` for an O(N) iteration that correctly finds the maximum string value without array mutation or sorting overhead.
## 2026-06-02 - O(N) Array Search Inside Object Traversal
**Learning:** Checking for substrings across an array of terms inside object traversal is slow.
**Action:** Replaced `.some()` array iteration with a precompiled RegExp `SENSITIVE_KEYS_REGEX.test(k)` for O(1) lookups.
## 2026-06-03 - Consolidated O(N) array passes in DashboardOverview.tsx
**Learning:** Sequential `.map().map()` operations in React components cause unnecessary memory allocations and redundant iterations.
**Action:** Always aim to combine sequential array transformations into a single pass when creating derived state, especially when mapping over data that merges with other O(1) structures like Maps.
## 2026-06-05 - Replaced O(N*M) array checks with O(1) Set lookups
**Learning:** Performing `keywords.includes(...)` or `.some(w => ...includes(w))` inside a loop (like scoring agent skills or evaluating JWT roles) creates an O(N*M) bottleneck that degrades performance at scale.
**Action:** Use `Set<string>` (e.g. `new Set(keywords)` or pre-defined constants) and `Set.has()` for O(1) lookups instead. This fundamentally converts O(N*M) operations to O(N+M) or O(N), significantly improving throughput.
## 2026-06-08 - Replaced Object.entries() inside high-frequency scoring loops with pre-calculated arrays
**Learning:** Calling `Object.entries(STATIC_DICT)` inside functions that are called frequently allocates a new array and causes garbage collection overhead on every single invocation.
**Action:** When iterating over static dictionaries, always pre-calculate `const PRE_CALCULATED_ENTRIES = Object.entries(STATIC_DICT)` outside the function scope to achieve zero-allocation array iterations.
## 2026-05-23 - Memoizing List Items in Live Feeds
**Learning:** Extracting list items into a `React.memo`ized component is especially critical for live feeds (e.g., SSE or WebSocket connections). Without this, adding a single new item to the top of an array causes every existing item in the list to re-render, creating an O(n) performance degradation that blocks the main thread.
**Action:** Always extract and memoize list items in components that frequently append or prepend to lists.
## 2026-06-12 - O(N) array search inside object traversal is a major bottleneck
**Learning:** Calling `Object.entries()` inside loops (e.g. for detranslating values based on reverse lookup) is highly inefficient due to array allocations and O(N) searching for reverse key lookups.
**Action:** Use a pre-calculated `REVERSE_DICTIONARY` with a direct lookup utilizing `Object.prototype.hasOwnProperty.call` to prevent prototype pollution and achieve O(1) direct property access instead.
## 2026-06-13 - Replaced O(N²) Set allocations and iteration inside jaccardSimilarity with O(1) cached Sets and mathematical union
**Learning:** In the `deduplicateEntries` function, the initial string tokenization (`new Set(text.split(...))`) inside an O(N²) comparison loop via `unique.some()` caused N*M redundant array iterations and garbage collection allocations per loop for both the target and the comparison items. Furthermore, `new Set([...wordsA, ...wordsB])` created unnecessary intermediate array and Set allocations for the Jaccard union.
**Action:** Extract tokenization into a cached array mapping (`uniqueSets`) and reuse them iteratively. Use `union = wordsA.size + wordsB.size - intersection` instead of the spread syntax to bypass object allocations and execute purely mathematically.
## 2026-07-11 - Replaced O(N) Array Searches with O(1) Sets in Validation\n**Learning:** Checking against Enum values using `Object.values(Enum).includes(...)` inside high-frequency validation functions like `validateCanonicalEvent` causes continuous array allocations and O(N) lookups.\n**Action:** Always pre-calculate a `new Set(Object.values(Enum))` outside the function scope and use `.has()` for O(1) validation.
## 2026-07-30 - Replaced O(N) Array Searches with O(1) Pre-compiled RegExp in Route Validation
**Learning:** Checking path strings against large configuration arrays using `.some()` and `.includes()` or `.startsWith()` allocates new objects and creates unnecessary `O(N)` CPU overhead inside high-frequency execution paths (e.g. guardrails, routing middleware).
**Action:** When validating string sets statically, use `Array.map` to escape characters and `join('|')` them into a single pre-compiled `new RegExp()`. Use `regex.test(val)` for `O(1)` validation logic.

## 2026-07-30 - Avoided Object.entries overhead in Routing
**Learning:** Using `Object.entries(STATIC_DICT)` dynamically in high-frequency routing operations causes unnecessary array allocations and garbage collection pressure on every single route check.
**Action:** Pre-calculate `const PRE_CALCULATED_ENTRIES = Object.entries(STATIC_DICT)` outside the function scope and iterate using a standard `for` loop to eliminate object allocations entirely.
