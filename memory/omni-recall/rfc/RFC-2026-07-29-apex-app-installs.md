# RFC 2026-07-29: APEX App Connection Persistence (`public.apex_app_installs`)

**Status:** APPROVED  
**Author:** APEX Senior AI Co-Founder  
**Target:** OmniDash Production Surface (`https://apexomnihub.icu/omnidash`)  
**PR:** https://github.com/apexbusiness-systems/APEX-OmniHub/pull/1660  

---

## 1. Context & Problem Statement
When users clicked "Add APEX App -> Connect", OmniPort opened in a new tab (`window.open('_blank')`), but OmniHub's App Gallery (`IntegratedAppsGalleryWidget`) rendered static `AWAITING` placeholders with zero backend read or persistence path.

## 2. Proposed Architecture & Schema
Add an additive, lightweight Supabase table `public.apex_app_installs` to persist user-confirmed connection state:

```sql
CREATE TABLE IF NOT EXISTS public.apex_app_installs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id        TEXT        NOT NULL,
  app_label     TEXT        NOT NULL,
  app_url       TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'user_confirmed')),
  installed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, app_id)
);

ALTER TABLE public.apex_app_installs ENABLE ROW LEVEL SECURITY;
```

## 3. Security & Access Control
- RLS enabled with policy `apex_app_installs_owner`: `auth.uid() = user_id` for SELECT, INSERT, UPDATE, DELETE.
- Non-destructive DDL, idempotent creation, updated-at trigger.

## 4. UI Data Flow
1. User clicks Connect in `ApexAppsMcpModule` → opens app OmniPort in a new tab.
2. Launched step renders dual confirmation gate:
   - "It connected! ✔" → upserts `apex_app_installs` (`status: 'user_confirmed'`).
   - "Skip" → closes modal without writing (connection state stays unconfirmed/honest).
3. `IntegratedAppsGalleryWidget` queries `apex_app_installs` on mount, displays green-accented confirmed app tiles, and backfills remaining slots up to 4 with `AWAITING` placeholders.
