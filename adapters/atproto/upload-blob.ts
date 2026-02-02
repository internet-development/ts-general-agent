import { getSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';
import type { AtprotoResult } from '@adapters/atproto/types.js';

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

    const response = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.uploadBlob`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.accessJwt}`,
        'Content-Type': mimeType,
      },
      body: arrayBuffer,
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to upload blob' };
    }

    const result = await response.json();
    return { success: true, data: { blob: result.blob } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

//NOTE(self): Upload image from base64 encoded string
export async function uploadImageFromBase64(
  base64Data: string,
  mimeType: string
): Promise<AtprotoResult<UploadBlobResponse>> {
  const buffer = Buffer.from(base64Data, 'base64');
  return uploadBlob(buffer, mimeType);
}
