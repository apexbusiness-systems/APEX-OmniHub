#!/bin/bash
find .github/workflows -type f -exec sed -i 's/uses: actions\/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af # v4.1.0/uses: actions\/setup-node@v4/g' {} +
find .github/workflows -type f -exec sed -i 's/uses: actions\/setup-java@7a6d8a8234af8eb26422e24e3006232cccaa061b # v4.6.0/uses: actions\/setup-java@v4/g' {} +
find .github/workflows -type f -exec sed -i 's/uses: actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2/uses: actions\/checkout@v4/g' {} +
