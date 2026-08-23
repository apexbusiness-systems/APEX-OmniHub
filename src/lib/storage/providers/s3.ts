/**
 * S3 STORAGE PROVIDER (S3-compatible)
 *
 * Implementation of IStorage for AWS S3 and any S3-compatible service
 * (Cloudflare R2, MinIO, GCS S3-interop) via the `endpoint` option.
 *
 * SECURITY — SERVER / EDGE ONLY:
 * This provider requires real AWS credentials (accessKeyId/secretAccessKey).
 * It MUST NOT be constructed in browser code, because that would ship the
 * secret key in the client bundle (full bucket access for anyone). The storage
 * factory's browser path (getStorage) refuses to build it. For browser uploads,
 * mint a presigned URL server-side (createSignedUrl / createPresignedPost) and
 * hand only that to the client.
 *
 * The AWS SDK is imported lazily (dynamic import) so selecting Supabase never
 * pulls @aws-sdk/client-s3 into the bundle.
 */

import type {
  IStorage,
  UploadOptions,
  DownloadOptions,
  ListOptions,
  StorageFile,
  StorageResult,
  StorageListResult,
  SignedUrlOptions,
} from '../interface'

export interface S3StorageOptions {
  region?: string
  accessKeyId: string
  secretAccessKey: string
  /** For S3-compatible services (R2, MinIO). Omit for AWS S3. */
  endpoint?: string
  /** Required for R2/MinIO; AWS S3 uses virtual-hosted style by default. */
  forcePathStyle?: boolean
  /** Optional CDN/public base (e.g. CloudFront or R2 public domain) for getPublicUrl. */
  publicBaseUrl?: string
  debug?: boolean
}

interface S3ClientLike {
  send<T = Record<string, unknown>>(command: unknown): Promise<T>
}

interface S3ModLike {
  S3Client: new (config: unknown) => S3ClientLike
  CreateBucketCommand: new (input: unknown) => unknown
  DeleteBucketCommand: new (input: unknown) => unknown
  ListBucketsCommand: new (input: unknown) => unknown
  PutObjectCommand: new (input: unknown) => unknown
  GetObjectCommand: new (input: unknown) => unknown
  DeleteObjectsCommand: new (input: unknown) => unknown
  HeadObjectCommand: new (input: unknown) => unknown
  ListObjectsV2Command: new (input: unknown) => unknown
  CopyObjectCommand: new (input: unknown) => unknown
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

export class S3Storage implements IStorage {
  private readonly opts: S3StorageOptions
  private _mod: S3ModLike | null = null
  private _client: S3ClientLike | null = null

  constructor(options: S3StorageOptions) {
    if (!options.accessKeyId || !options.secretAccessKey) {
      throw new Error('S3Storage requires accessKeyId and secretAccessKey')
    }
    if (!options.region && !options.endpoint) {
      throw new Error('S3Storage requires either region (AWS) or endpoint (R2/MinIO)')
    }
    this.opts = options
  }

  private async mod(): Promise<S3ModLike> {
    this._mod ??= (await import('@aws-sdk/client-s3')) as unknown as S3ModLike
    return this._mod
  }

  private async client(): Promise<S3ClientLike> {
    if (!this._client) {
      const { S3Client } = await this.mod()
      this._client = new S3Client({
        region: this.opts.region ?? 'auto',
        endpoint: this.opts.endpoint,
        forcePathStyle: this.opts.forcePathStyle ?? Boolean(this.opts.endpoint),
        credentials: {
          accessKeyId: this.opts.accessKeyId,
          secretAccessKey: this.opts.secretAccessKey,
        },
      })
    }
    return this._client
  }

  // -------------------------------------------------------------------------
  // BUCKET OPERATIONS
  // -------------------------------------------------------------------------

  async createBucket(name: string, _options?: { public?: boolean }): Promise<StorageResult<boolean>> {
    try {
      const { CreateBucketCommand } = await this.mod()
      const client = await this.client()
      await client.send(new CreateBucketCommand({ Bucket: name }))
      return { data: true, error: null }
    } catch (err) {
      return { data: null, error: toError(err) }
    }
  }

  async deleteBucket(name: string): Promise<StorageResult<boolean>> {
    try {
      const { DeleteBucketCommand } = await this.mod()
      const client = await this.client()
      await client.send(new DeleteBucketCommand({ Bucket: name }))
      return { data: true, error: null }
    } catch (err) {
      return { data: null, error: toError(err) }
    }
  }

