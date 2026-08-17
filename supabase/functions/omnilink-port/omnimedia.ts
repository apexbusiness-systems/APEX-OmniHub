/**
 * OmniMedia edge routes for omnilink-port (contract §7).
 *
 * Routes (all POST, CORS via shared preflight in index.ts):
 *   omnimedia-catalog            → list owner's assets + fresh signed URLs
 *   omnimedia-ingest-from-upload → register an uploaded storage object as an asset
 *   omnimedia-register-external  → register an external (embed/url) asset
 *   omnimedia-delete-asset       → delete an owned asset (+ its storage object)
 *
 * Ownership: every route uses the USER-scoped anon client (caller's JWT), so
 * Row-Level Security enforces owner_user_id = auth.uid() and storage signing is
 * limited to the caller's own objects. No service_role bypass — most
 * privacy-preserving. Never returns another user's media.
 *
 * OWNED BY: APEX Business Systems Ltd.
 */
import { createAnonClient } from '../_shared/supabaseClient.ts';

const BUCKET = 'omnimedia-assets';
const SIGNED_URL_TTL_SECONDS = 3600; // 1h; clients refetch the catalog to refresh.

// Upload caps (owner direction): a mini-gallery, not a media host.
const DAILY_UPLOAD_LIMIT = 5;              // max uploaded assets per rolling 24h
const TOTAL_BYTES_CAP = 25 * 1024 * 1024;  // 25 MB cumulative across all of a user's uploads

type MediaKind = 'video' | 'audio' | 'image';
function isMediaKind(value: unknown): value is MediaKind {
  return value === 'video' || value === 'audio' || value === 'image';
}

interface AssetRow {
  id: string;
  owner_user_id: string;
  title: string;
  kind: MediaKind;
  storage_path: string | null;
  bucket: string | null;
  external_url: string | null;
  provider: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

function json(data: unknown, status: number, corsHeaders: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function handleOmniMediaRequest(
  route: string,
  req: Request,
  corsHeaders: HeadersInit,
): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401, corsHeaders);

  const client = createAnonClient(authHeader);
  const { data: { user } } = await client.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401, corsHeaders);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  switch (route) {
    case 'omnimedia-catalog':
      return catalog(client, corsHeaders);
    case 'omnimedia-ingest-from-upload':
      return ingestFromUpload(client, user.id, body, corsHeaders);
    case 'omnimedia-register-external':
      return registerExternal(client, user.id, body, corsHeaders);
    case 'omnimedia-delete-asset':
      return deleteAsset(client, body, corsHeaders);
    default:
      return json({ error: 'not_found' }, 404, corsHeaders);
  }
}

async function catalog(
  client: ReturnType<typeof createAnonClient>,
  corsHeaders: HeadersInit,
): Promise<Response> {
  // RLS scopes this to the caller's own rows.
  const { data, error } = await client
    .from('omnimedia_assets')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return json({ error: 'catalog_failed' }, 500, corsHeaders);

  const rows = (data ?? []) as AssetRow[];

  // Group paths by bucket for bulk signing to prevent N+1 queries
  const pathsByBucket = new Map<string, string[]>();
  for (const row of rows) {
    if (row.storage_path) {
      const bucket = row.bucket ?? BUCKET;
      if (!pathsByBucket.has(bucket)) pathsByBucket.set(bucket, []);
      pathsByBucket.get(bucket)!.push(row.storage_path);
    }
  }

  // Fetch signed URLs in bulk per bucket
  const signedUrlsMap = new Map<string, string>();
  await Promise.all(
    Array.from(pathsByBucket.entries()).map(async ([bucket, paths]) => {
      const { data: signedUrls } = await client.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      if (signedUrls) {
        for (const item of signedUrls) {
          if (item.path && item.signedUrl) {
            signedUrlsMap.set(item.path, item.signedUrl);
          }
        }
      }
    })
  );

  const items = rows.map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    provider: row.provider,
    mime_type: row.mime_type,
    source: row.storage_path ? (signedUrlsMap.get(row.storage_path) ?? null) : row.external_url,
    is_external: Boolean(row.external_url),
    created_at: row.created_at,
  }));

  return json({ items, expires_in: SIGNED_URL_TTL_SECONDS }, 200, corsHeaders);
}

