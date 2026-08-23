/**
 * Tests for the server-safe S3 storage provider and the storage factory.
 *
 * The AWS SDK is mocked (no network, no real bucket): we verify command
 * construction, public-URL formatting, NotFound handling, and that the factory
 * enforces credentials for s3/r2.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

const send = vi.fn()

class FakeCommand {
  constructor(public input: Record<string, unknown>) {}
}

vi.mock('@aws-sdk/client-s3', () => ({
  // Must be constructable (`new S3Client(...)`); an arrow-returning vi.fn()
  // throws "is not a constructor" under vitest v4, so use a real class.
  S3Client: class {
    send = send
  },
  PutObjectCommand: class extends FakeCommand {},
  GetObjectCommand: class extends FakeCommand {},
  HeadObjectCommand: class extends FakeCommand {},
  DeleteObjectCommand: class extends FakeCommand {},
  DeleteObjectsCommand: class extends FakeCommand {},
  ListObjectsV2Command: class extends FakeCommand {},
  ListBucketsCommand: class extends FakeCommand {},
  CopyObjectCommand: class extends FakeCommand {},
  CreateBucketCommand: class extends FakeCommand {},
  DeleteBucketCommand: class extends FakeCommand {},
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/object?sig=abc'),
}))

import { S3Storage } from '../../src/lib/storage/providers/s3'
import { createStorage } from '../../src/lib/storage'

beforeEach(() => {
  send.mockReset()
})

describe('S3Storage construction', () => {
  it('requires credentials', () => {
    expect(
      () => new S3Storage({ region: 'us-east-1', accessKeyId: '', secretAccessKey: '' })
    ).toThrow(/accessKeyId/)
  })

  it('requires region or endpoint', () => {
    expect(
      () => new S3Storage({ accessKeyId: 'k', secretAccessKey: 's' })
    ).toThrow(/region.*endpoint/)
  })
})

describe('S3Storage.getPublicUrl', () => {
  it('uses publicBaseUrl when provided', () => {
    const s = new S3Storage({
      region: 'us-east-1',
      accessKeyId: 'k',
      secretAccessKey: 's',
      publicBaseUrl: 'https://cdn.example.com',
    })
    expect(s.getPublicUrl('bucket', 'a/b.png')).toBe('https://cdn.example.com/a/b.png')
  })

  it('uses endpoint (path-style) for R2/MinIO', () => {
    const s = new S3Storage({
      accessKeyId: 'k',
      secretAccessKey: 's',
      endpoint: 'https://acct.r2.cloudflarestorage.com',
    })
    expect(s.getPublicUrl('bucket', 'a/b.png')).toBe(
      'https://acct.r2.cloudflarestorage.com/bucket/a/b.png'
    )
  })

  it('falls back to virtual-hosted AWS URL', () => {
    const s = new S3Storage({ region: 'eu-west-1', accessKeyId: 'k', secretAccessKey: 's' })
    expect(s.getPublicUrl('bucket', 'a.png')).toBe(
      'https://bucket.s3.eu-west-1.amazonaws.com/a.png'
    )
  })
})

describe('S3Storage file operations', () => {
  const make = () =>
    new S3Storage({ region: 'us-east-1', accessKeyId: 'k', secretAccessKey: 's' })

  it('upload sends PutObject and returns public URL', async () => {
    send.mockResolvedValueOnce({})
    const s = make()
    const res = await s.upload('avatars', 'u/p.jpg', new Blob(['x']), {
      contentType: 'image/jpeg',
    })
    expect(res.error).toBeNull()
    expect(res.data).toBe('https://avatars.s3.us-east-1.amazonaws.com/u/p.jpg')
    const cmd = send.mock.calls[0][0] as FakeCommand
    expect(cmd.input.Bucket).toBe('avatars')
    expect(cmd.input.Key).toBe('u/p.jpg')
    expect(cmd.input.ContentType).toBe('image/jpeg')
  })

  it('exists returns false on NotFound without surfacing an error', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NotFound' }))
    const s = make()
    const res = await s.exists('avatars', 'missing.jpg')
    expect(res).toEqual({ data: false, error: null })
  })

  it('delete sends DeleteObject', async () => {
    send.mockResolvedValueOnce({})
    const s = make()
    const res = await s.delete('avatars', 'u/p.jpg')
    expect(res.data).toBe(true)
    const cmd = send.mock.calls[0][0] as FakeCommand
    expect((cmd.input.Delete as any).Objects[0].Key).toBe('u/p.jpg')
  })

  it('createSignedUrl returns the presigned URL', async () => {
    const s = make()
    const res = await s.createSignedUrl('avatars', 'u/p.jpg', { expiresIn: 60 })
    expect(res.data).toBe('https://signed.example/object?sig=abc')
    expect(res.error).toBeNull()
  })
})

describe('createStorage factory (s3/r2)', () => {
  it('throws when s3 credentials are missing', () => {
    expect(() => createStorage({ provider: 's3', region: 'us-east-1' })).toThrow(
      /accessKeyId and secretAccessKey/
    )
  })

  it('builds an S3Storage for s3 with credentials', () => {
    const s = createStorage({
      provider: 's3',
      region: 'us-east-1',
      accessKeyId: 'k',
      secretAccessKey: 's',
    })
    expect(s).toBeInstanceOf(S3Storage)
  })

  it('builds an S3Storage for r2 with endpoint', () => {
    const s = createStorage({
      provider: 'r2',
      accessKeyId: 'k',
      secretAccessKey: 's',
      endpoint: 'https://acct.r2.cloudflarestorage.com',
    })
    expect(s).toBeInstanceOf(S3Storage)
  })
})
