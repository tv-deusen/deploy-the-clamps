import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
	ConfigCompiler,
	ConfigDocument,
	ConfigDocumentKind,
	ConfigDocumentParser,
	LoadedConfig,
	ParsedDocumentResult,
	RawYamlDocument,
} from '../types/compiler.ts';

const YAML_FILE_EXTENSIONS = new Set(['.yaml', '.yml']);

export interface ConfigLoader {
	load(deploymentRootPath: string): Promise<LoadedConfig>;
}

export interface ConfigFileReader {
	readFile(filePath: string): Promise<string>;
}

export interface ConfigPathResolver {
	findConfigPaths(deploymentRootPath: string): Promise<readonly string[]>;
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
		const parsedDocuments = await this.loadDocuments(configPaths);
		const documents = parsedDocuments.map((result) => result.document);
		const documentsByKind = groupDocumentsByKind(documents);
		const warnings = parsedDocuments.flatMap((result) => result.warnings);

		return {
			documents,
			documentsByKind,
			warnings,
		};
	}

	private async loadDocuments(
		configPaths: readonly string[],
	): Promise<readonly ParsedDocumentResult[]> {
		return await Promise.all(
			configPaths.map(async (configPath) => {
				const fileContents = await this.fileReader.readFile(configPath);
				const rawDocument = parseRawYamlDocument(
					configPath,
					fileContents,
				);

				return this.documentParser.parseDocument(rawDocument);
			}),
		);
	}
}

export class NodeConfigFileReader implements ConfigFileReader {
	public async readFile(filePath: string): Promise<string> {
		return await readFile(filePath, 'utf8');
	}
}

export class FilesystemConfigPathResolver implements ConfigPathResolver {
	public async findConfigPaths(
		deploymentRootPath: string,
	): Promise<readonly string[]> {
		const configDirectoryPath = join(deploymentRootPath, 'config');
		const directoryEntries = await readdir(configDirectoryPath, {
			withFileTypes: true,
		});

		const configPaths = directoryEntries
			.filter(
				(entry) => entry.isFile() && hasYamlFileExtension(entry.name),
			)
			.map((entry) => join(configDirectoryPath, entry.name))
			.sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));

		return configPaths;
	}
}

function parseRawYamlDocument(
	sourcePath: string,
	fileContents: string,
): RawYamlDocument {
	const parsedValue = parseYaml(fileContents);

	return {
		sourcePath,
		parsedValue,
	};
}

function hasYamlFileExtension(fileName: string): boolean {
	const extensionStartIndex = fileName.lastIndexOf('.');

	if (extensionStartIndex < 0) {
		return false;
	}

	const extension = fileName.slice(extensionStartIndex).toLowerCase();
	return YAML_FILE_EXTENSIONS.has(extension);
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
