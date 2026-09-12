# Team Strategy: Epic & Multi-PR Slices

This strategy coordinates large features, multi-PR modules, and epics requiring multiple branches or releases.

## Guidelines & Lifecycle

1. **Vertical Slice Decomposition**: Do not attempt to deliver the entire epic in a single monolithic branch or PR. Decompose the feature into atomic, reviewable slices (e.g. Slice 1: Schema/core types, Slice 2: Service/API implementation, Slice 3: UI/client integration, Slice 4: End-to-end verification).
2. **Independent Reviewability**: Every slice must build cleanly and pass its test gate (\`verify\` command) independently before opening the next branch or slice.
3. **Cumulative Knowledge & Contracts**: Record architectural decisions (ADRs) and cross-slice contracts in \`contextspace-knowledge.md\`. Slices must not introduce breaking changes to completed preceding slices without updating recorded contracts.
4. **Milestone Handoffs**: Complete and verify each slice before advancing to the next. Post milestone updates or handoffs to keep context clean and bounded.
