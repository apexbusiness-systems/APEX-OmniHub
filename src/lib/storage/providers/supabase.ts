/**
 * SUPABASE STORAGE PROVIDER
 *
 * Implementation of IStorage interface for Supabase Storage
 * Wraps Supabase Storage client with generic storage interface
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../integrations/supabase/types'
import { createSupabaseClient } from '../../supabase/client'
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

// ============================================================================
// SUPABASE STORAGE PROVIDER
// ============================================================================

export class SupabaseStorage implements IStorage {
  private readonly client: SupabaseClient<Database>
  private readonly debug: boolean

  constructor(options: {
    url: string
    apiKey: string
    serviceRoleKey?: string
    debug?: boolean
  }) {
    const key = options.serviceRoleKey || options.apiKey

    this.debug = options.debug || false
    this.client = createSupabaseClient({
      url: options.url,
      apiKey: key,
      debug: this.debug,
    })
  }

  // -------------------------------------------------------------------------
  // BUCKET OPERATIONS
  // -------------------------------------------------------------------------

  async createBucket(
    name: string,
    options?: { public?: boolean }
  ): Promise<StorageResult<boolean>> {
    try {
      const { data: _data, error } = await this.client.storage.createBucket(name, {
        public: options?.public || false,
        fileSizeLimit: 52428800, // 50MB default
      })

      if (error) {
        return { data: null, error: new Error(error.message) }
      }

      return { data: true, error: null }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  async deleteBucket(name: string): Promise<StorageResult<boolean>> {
    try {
      const { data: _data, error } = await this.client.storage.deleteBucket(name)

      if (error) {
        return { data: null, error: new Error(error.message) }
      }

      return { data: true, error: null }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  async listBuckets(): Promise<StorageResult<string[]>> {
    try {
      const { data, error } = await this.client.storage.listBuckets()

      if (error) {
        return { data: null, error: new Error(error.message) }
      }

      return { data: data.map((b) => b.name), error: null }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
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
      const { data, error } = await this.client.storage
        .from(bucket)
        .upload(path, file, {
          contentType: options?.contentType,
          cacheControl: options?.cacheControl || '3600',
          upsert: options?.upsert || false,
        })

      if (error) {
        return { data: null, error: new Error(error.message) }
      }

      // Get public URL
      const { data: urlData } = this.client.storage
        .from(bucket)
        .getPublicUrl(data.path)

      return { data: urlData.publicUrl, error: null }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  async download(
    bucket: string,
    path: string,
    _options?: DownloadOptions
  ): Promise<StorageResult<Blob>> {
    try {
      // Supabase Storage doesn't support transformations in download
      // Transformations are applied via URL parameters
      const { data, error } = await this.client.storage
        .from(bucket)
        .download(path)

      if (error) {
        return { data: null, error: new Error(error.message) }
      }

      return { data, error: null }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  async delete(bucket: string, path: string): Promise<StorageResult<boolean>> {
    try {
      const { error } = await this.client.storage.from(bucket).remove([path])

      if (error) {
        return { data: null, error: new Error(error.message) }
      }

      return { data: true, error: null }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  async deleteMany(
    bucket: string,
    paths: string[]
  ): Promise<StorageResult<boolean>> {
    try {
      const { error } = await this.client.storage.from(bucket).remove(paths)

      if (error) {
        return { data: null, error: new Error(error.message) }
      }

      return { data: true, error: null }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  async exists(bucket: string, path: string): Promise<StorageResult<boolean>> {
    try {
      // Supabase doesn't have a direct "exists" method
      // Try to get file info instead
      const { data, error } = await this.client.storage
        .from(bucket)
        .list(path.split('/').slice(0, -1).join('/'), {
          search: path.split('/').pop(),
        })

      if (error) {
        return { data: false, error: null }
      }

      const exists = data && data.length > 0
      return { data: exists, error: null }
    } catch (err) {
      return {
        data: false,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  async getMetadata(
    bucket: string,
    path: string
  ): Promise<StorageResult<StorageFile>> {
    try {
      // Get file info by listing parent directory
      const pathParts = path.split('/')
      const fileName = pathParts.pop()
      const folderPath = pathParts.join('/') || ''

      const { data, error } = await this.client.storage
        .from(bucket)
        .list(folderPath, {
          search: fileName,
        })

      if (error) {
        return { data: null, error: new Error(error.message) }
      }

      if (!data || data.length === 0) {
        return {
          data: null,
          error: new Error(`File not found: ${path}`),
        }
      }

      const fileInfo = data[0]
      const { data: urlData } = this.client.storage
        .from(bucket)
        .getPublicUrl(path)

      return {
        data: {
          name: fileInfo.name,
          path: path,
          size: fileInfo.metadata?.size || 0,
          contentType: fileInfo.metadata?.mimetype,
          lastModified: fileInfo.created_at
            ? new Date(fileInfo.created_at)
            : undefined,
          publicUrl: urlData.publicUrl,
        },
        error: null,
      }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  async list(
    bucket: string,
    options?: ListOptions
  ): Promise<StorageListResult> {
    try {
      const { data, error } = await this.client.storage.from(bucket).list(
        options?.prefix || '',
        {
          limit: options?.limit || 100,
          offset: options?.offset || 0,
          search: options?.search,
        }
      )

      if (error) {
        return { data: null, error: new Error(error.message), count: null }
      }

      const files: StorageFile[] = data.map((file) => {
        const fullPath = options?.prefix
          ? `${options.prefix}/${file.name}`
          : file.name

        const { data: urlData } = this.client.storage
          .from(bucket)
          .getPublicUrl(fullPath)

        return {
          name: file.name,
          path: fullPath,
          size: file.metadata?.size || 0,
          contentType: file.metadata?.mimetype,
          lastModified: file.created_at
            ? new Date(file.created_at)
            : undefined,
          publicUrl: urlData.publicUrl,
        }
      })

      return { data: files, error: null, count: files.length }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
        count: null,
      }
    }
  }

  async move(
    bucket: string,
    fromPath: string,
    toPath: string
  ): Promise<StorageResult<boolean>> {
    try {
      const { error } = await this.client.storage
        .from(bucket)
        .move(fromPath, toPath)

      if (error) {
        return { data: null, error: new Error(error.message) }
      }

      return { data: true, error: null }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  async copy(
    sourceBucket: string,
    sourcePath: string,
    destBucket: string,
    destPath: string
  ): Promise<StorageResult<boolean>> {
    try {
      // Supabase Storage doesn't have a direct copy method
      // Download and re-upload as workaround
      const { data: blob, error: downloadError } = await this.download(
        sourceBucket,
        sourcePath
      )

      if (downloadError || !blob) {
        return {
          data: null,
          error: downloadError || new Error('Failed to download source file'),
        }
      }

      // Get content type from source
      const { data: metadata } = await this.getMetadata(
        sourceBucket,
        sourcePath
      )

      const { data: _url, error: uploadError } = await this.upload(
        destBucket,
        destPath,
        blob,
        {
          contentType: metadata?.contentType,
          upsert: false,
        }
      )

      if (uploadError) {
        return { data: null, error: uploadError }
      }

      return { data: true, error: null }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  // -------------------------------------------------------------------------
  // URL OPERATIONS
  // -------------------------------------------------------------------------

  getPublicUrl(
    bucket: string,
    path: string,
    options?: { download?: string }
  ): string {
    const { data } = this.client.storage.from(bucket).getPublicUrl(path, {
      download: options?.download,
    })

    return data.publicUrl
  }

  async createSignedUrl(
    bucket: string,
    path: string,
    options?: SignedUrlOptions
  ): Promise<StorageResult<string>> {
    try {
      const { data, error } = await this.client.storage
        .from(bucket)
        .createSignedUrl(path, options?.expiresIn || 3600)

      if (error) {
        return { data: null, error: new Error(error.message) }
      }

      return { data: data.signedUrl, error: null }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  async createSignedUrls(
    bucket: string,
    paths: string[],
    options?: SignedUrlOptions
  ): Promise<StorageResult<string[]>> {
    try {
      const { data, error } = await this.client.storage
        .from(bucket)
        .createSignedUrls(paths, options?.expiresIn || 3600)

      if (error) {
        return { data: null, error: new Error(error.message) }
      }

      return {
        // Supabase Storage createSignedUrls returns { signedUrl: string | null }[]
        // — signedUrl is null when signing fails for a specific path.
        // Filter nulls so callers receive only successfully-signed URLs.
        data: data.map((item) => item.signedUrl).filter((url): url is string => url !== null),
        error: null,
      }
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
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
  ): Promise<{
    url: string | null
    error: Error | null
    abort: () => void
  }> {
    try {
      // Supabase doesn't support native progress tracking
      // Use XMLHttpRequest for progress tracking
      let aborted = false
      const abort = () => {
        aborted = true
      }

      // Simulate progress for now (Supabase limitation)
      onProgress(0)

      const { data: url, error } = await this.upload(
        bucket,
        path,
        file,
        options
      )

      if (aborted) {
        return {
          url: null,
          error: new Error('Upload aborted'),
          abort,
        }
      }

      onProgress(100)

      return { url, error, abort }
    } catch (err) {
      return {
        url: null,
        error: err instanceof Error ? err : new Error(String(err)),
        abort: () => {},
      }
    }
  }

  async createPresignedPost(
    _bucket: string,
    _path: string,
    _options?: UploadOptions & { expiresIn?: number }
  ): Promise<
    StorageResult<{
      url: string
      fields: Record<string, string>
    }>
  > {
    // Supabase Storage doesn't support presigned POST
    // This is an S3-specific feature
    return {
      data: null,
      error: new Error(
        'Presigned POST not supported in Supabase Storage. Use direct upload instead.'
      ),
    }
  }

  // -------------------------------------------------------------------------
  // HEALTH CHECK
  // -------------------------------------------------------------------------

  async ping(): Promise<boolean> {
    try {
      // Try to list buckets as health check
      const { error } = await this.client.storage.listBuckets()
      return !error
    } catch (err) {
      console.error('[SupabaseStorage] Ping failed:', err)
      return false
    }
  }
}
