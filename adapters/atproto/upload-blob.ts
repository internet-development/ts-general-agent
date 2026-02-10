import { getSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';
import type { AtprotoResult } from '@adapters/atproto/types.js';
import { logger } from '@modules/logger.js';
import { blueskyFetch } from './rate-limit.js';

const BSKY_SERVICE = 'https://bsky.social';

export interface BlobRef {
  $type: 'blob';
  ref: {
    $link: string;
  };
  mimeType: string;
  size: number;
}

export interface UploadBlobResponse {
  blob: BlobRef;
}

//NOTE(self): Upload binary data as a blob to Bluesky
export async function uploadBlob(
  data: Buffer,
  mimeType: string
): Promise<AtprotoResult<UploadBlobResponse>> {
  const session = getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    //NOTE(self): Convert Buffer to ArrayBuffer for fetch body compatibility
    //NOTE(self): Use type assertion since Node.js Buffers always use ArrayBuffer
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

    const response = await blueskyFetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.uploadBlob`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.accessJwt}`,
        'Content-Type': mimeType,
      },
      body: arrayBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to upload blob';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorJson.error || errorText;
      } catch {
        errorMessage = errorText || `HTTP ${response.status}`;
      }
      logger.error('Blob upload failed', { status: response.status, error: errorMessage });
      return { success: false, error: errorMessage };
    }

    const result = await response.json();
    logger.debug('Blob upload response', { blob: result.blob });
    return { success: true, data: { blob: result.blob } };
  } catch (error) {
    logger.error('Blob upload exception', { error: String(error) });
    return { success: false, error: String(error) };
  }
}

