import { getSession, getAuthHeaders } from '@adapters/atproto/authenticate.js';
import type { AtprotoResult } from '@adapters/atproto/types.js';
import type { BlobRef } from '@adapters/atproto/upload-blob.js';
import { blueskyFetch } from './rate-limit.js';

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

//NOTE(self): Facet for rich text (links, mentions, tags)
interface Facet {
  index: {
    byteStart: number;
    byteEnd: number;
  };
  features: Array<{
    $type: string;
    uri?: string;
    did?: string;
    tag?: string;
  }>;
}

//NOTE(self): Detect @mentions in text and return handle + character positions
//NOTE(self): Regex based on AT Protocol spec — handles are domain-like (segments.separated.by.dots)
function detectMentions(text: string): { handle: string; start: number; end: number }[] {
  const mentionRegex = /(^|[\s(])(@(([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))/g;
  const matches: { handle: string; start: number; end: number }[] = [];

  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const prefix = match[1];
    const mentionWithAt = match[2];
    const handle = match[3];

    const start = match.index + prefix.length;
    const end = start + mentionWithAt.length;

    matches.push({ handle, start, end });
  }

  return matches;
}

//NOTE(self): Detect $CASHTAG patterns in text (e.g. $TSMC, $AAPL, $NVDA)
//NOTE(self): Uses app.bsky.richtext.facet#tag so they show up as clickable tags on Bluesky
function detectCashtags(text: string): { tag: string; start: number; end: number }[] {
  const cashtagRegex = /(^|[\s(])(\$([A-Z]{1,6}))(?=[\s).,!?;:\-]|$)/g;
  const matches: { tag: string; start: number; end: number }[] = [];

  let match;
  while ((match = cashtagRegex.exec(text)) !== null) {
    const prefix = match[1];
    const cashtagWithDollar = match[2];
    const tag = match[3];

    const start = match.index + prefix.length;
    const end = start + cashtagWithDollar.length;

    matches.push({ tag, start, end });
  }

  return matches;
}

//NOTE(self): Detect #hashtag patterns in text (e.g. #TypeScript, #design, #ai)
//NOTE(self): Uses app.bsky.richtext.facet#tag so they show up as clickable tags on Bluesky
function detectHashtags(text: string): { tag: string; start: number; end: number }[] {
  const hashtagRegex = /(^|[\s(])(#([a-zA-Z][a-zA-Z0-9_-]*))(?=[\s).,!?;:\-]|$)/g;
  const matches: { tag: string; start: number; end: number }[] = [];

  let match;
  while ((match = hashtagRegex.exec(text)) !== null) {
    const prefix = match[1];
    const hashtagWithHash = match[2];
    const tag = match[3];

    const start = match.index + prefix.length;
    const end = start + hashtagWithHash.length;

    matches.push({ tag, start, end });
  }

  return matches;
}

//NOTE(self): Resolve a Bluesky handle to its DID for mention facets
async function resolveHandleToDid(handle: string): Promise<string | null> {
  try {
    const response = await blueskyFetch(
      `${BSKY_SERVICE}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );
    if (!response.ok) return null;
    const { did } = await response.json();
    return did;
  } catch {
    return null;
  }
}

//NOTE(self): Detect URLs in text and create link facets
//NOTE(self): Handles both protocol URLs (https://...) and bare domain URLs (github.com/...)
//NOTE(self): Bare URLs get https:// prepended in the facet URI so they're clickable
function detectUrls(text: string): { url: string; start: number; end: number }[] {
  const matches: { url: string; start: number; end: number }[] = [];
  const claimed = new Set<number>();

  //NOTE(self): Pass 1: Protocol URLs (https://... or http://...)
  const protocolRegex = /https?:\/\/[^\s<>"\]]+/g;
  let match;
  while ((match = protocolRegex.exec(text)) !== null) {
    let url = match[0];
    //NOTE(self): Strip trailing punctuation that's almost certainly sentence-ending, not part of URL
    url = url.replace(/[.,;:!?)]+$/, '');
    for (let i = match.index; i < match.index + url.length; i++) claimed.add(i);
    matches.push({
      url,
      start: match.index,
      end: match.index + url.length,
    });
  }

  //NOTE(self): Pass 2: Bare domain URLs (e.g. github.com/username)
  //NOTE(self): Only match well-known domains to avoid false positives
  const bareRegex = /(^|[\s(])((?:github\.com|gitlab\.com|bitbucket\.org|npmjs\.com|crates\.io|pypi\.org)\/[^\s<>"\])]+)/g;
  while ((match = bareRegex.exec(text)) !== null) {
    const prefix = match[1];
    let bare = match[2];
    bare = bare.replace(/[.,;:!?)]+$/, '');
    const start = match.index + prefix.length;
    //NOTE(self): Skip if this range was already claimed by a protocol URL
    if (claimed.has(start)) continue;
    matches.push({
      url: `https://${bare}`,
      start,
      end: start + bare.length,
    });
  }

  return matches;
}

//NOTE(self): Convert character offset to byte offset (for UTF-8)
function charToByteOffset(text: string, charOffset: number): number {
  const encoder = new TextEncoder();
  return encoder.encode(text.slice(0, charOffset)).length;
}

//NOTE(self): Check if URL is a Bluesky post URL and extract info
function parseBskyPostUrl(url: string): { handle: string; rkey: string } | null {
  //NOTE(self): Format: https://bsky.app/profile/{handle}/post/{rkey}
  const match = url.match(/^https?:\/\/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/);
  if (match) {
    return { handle: match[1], rkey: match[2] };
  }
  return null;
}

//NOTE(self): Resolve a Bluesky post URL to its AT URI and CID
async function resolvePostUrl(handle: string, rkey: string): Promise<{ uri: string; cid: string } | null> {
  try {
    //NOTE(self): First resolve handle to DID
    const resolveResponse = await blueskyFetch(
      `${BSKY_SERVICE}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );

    if (!resolveResponse.ok) return null;

    const { did } = await resolveResponse.json();

    //NOTE(self): Then get the post record
    const postResponse = await blueskyFetch(
      `${BSKY_SERVICE}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=app.bsky.feed.post&rkey=${encodeURIComponent(rkey)}`
    );

    if (!postResponse.ok) return null;

    const postData = await postResponse.json();
    return {
      uri: postData.uri,
      cid: postData.cid,
    };
  } catch {
    return null;
  }
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

    //NOTE(self): Detect URLs and create facets
    const urls = detectUrls(params.text);
    const facets: Facet[] = [];
    let quoteEmbed: { uri: string; cid: string } | null = null;

    for (const { url, start, end } of urls) {
      //NOTE(self): Check if this is a Bluesky post URL
      const bskyPost = parseBskyPostUrl(url);

      if (bskyPost && !quoteEmbed) {
        //NOTE(self): Try to resolve and embed the post (only first one)
        const resolved = await resolvePostUrl(bskyPost.handle, bskyPost.rkey);
        if (resolved) {
          quoteEmbed = resolved;
        }
      }

      //NOTE(self): Create link facet for all URLs (makes them clickable)
      facets.push({
        index: {
          byteStart: charToByteOffset(params.text, start),
          byteEnd: charToByteOffset(params.text, end),
        },
        features: [{
          $type: 'app.bsky.richtext.facet#link',
          uri: url,
        }],
      });
    }

    //NOTE(self): Detect @mentions and create mention facets
    //NOTE(self): Resolve handles to DIDs in parallel for efficiency
    const mentions = detectMentions(params.text);
    if (mentions.length > 0) {
      const resolutions = await Promise.all(
        mentions.map(async (m) => ({
          ...m,
          did: await resolveHandleToDid(m.handle),
        }))
      );

      for (const { did, start, end } of resolutions) {
        if (did) {
          facets.push({
            index: {
              byteStart: charToByteOffset(params.text, start),
              byteEnd: charToByteOffset(params.text, end),
            },
            features: [{
              $type: 'app.bsky.richtext.facet#mention',
              did,
            }],
          });
        }
      }
    }

    //NOTE(self): Detect $CASHTAG patterns and create tag facets
    const cashtags = detectCashtags(params.text);
    for (const { tag, start, end } of cashtags) {
      facets.push({
        index: {
          byteStart: charToByteOffset(params.text, start),
          byteEnd: charToByteOffset(params.text, end),
        },
        features: [{
          $type: 'app.bsky.richtext.facet#tag',
          tag,
        }],
      });
    }

    //NOTE(self): Detect #hashtag patterns and create tag facets
    const hashtags = detectHashtags(params.text);
    for (const { tag, start, end } of hashtags) {
      facets.push({
        index: {
          byteStart: charToByteOffset(params.text, start),
          byteEnd: charToByteOffset(params.text, end),
        },
        features: [{
          $type: 'app.bsky.richtext.facet#tag',
          tag,
        }],
      });
    }

    //NOTE(self): Add facets if any URLs, mentions, or tags found
    if (facets.length > 0) {
      record.facets = facets;
    }

    //NOTE(self): Handle embeds - images take priority, then quote posts
    if (params.images && params.images.length > 0) {
      record.embed = {
        $type: 'app.bsky.embed.images',
        images: params.images.map((img) => {
          const imageEmbed: Record<string, unknown> = {
            alt: img.alt,
            image: img.image,
          };
          if (img.aspectRatio) {
            imageEmbed.aspectRatio = img.aspectRatio;
          }
          return imageEmbed;
        }),
      };
    } else if (quoteEmbed) {
      //NOTE(self): Embed the quoted post
      record.embed = {
        $type: 'app.bsky.embed.record',
        record: {
          uri: quoteEmbed.uri,
          cid: quoteEmbed.cid,
        },
      };
    }

    const response = await blueskyFetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record,
      }),
    });

    if (!response.ok) {
      let errorMsg = `Failed to create post: ${response.status}`;
      try { const error = await response.json(); errorMsg = error.message || errorMsg; } catch { /* non-JSON response */ }
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    return { success: true, data: { uri: data.uri, cid: data.cid } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
