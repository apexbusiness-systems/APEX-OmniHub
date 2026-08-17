## 2024-05-18 - Supabase Storage N+1 Prevention
**Learning:** Calling `createSignedUrl` in a loop inside Supabase Edge Functions results in highly inefficient N+1 API calls to the storage service. The Supabase Storage JS client exposes a `createSignedUrls` method that can sign an array of paths in a single bulk API request.
**Action:** When dealing with collections of items that have associated storage objects, group them by bucket and use `createSignedUrls` to fetch the signed URLs in bulk.