async function ingestFromUpload(
  client: ReturnType<typeof createAnonClient>,
  userId: string,
  body: Record<string, unknown>,
  corsHeaders: HeadersInit,
): Promise<Response> {
  const storagePath = body.storage_path as string | undefined;
  const title = body.title as string | undefined;
  const kind = body.kind as string | undefined;
  if (!storagePath || !title || !isMediaKind(kind)) {
    return json({ error: 'invalid_request', message: 'storage_path, title, kind(video|audio|image) required' }, 400, corsHeaders);
  }
  // Ownership before write: the object must live under the caller's own prefix.
  if (!storagePath.startsWith(`${userId}/`)) {
    return json({ error: 'forbidden', message: 'storage_path must be under your own prefix' }, 403, corsHeaders);
  }

  // ── Upload caps (RLS scopes both reads to the caller's own rows) ───────────
  const newBytes = typeof body.size_bytes === 'number' ? body.size_bytes : 0;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount } = await client
    .from('omnimedia_assets')
    .select('id', { count: 'exact', head: true })
    .not('storage_path', 'is', null)
    .gte('created_at', since);
  if ((dailyCount ?? 0) >= DAILY_UPLOAD_LIMIT) {
    return json(
      { error: 'daily_limit', message: `Daily upload limit reached (${DAILY_UPLOAD_LIMIT} per day). Try again tomorrow.` },
      429, corsHeaders,
    );
  }
  const { data: sizeRows } = await client
    .from('omnimedia_assets')
    .select('size_bytes')
    .not('storage_path', 'is', null);
  const usedBytes = (sizeRows ?? []).reduce((sum: number, r: { size_bytes: number | null }) => sum + (r.size_bytes ?? 0), 0);
  if (usedBytes + newBytes > TOTAL_BYTES_CAP) {
    return json(
      { error: 'storage_cap', message: `Storage cap reached (25 MB total). Delete media to free space.` },
      429, corsHeaders,
    );
  }

  const { data, error } = await client
    .from('omnimedia_assets')
    .insert({
      owner_user_id: userId,
      title,
      kind,
      storage_path: storagePath,
      bucket: BUCKET,
      mime_type: (body.mime_type as string) ?? null,
      size_bytes: (body.size_bytes as number) ?? null,
    })
    .select('id')
    .single();
  if (error) return json({ error: 'ingest_failed' }, 500, corsHeaders);
  return json({ ok: true, id: data.id }, 201, corsHeaders);
}

async function registerExternal(
  client: ReturnType<typeof createAnonClient>,
  userId: string,
  body: Record<string, unknown>,
  corsHeaders: HeadersInit,
): Promise<Response> {
  const title = body.title as string | undefined;
  const kind = body.kind as string | undefined;
  const externalUrl = body.external_url;
  if (!title || !isMediaKind(kind) || !isHttpsUrl(externalUrl)) {
    return json({ error: 'invalid_request', message: 'title, kind(video|audio|image), https external_url required' }, 400, corsHeaders);
  }
  const { data, error } = await client
    .from('omnimedia_assets')
    .insert({
      owner_user_id: userId,
      title,
      kind,
      external_url: externalUrl,
      provider: (body.provider as string) ?? null,
    })
    .select('id')
    .single();
  if (error) return json({ error: 'register_failed' }, 500, corsHeaders);
  return json({ ok: true, id: data.id }, 201, corsHeaders);
}

async function deleteAsset(
  client: ReturnType<typeof createAnonClient>,
  body: Record<string, unknown>,
  corsHeaders: HeadersInit,
): Promise<Response> {
  const id = body.id as string | undefined;
  if (!id) return json({ error: 'invalid_request', message: 'id required' }, 400, corsHeaders);

  // Read first (RLS → only the owner's row is visible) so we can clean storage.
  const { data: row } = await client
    .from('omnimedia_assets')
    .select('storage_path, bucket')
    .eq('id', id)
    .maybeSingle();
  if (!row) return json({ error: 'not_found_or_not_owned' }, 404, corsHeaders);

  if (row.storage_path) {
    await client.storage.from(row.bucket ?? BUCKET).remove([row.storage_path]);
  }
  const { error } = await client.from('omnimedia_assets').delete().eq('id', id);
  if (error) return json({ error: 'delete_failed' }, 500, corsHeaders);
  return json({ ok: true, deleted: true }, 200, corsHeaders);
}
