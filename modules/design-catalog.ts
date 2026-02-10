//NOTE(self): Design Inspiration Catalog
//NOTE(self): A catalog of websites and channels SOULs browse for design inspiration.
//NOTE(self): Each source has a type (arena for API-backed, web for generic browsing) and a URL.
//NOTE(self): SOULs pick a random source during expression cycles to share what they find.

export interface DesignSource {
  type: 'arena' | 'web';
  url: string;
  name: string;
  tags?: string[];
  browseUrls?: string[];
}

//NOTE(self): Starting catalog — owner can expand via SELF.md or config
const DESIGN_CATALOG: DesignSource[] = [
  {
    type: 'web',
    url: 'https://searchsystem.co/',
    name: 'Search System',
    tags: ['typography', 'branding', 'architecture', 'product', 'photography'],
    browseUrls: [
      'https://searchsystem.co/',
      'https://searchsystem.co/tagged/typography',
      'https://searchsystem.co/tagged/architecture',
      'https://searchsystem.co/tagged/branding',
      'https://searchsystem.co/tagged/product',
    ],
  },
  {
    type: 'arena',
    url: 'https://www.are.na/www-jim/rpg-ui-01',
    name: 'RPG UI',
    tags: ['ui', 'gaming', 'interface', 'rpg'],
  },
];

//NOTE(self): Get a random source from the catalog
export function getRandomDesignSource(): DesignSource {
  return DESIGN_CATALOG[Math.floor(Math.random() * DESIGN_CATALOG.length)];
}

//NOTE(self): Get all sources
export function getDesignCatalog(): DesignSource[] {
  return [...DESIGN_CATALOG];
}

//NOTE(self): Get sources by type
export function getDesignSourcesByType(type: DesignSource['type']): DesignSource[] {
  return DESIGN_CATALOG.filter(s => s.type === type);
}

//NOTE(self): Get a random browse URL for a web source
export function getRandomBrowseUrl(source: DesignSource): string {
  if (source.browseUrls && source.browseUrls.length > 0) {
    return source.browseUrls[Math.floor(Math.random() * source.browseUrls.length)];
  }
  return source.url;
}
