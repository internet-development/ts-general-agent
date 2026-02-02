import { getSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';
import type { AtprotoResult } from '@adapters/atproto/types.js';
import type { BlobRef } from '@adapters/atproto/upload-blob.js';

const BSKY_SERVICE = 'https://bsky.social';

export interface ImageEmbed {
  alt: string;
  image: BlobRef;
  aspectRatio?: {
    width: number;
    height: number;
  };
}

export interface CreatePostParams {
  text: string;
  replyTo?: {
    uri: string;
    cid: string;
    rootUri?: string;
    rootCid?: string;
  };
  images?: ImageEmbed[];
}

export interface CreatePostResponse {
  uri: string;
  cid: string;
}

export async function createPost(
  params: CreatePostParams
): Promise<AtprotoResult<CreatePostResponse>> {
  const session = getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text: params.text,
      createdAt: new Date().toISOString(),
    };

    if (params.replyTo) {
      record.reply = {
        parent: { uri: params.replyTo.uri, cid: params.replyTo.cid },
        root: {
          uri: params.replyTo.rootUri || params.replyTo.uri,
          cid: params.replyTo.rootCid || params.replyTo.cid,
        },
      };
    }

    //NOTE(self): Add image embeds if provided
    if (params.images && params.images.length > 0) {
      record.embed = {
        $type: 'app.bsky.embed.images',
        images: params.images.map((img) => ({
          alt: img.alt,
          image: img.image,
          aspectRatio: img.aspectRatio,
        })),
      };
    }

    const response = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Failed to create post' };
    }

    const data = await response.json();
    return { success: true, data: { uri: data.uri, cid: data.cid } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
