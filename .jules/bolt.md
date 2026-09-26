## 2023-10-26 - [Memoization of Static Map items]
**Learning:** In React functional components, `.map` calls over static arrays can be extracted and memoized to avoid re-rendering entire lists on unrelated state changes (like active item tracking). Moving static constants and handler functions outside the component function body helps avoid reallocation on every render cycle.
**Action:** When finding `array.map` that isn't wrapped in a `memo`ized component, particularly for navigation bars, extract the repeated element into a `memo`ized sub-component to prevent unnecessary re-renders.
