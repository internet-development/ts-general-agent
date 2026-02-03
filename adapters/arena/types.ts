//NOTE(self): Are.na API types for channel and block data

export type ArenaResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface ArenaImageUrls {
  thumb: { url: string };
  display: { url: string };
  original: { url: string };
}

//NOTE(self): User who added/created the block on Are.na
export interface ArenaUser {
  id: number;
  slug: string;
  username: string;
  full_name: string;
}

//NOTE(self): Source provider info for tracing where content originated
export interface ArenaSourceProvider {
  name: string;
  url: string;
}

//NOTE(self): Full source info - captures where the content was originally found
export interface ArenaSource {
  url: string;
  title?: string;
  provider?: ArenaSourceProvider;
}

export interface ArenaBlock {
  id: number;
  title: string | null;
  generated_title: string;
  description: string | null;
  description_html: string | null;
  class: 'Image' | 'Text' | 'Link' | 'Media' | 'Attachment';
  //NOTE(self): Enhanced source type for better traceability
  source: ArenaSource | null;
  image: ArenaImageUrls | null;
  connected_at: string;
  connected_by_user_id: number;
  position: number;
  selected: boolean;
  //NOTE(self): Filename as stored on Are.na filesystem - useful for credit
  filename?: string;
  //NOTE(self): The user who added this block to the channel
  user?: ArenaUser;
}

export interface ArenaChannel {
  id: number;
  title: string;
  slug: string;
  length: number;
  contents: ArenaBlock[];
}
