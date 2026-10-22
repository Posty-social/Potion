// Input handling for the MCP `upload_asset` tool: decode or fetch the bytes,
// confirm they really are an image, and pick a URL-safe file name. Storage
// itself (R2 + the asset table) lives in the workspace repository.

import { z } from 'zod'

import { assetUploadLimit, maxImageUploadBytes } from '#/lib/assets/intents'
import { WorkspaceRepositoryError } from '#/lib/workspace/repository'

export const uploadAssetInputSchema = z
  .object({
    fileName: z.string().min(1).max(180).optional(),
    mime: z
      .string()
      .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i)
      .optional(),
    // Base64 image bytes; a `data:image/png;base64,` prefix is accepted.
    data: z.string().min(1).optional(),
    // Alternatively, an https URL the server fetches.
    url: z.string().url().optional(),
  })
  .refine((input) => Boolean(input.data) !== Boolean(input.url), {
    message: 'Provide exactly one of `data` (base64) or `url`.',
  })

export type UploadAssetInput = z.infer<typeof uploadAssetInputSchema>

const SNIFFED_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

function invalid(message: string): WorkspaceRepositoryError {
  return new WorkspaceRepositoryError('invalid_input', message)
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0))
}

/** The image type from the file's magic bytes, or null if unrecognized. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  if (startsWith(bytes, ascii('GIF8'))) {
    return 'image/gif'
  }
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) {
    return 'image/webp'
  }
  if (
    startsWith(bytes, ascii('ftyp'), 4) &&
    (startsWith(bytes, ascii('avif'), 8) || startsWith(bytes, ascii('avis'), 8))
  ) {
    return 'image/avif'
  }
  return null
}

/** Decode base64 (optionally a data: URL) to bytes. */
export function decodeBase64(data: string): Uint8Array {
  const payload = data.replace(/^data:[^;,]*;base64,/i, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(payload)) {
    throw invalid('`data` is not valid base64.')
  }
  const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const tooLarge = () =>
  invalid(
    `Image is too large (max ${Math.round(maxImageUploadBytes / 1024 / 1024)}MB).`,
  )

/** Fetch an https image, refusing anything over the image size limit. */
export async function fetchImageBytes(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') {
    throw invalid('`url` must be an https URL.')
  }
  if (parsed.username || parsed.password) {
    throw invalid('`url` must not contain credentials.')
  }

  let response: Response
  try {
    response = await fetchImpl(parsed.toString(), {
      redirect: 'follow',
      headers: { accept: 'image/*' },
    })
  } catch {
    throw invalid(`Could not fetch ${url}.`)
  }
  if (!response.ok) {
    throw invalid(`Fetching ${url} failed with HTTP ${response.status}.`)
  }
  if (Number(response.headers.get('content-length')) > maxImageUploadBytes) {
    throw tooLarge()
  }

  // Read with a running cap so a missing/lying content-length can't make the
  // Worker buffer an unbounded body.
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (let done = !reader; !done; ) {
    // Stream chunks arrive in order; each read must wait for the previous one.
    // oxlint-disable-next-line no-await-in-loop
    const next = await (
      reader as ReadableStreamDefaultReader<Uint8Array>
    ).read()
    done = next.done
    if (next.value) {
      total += next.value.byteLength
      if (total > maxImageUploadBytes) {
        // oxlint-disable-next-line no-await-in-loop
        await reader?.cancel()
        throw tooLarge()
      }
      chunks.push(next.value)
    }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { bytes, contentType: response.headers.get('content-type') }
}

/**
 * A URL-safe file name with an extension matching the detected type. Only
 * `[A-Za-z0-9._-]` survive so the `/api/assets/…` path works unencoded in
 * Markdown and `<img src>`.
 */
export function safeAssetFileName(
  requested: string | undefined,
  mime: string,
): string {
  const extension = SNIFFED_EXTENSIONS[mime] ?? 'img'
  const base = (requested ?? '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100)
  return `${base || 'image'}.${extension}`
}

/**
 * Resolve `upload_asset` input to validated image bytes, its detected MIME
 * type and a safe file name. Only raster images (PNG, JPEG, GIF, WebP, AVIF)
 * within the image upload limit are accepted.
 */
export async function prepareAssetUpload(
  input: UploadAssetInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; mime: string; fileName: string }> {
  if (input.mime && assetUploadLimit(input.mime) !== maxImageUploadBytes) {
    throw invalid(`Only images can be uploaded (got ${input.mime}).`)
  }

  const bytes = input.data
    ? decodeBase64(input.data)
    : (await fetchImageBytes(input.url as string, fetchImpl)).bytes

  if (bytes.byteLength === 0) {
    throw invalid('The image is empty.')
  }
  if (bytes.byteLength > maxImageUploadBytes) {
    throw tooLarge()
  }

  const mime = sniffImageMime(bytes)
  if (!mime) {
    throw invalid(
      'The data is not a supported image. Upload PNG, JPEG, GIF, WebP or AVIF (SVG is not accepted).',
    )
  }

  const requestedName =
    input.fileName ??
    (input.url ? new URL(input.url).pathname.split('/').pop() : undefined)

  return { bytes, mime, fileName: safeAssetFileName(requestedName, mime) }
}
