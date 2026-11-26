/**
 * Whether uploads go to Vercel Blob (true) or public/media on disk (false).
 * Blob needs BLOB_READ_WRITE_TOKEN; MEDIA_STORAGE=local forces disk even when the token is set,
 * e.g. while the Blob store is unavailable or for files that were only stored locally.
 */
export const useBlobStorage =
  Boolean(process.env.BLOB_READ_WRITE_TOKEN) && process.env.MEDIA_STORAGE !== 'local'
