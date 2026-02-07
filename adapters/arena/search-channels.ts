//NOTE(self): Search Are.na channels by keyword
//NOTE(self): Used when someone asks for images on a topic and we need to find relevant channels
//NOTE(self): Are.na public API: GET /v2/search/channels?q=TERM

import type { ArenaResult } from '@adapters/arena/types.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');
const VERSION = pkg.version || '0.0.0';

const ARENA_API = 'https://api.are.na/v2';

export interface ArenaSearchChannel {
  id: number;
  title: string;
  slug: string;
  length: number;
  status: string;
  user: {
    id: number;
    slug: string;
    username: string;
    full_name: string;
  };
}

export interface SearchChannelsResponse {
  channels: ArenaSearchChannel[];
  totalResults: number;
}

export interface SearchChannelsParams {
  query: string;
  page?: number;
  per?: number;
}

//NOTE(self): Search Are.na for channels matching a keyword
//NOTE(self): Returns channels sorted by relevance, filtered to those with images
export async function searchChannels(
  params: SearchChannelsParams
): Promise<ArenaResult<SearchChannelsResponse>> {
  const { query, page = 1, per = 10 } = params;

  if (!query.trim()) {
    return { success: false, error: 'Search query cannot be empty' };
  }

  try {
    const searchParams = new URLSearchParams();
    searchParams.set('q', query.trim());
    searchParams.set('page', String(page));
    searchParams.set('per', String(per));

    const url = `${ARENA_API}/search/channels?${searchParams}`;

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

    //NOTE(self): API returns { channels: [...], total_pages, current_page, per, length }
    const channels: ArenaSearchChannel[] = (data.channels || []).map(
      (ch: Record<string, unknown>) => ({
        id: ch.id,
        title: ch.title,
        slug: ch.slug,
        length: ch.length || 0,
        status: ch.status || 'public',
        user: ch.user || { id: 0, slug: '', username: '', full_name: '' },
      })
    );

    //NOTE(self): Filter to channels with at least a few blocks (empty channels aren't useful)
    const meaningful = channels.filter((ch) => ch.length >= 3);

    return {
      success: true,
      data: {
        channels: meaningful,
        totalResults: data.length || channels.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}
