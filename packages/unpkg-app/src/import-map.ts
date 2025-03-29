export interface ImportMap {
  imports: ModuleSpecifierMap;
  integrity?: IntegrityMetadataMap;
  scopes?: {
    [scope: string]: ModuleSpecifierMap;
  };
}

export interface ModuleSpecifierMap {
  [specifier: string]: string;
}

export interface IntegrityMetadataMap {
  [url: string]: string;
}
