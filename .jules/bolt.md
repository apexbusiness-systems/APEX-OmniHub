## 2026-08-16 - [React.memo in OmniBoard]
**Learning:** Wrapped `ConnectorKit` component with `React.memo` to prevent unnecessary re-renders when parent states change, especially since the `OmniBoardPage` modifies internal states like `sheetOpen`. This is a classic React performance optimization.
**Action:** Identify larger, frequently re-rendered components across the app and apply `React.memo` where prop references are stable.
