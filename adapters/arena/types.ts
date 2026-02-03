//NOTE(self): Are.na API types for channel and block data

export type ArenaResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface ArenaImageUrls {
  thumb: { url: string };
  display: { url: string };
  original: { url: string };
}

export interface ArenaBlock {
  id: number;
  title: string | null;
  generated_title: string;
  description: string | null;
  description_html: string | null;
  class: 'Image' | 'Text' | 'Link' | 'Media' | 'Attachment';
  source: { url: string } | null;
  image: ArenaImageUrls | null;
  connected_at: string;
  connected_by_user_id: number;
  position: number;
  selected: boolean;
}

export interface ArenaChannel {
  id: number;
  title: string;
  slug: string;
  length: number;
  contents: ArenaBlock[];
}
