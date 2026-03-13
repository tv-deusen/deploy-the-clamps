import type {
  ConfigCompiler,
  ConfigDocument,
  ConfigDocumentKind,
  LoadedConfig,
} from '../types/compiler.ts';

export interface ConfigLoader {
  load(deploymentRootPath: string): Promise<LoadedConfig>;
}

export interface ConfigFileReader {
  readFile(filePath: string): Promise<string>;
}

export interface ConfigPathResolver {
  findConfigPaths(deploymentRootPath: string): Promise<readonly string[]>;
}

export interface ParsedConfigDocument {
  readonly sourcePath: string;
  readonly value: unknown;
}

export interface ConfigDocumentParser {
  parseDocument(input: ParsedConfigDocument): ConfigDocument;
}

export interface ConfigLoaderDependencies {
  readonly pathResolver: ConfigPathResolver;
  readonly fileReader: ConfigFileReader;
  readonly documentParser: ConfigDocumentParser;
}

export class DefaultConfigLoader implements ConfigLoader {
  private readonly pathResolver: ConfigPathResolver;
  private readonly fileReader: ConfigFileReader;
  private readonly documentParser: ConfigDocumentParser;

  public constructor(dependencies: ConfigLoaderDependencies) {
    this.pathResolver = dependencies.pathResolver;
    this.fileReader = dependencies.fileReader;
    this.documentParser = dependencies.documentParser;
  }

  public async load(deploymentRootPath: string): Promise<LoadedConfig> {
    const configPaths =
      await this.pathResolver.findConfigPaths(deploymentRootPath);
    const documents = await this.loadDocuments(configPaths);
    const documentsByKind = groupDocumentsByKind(documents);

    return {
      documents,
      documentsByKind,
    };
  }

  private async loadDocuments(
    configPaths: readonly string[],
  ): Promise<readonly ConfigDocument[]> {
    const documents = await Promise.all(
      configPaths.map(async (configPath) => {
        const fileContents = await this.fileReader.readFile(configPath);

        return this.documentParser.parseDocument({
          sourcePath: configPath,
          value: fileContents,
        });
      }),
    );

    return documents;
  }
}

function groupDocumentsByKind(
  documents: readonly ConfigDocument[],
): ReadonlyMap<ConfigDocumentKind, readonly ConfigDocument[]> {
  const entries = new Map<ConfigDocumentKind, ConfigDocument[]>();

  for (const document of documents) {
    const existingDocuments = entries.get(document.kind);

    if (existingDocuments) {
      existingDocuments.push(document);
      continue;
    }

    entries.set(document.kind, [document]);
  }

  return entries;
}

export type ConfigCompilePipeline = {
  readonly loader: ConfigLoader;
  readonly compiler: ConfigCompiler;
};
