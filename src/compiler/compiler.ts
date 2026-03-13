import type {
  CompileResult,
  CompilerContext,
  ConfigCompiler,
  ConfigDocument,
  ConfigDocumentKind,
  DeploymentConfigDocument,
  ProvidersConfigDocument,
  ResourceDefinition,
  ResourceGraph,
} from '../types/compiler.ts';

export class Compiler implements ConfigCompiler {
  public compile(context: CompilerContext): CompileResult {
    const deploymentDocument = this.getDeploymentDocument(context.loadedConfig);
    const providersDocument = this.getProvidersDocument(context.loadedConfig);

    const deploymentName = deploymentDocument?.name ?? 'unknown-deployment';
    const environmentName =
      deploymentDocument?.environment ?? 'unknown-environment';
    const configVersion = deploymentDocument?.version ?? 'unknown-version';

    const resources = this.buildResources({
      deploymentDocument,
      providersDocument,
    });

    const graph: ResourceGraph = {
      resources,
      resourceIds: new Set(resources.map((resource) => resource.id)),
    };

    return {
      deployment: {
        name: deploymentName,
        environment: environmentName,
        generatedAt: context.now.toISOString(),
        configVersion,
      },
      graph,
      warnings: [],
    };
  }

  private getDeploymentDocument(
    loadedConfig: CompilerContext['loadedConfig'],
  ): DeploymentConfigDocument | null {
    return this.getFirstDocumentByKind(
      loadedConfig,
      'deployment',
      isDeploymentConfigDocument,
    );
  }

  private getProvidersDocument(
    loadedConfig: CompilerContext['loadedConfig'],
  ): ProvidersConfigDocument | null {
    return this.getFirstDocumentByKind(
      loadedConfig,
      'providers',
      isProvidersConfigDocument,
    );
  }

  private getFirstDocumentByKind<TDocument extends ConfigDocument>(
    loadedConfig: CompilerContext['loadedConfig'],
    kind: ConfigDocumentKind,
    isExpectedDocument: (document: ConfigDocument) => document is TDocument,
  ): TDocument | null {
    const matchingDocuments = loadedConfig.documentsByKind.get(kind);

    if (!matchingDocuments || matchingDocuments.length === 0) {
      return null;
    }

    const [firstDocument] = matchingDocuments;

    if (!firstDocument || !isExpectedDocument(firstDocument)) {
      return null;
    }

    return firstDocument;
  }

  private buildResources(input: {
    deploymentDocument: DeploymentConfigDocument | null;
    providersDocument: ProvidersConfigDocument | null;
  }): ResourceDefinition[] {
    const resources: ResourceDefinition[] = [];

    const deploymentDocument = input.deploymentDocument;
    const providersDocument = input.providersDocument;

    if (!deploymentDocument) {
      return resources;
    }

    const deploymentTags = {
      deployment: deploymentDocument.name,
      environment: deploymentDocument.environment,
    } as const;

    if (providersDocument?.vultr) {
      resources.push({
        id: 'vultr.instance.main',
        type: 'vultr.instance',
        name: deploymentDocument.target.instanceName,
        provider: 'vultr',
        desired: {
          region: providersDocument.vultr.region,
          plan: providersDocument.vultr.plan,
          image: providersDocument.vultr.image,
          hostname: providersDocument.vultr.hostname,
        },
        dependsOn: [],
        tags: deploymentTags,
      });
    }

    if (providersDocument?.cloudflare) {
      resources.push({
        id: 'cloudflare.dns-record.gateway',
        type: 'cloudflare.dns-record',
        name: deploymentDocument.target.instanceName,
        provider: 'cloudflare',
        desired: {
          target: {
            type: 'instance-public-ip',
            resourceId: 'vultr.instance.main',
          },
        },
        dependsOn: ['vultr.instance.main'],
        tags: deploymentTags,
      });
    }

    return resources;
  }
}

function isDeploymentConfigDocument(
  document: ConfigDocument,
): document is DeploymentConfigDocument {
  return document.kind === 'deployment';
}

function isProvidersConfigDocument(
  document: ConfigDocument,
): document is ProvidersConfigDocument {
  return document.kind === 'providers';
}
