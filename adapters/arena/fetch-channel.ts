//NOTE(self): Fetch Are.na channel blocks via public API

import type { ArenaResult, ArenaChannel, ArenaBlock } from '@adapters/arena/types.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');
const VERSION = pkg.version || '0.0.0';

const ARENA_API = 'https://api.are.na/v2';

export interface FetchChannelParams {
  owner: string;
  slug: string;
  page?: number;
  per?: number;
}

export interface FetchChannelResponse {
  channel: ArenaChannel;
  imageBlocks: ArenaBlock[];
  totalBlocks: number;
}

//NOTE(self): Parse channel URL to extract owner and slug
export function parseChannelUrl(url: string): { owner: string; slug: string } | null {
  //NOTE(self): Handle URLs like https://www.are.na/www-jim/rpg-ui-01
  const match = url.match(/are\.na\/([^\/]+)\/([^\/\?#]+)/);
  if (match) {
    return { owner: match[1], slug: match[2] };
  }
  return null;
}

export async function fetchChannel(
  params: FetchChannelParams
): Promise<ArenaResult<FetchChannelResponse>> {
  const { owner, slug, page = 1, per = 50 } = params;

  try {
    //NOTE(self): Are.na API uses slug directly for channel lookup
    const url = `${ARENA_API}/channels/${slug}/contents?page=${page}&per=${per}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': `ts-general-agent/${VERSION} (Autonomous Agent)`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
      };
    }

    const data = await response.json();

    //NOTE(self): The contents endpoint returns { contents: Block[], ... }
    const contents: ArenaBlock[] = data.contents || [];

    //NOTE(self): Filter to only image blocks with valid image URLs
    const imageBlocks = contents.filter(
      (block): block is ArenaBlock =>
        block.class === 'Image' && block.image?.original?.url != null
    );

    return {
      success: true,
      data: {
        channel: {
          id: data.id,
          title: data.title,
          slug: data.slug,
          length: data.length,
          contents,
        },
        imageBlocks,
        totalBlocks: contents.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}
