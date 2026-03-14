import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ConfigFileReader,
  ConfigPathResolver,
} from './loader.ts';

const ignoredDirectoryNames = new Set(['.git', 'node_modules']);

export class FileSystemConfigFileReader implements ConfigFileReader {
  public async readFile(filePath: string): Promise<string> {
    return await readFile(filePath, 'utf8');
  }
}

export class RecursiveConfigPathResolver implements ConfigPathResolver {
  public async findConfigPaths(
    deploymentRootPath: string,
  ): Promise<readonly string[]> {
    const collectedPaths = await this.walkDirectory(deploymentRootPath);

    return collectedPaths.sort((left, right) => left.localeCompare(right));
  }

  private async walkDirectory(directoryPath: string): Promise<string[]> {
    const entries = await readdir(directoryPath, {
      withFileTypes: true,
    });
    const collectedPaths: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoredDirectoryNames.has(entry.name)) {
          continue;
        }

        collectedPaths.push(
          ...(await this.walkDirectory(join(directoryPath, entry.name))),
        );
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!isYamlFile(entry.name)) {
        continue;
      }

      collectedPaths.push(join(directoryPath, entry.name));
    }

    return collectedPaths;
  }
}

function isYamlFile(fileName: string): boolean {
  return fileName.endsWith('.yaml') || fileName.endsWith('.yml');
}