  async listBuckets(): Promise<StorageResult<string[]>> {
    try {
      const { ListBucketsCommand } = await this.mod()
      const client = await this.client()
      const res = await client.send<{ Buckets?: Array<{ Name?: string }> }>(new ListBucketsCommand({}))
      return { data: (res.Buckets ?? []).map((b) => b.Name ?? ''), error: null }
    } catch (err) {
      return { data: null, error: toError(err) }
    }
  }

  // -------------------------------------------------------------------------
  // FILE OPERATIONS
  // -------------------------------------------------------------------------

  async upload(
    bucket: string,
    path: string,
    file: File | Blob | ArrayBuffer,
    options?: UploadOptions
  ): Promise<StorageResult<string>> {
    try {
      const { PutObjectCommand } = await this.mod()
      const client = await this.client()
      let body: Blob | File | ArrayBuffer | Uint8Array = file
      if (typeof file === 'string') {
        body = new TextEncoder().encode(file)
      }
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: path,
          Body: body,
          ContentType: options?.contentType,
          CacheControl: options?.cacheControl,
          Metadata: options?.metadata,
        })
      )
      return { data: this.getPublicUrl(bucket, path), error: null }
    } catch (err) {
      return { data: null, error: toError(err) }
    }
  }

  async download(
    bucket: string,
    path: string,
    _options?: DownloadOptions
  ): Promise<StorageResult<Blob>> {
    try {
      const { GetObjectCommand } = await this.mod()
      const client = await this.client()
      const res = await client.send<{ Body?: { transformToByteArray: () => Promise<Uint8Array> }; ContentType?: string }>(
        new GetObjectCommand({ Bucket: bucket, Key: path })
      )
      if (!res.Body) {
        throw new Error('S3 GetObject returned empty body')
      }
      const bytes = await res.Body.transformToByteArray()
      const blob = new Blob([bytes as unknown as BlobPart], { type: res.ContentType ?? 'application/octet-stream' })
      return { data: blob, error: null }
    } catch (err) {
      return { data: null, error: toError(err) }
    }
  }

  async delete(bucket: string, path: string): Promise<StorageResult<boolean>> {
    return this.deleteMany(bucket, [path])
  }

  async deleteMany(bucket: string, paths: string[]): Promise<StorageResult<boolean>> {
    try {
      const { DeleteObjectsCommand } = await this.mod()
      const client = await this.client()
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: paths.map((p) => ({ Key: p })),
            Quiet: true,
          },
        })
      )
      return { data: true, error: null }
    } catch (err) {
      return { data: null, error: toError(err) }
    }
  }

  async exists(bucket: string, path: string): Promise<StorageResult<boolean>> {
    try {
      const { HeadObjectCommand } = await this.mod()
      const client = await this.client()
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: path }))
      return { data: true, error: null }
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } }
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return { data: false, error: null }
      }
      return { data: null, error: toError(err) }
    }
  }

  async getMetadata(bucket: string, path: string): Promise<StorageResult<StorageFile>> {
    try {
      const { HeadObjectCommand } = await this.mod()
      const client = await this.client()
      const res = await client.send<{
        ContentLength?: number
        ContentType?: string
        LastModified?: Date
        Metadata?: Record<string, string>
      }>(new HeadObjectCommand({ Bucket: bucket, Key: path }))
      const file: StorageFile = {
        name: path.split('/').pop() ?? path,
        path,
        size: res.ContentLength ?? 0,
        contentType: res.ContentType,
        lastModified: res.LastModified,
        metadata: res.Metadata,
        publicUrl: this.getPublicUrl(bucket, path),
      }
      return { data: file, error: null }
    } catch (err) {
      return { data: null, error: toError(err) }
    }
  }

  async list(bucket: string, options?: ListOptions): Promise<StorageListResult> {
    try {
      const { ListObjectsV2Command } = await this.mod()
      const client = await this.client()
      const prefix = options?.prefix ? options.prefix.replace(/\/$/, '') + '/' : undefined
      const res = await client.send<{
        Contents?: Array<{ Key?: string; Size?: number; LastModified?: Date; ETag?: string }>
      }>(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: options?.limit ?? 100,
        })
      )

      const files: StorageFile[] = (res.Contents ?? []).map((item) => ({
        name: item.Key ? item.Key.split('/').pop() ?? item.Key : '',
        path: item.Key ?? '',
        size: item.Size ?? 0,
        contentType: 'application/octet-stream',
        lastModified: item.LastModified,
        metadata: item.ETag ? { etag: item.ETag } : undefined,
        publicUrl: this.getPublicUrl(bucket, item.Key ?? ''),
      }))

      return {
        data: files,
        count: files.length,
        error: null,
      }
    } catch (err) {
      return { data: [], count: 0, error: toError(err) }
    }
  }

  async move(bucket: string, fromPath: string, toPath: string): Promise<StorageResult<boolean>> {
    const copyRes = await this.copy(bucket, fromPath, bucket, toPath)
    if (copyRes.error) return copyRes
    const delRes = await this.delete(bucket, fromPath)
    if (delRes.error) return delRes
    return { data: true, error: null }
  }

  async copy(
    sourceBucket: string,
    sourcePath: string,
    destBucket: string,
    destPath: string
  ): Promise<StorageResult<boolean>> {
    try {
      const { CopyObjectCommand } = await this.mod()
      const client = await this.client()
      await client.send(
        new CopyObjectCommand({
          Bucket: destBucket,
          Key: destPath,
          CopySource: encodeURIComponent(`${sourceBucket}/${sourcePath}`),
        })
      )
      return { data: true, error: null }
    } catch (err) {
      return { data: null, error: toError(err) }
    }
  }

  // -------------------------------------------------------------------------
  // URL OPERATIONS
  // -------------------------------------------------------------------------

  getPublicUrl(bucket: string, path: string, _options?: { download?: string }): string {
    const key = path.split('/').map(encodeURIComponent).join('/')
    if (this.opts.publicBaseUrl) {
      return `${this.opts.publicBaseUrl.replace(/\/$/, '')}/${key}`
    }
    if (this.opts.endpoint) {
      return `${this.opts.endpoint.replace(/\/$/, '')}/${bucket}/${key}`
    }
    return `https://${bucket}.s3.${this.opts.region ?? 'us-east-1'}.amazonaws.com/${key}`
  }

  async createSignedUrl(
    bucket: string,
    path: string,
    options?: SignedUrlOptions
  ): Promise<StorageResult<string>> {
    try {
      const { GetObjectCommand } = await this.mod()
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      const client = await this.client()
      const url = await getSignedUrl(
        client as unknown as import('@aws-sdk/client-s3').S3Client,
        new GetObjectCommand({ Bucket: bucket, Key: path }) as unknown as import('@aws-sdk/client-s3').GetObjectCommand,
        { expiresIn: options?.expiresIn ?? 3600 }
      )
      return { data: url, error: null }
    } catch (err) {
      return { data: null, error: toError(err) }
    }
  }

  async createSignedUrls(
    bucket: string,
    paths: string[],
    options?: SignedUrlOptions
  ): Promise<StorageResult<string[]>> {
    try {
      const out: string[] = []
      for (const p of paths) {
        const res = await this.createSignedUrl(bucket, p, options)
        if (res.error || !res.data) return { data: null, error: res.error ?? new Error(`Failed url for ${p}`) }
        out.push(res.data)
      }
      return { data: out, error: null }
    } catch (err) {
      return { data: null, error: toError(err) }
    }
  }

  // -------------------------------------------------------------------------
  // ADVANCED OPERATIONS
  // -------------------------------------------------------------------------

  async uploadWithProgress(
    bucket: string,
    path: string,
    file: File | Blob,
    onProgress: (progress: number) => void,
    options?: UploadOptions
  ): Promise<{ url: string | null; error: Error | null; abort: () => void }> {
    const controller = new AbortController()
    onProgress(0)
    const { data: url, error } = await this.upload(bucket, path, file, options)
    if (!error) onProgress(100)
    return { url, error, abort: () => controller.abort() }
  }

  async createPresignedPost(
    bucket: string,
    path: string,
    options?: UploadOptions & { expiresIn?: number }
  ): Promise<StorageResult<{ url: string; fields: Record<string, string> }>> {
    try {
      const { createPresignedPost } = await import('@aws-sdk/s3-presigned-post')
      const client = await this.client()
      const res = await createPresignedPost(
        client as unknown as import('@aws-sdk/client-s3').S3Client,
        {
          Bucket: bucket,
          Key: path,
          Fields: options?.contentType ? { 'Content-Type': options.contentType } : undefined,
          Expires: options?.expiresIn ?? 3600,
        }
      )
      return { data: { url: res.url, fields: res.fields }, error: null }
    } catch (err) {
      return { data: null, error: toError(err) }
    }
  }

  // -------------------------------------------------------------------------
  // HEALTH CHECK
  // -------------------------------------------------------------------------

  async ping(): Promise<boolean> {
    try {
      const { ListBucketsCommand } = await this.mod()
      const client = await this.client()
      await client.send(new ListBucketsCommand({}))
      return true
    } catch (err) {
      if (this.opts.debug) console.error('[S3Storage] Ping failed:', err)
      return false
    }
  }
}
