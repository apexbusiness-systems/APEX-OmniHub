#!/bin/bash
sed -i 's/uses: android-actions\/setup-android@00854ea68c109d98c75d956347303bf7c45b0277 # v3.2.1/uses: android-actions\/setup-android@v3/g' .github/workflows/mobile-build-verify.yml
