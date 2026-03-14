import { Compiler } from '../compiler/compiler.ts';
import {
  FileSystemConfigFileReader,
  RecursiveConfigPathResolver,
} from '../config/filesystem.ts';
import { DefaultConfigLoader } from '../config/loader.ts';
import { ZodConfigDocumentParser } from '../config/schemas.ts';
import { DeploymentPlanner } from '../planner/planner.ts';
import { createCloudflareProvider } from '../providers/cloudflare/provider.ts';
import { createHostProvider } from '../providers/host/provider.ts';
import { createVultrProvider } from '../providers/vultr/provider.ts';
import { EnvironmentSecretResolver } from '../secrets/environment-resolver.ts';
import type {
  CompileResult,
  LoadedConfig,
  ResourceDefinition,
  SecretReference,
} from '../types/compiler.ts';
import type { DeploymentPlan } from '../types/planner.ts';
import type { Provider, ProviderName, ResourceType } from '../types/providers.ts';

export interface EngineSnapshot {
  readonly loadedConfig: LoadedConfig;
  readonly compileResult: CompileResult;
}

export class DeploymentEngine {
  private readonly loader: DefaultConfigLoader;
  private readonly compiler: Compiler;
  private readonly planner: DeploymentPlanner;
  private readonly providers: ReadonlyMap<ProviderName, Provider>;

  public constructor() {
    const secretResolver = new EnvironmentSecretResolver();
    const providers = new Map<ProviderName, Provider>([
      ['cloudflare', createCloudflareProvider()],
      ['host', createHostProvider()],
      ['vultr', createVultrProvider()],
    ]);

    this.loader = new DefaultConfigLoader({
      pathResolver: new RecursiveConfigPathResolver(),
      fileReader: new FileSystemConfigFileReader(),
      documentParser: new ZodConfigDocumentParser(),
    });
    this.compiler = new Compiler({
      resolveSecret: (reference) =>
        resolveSecretReference(secretResolver, reference),
    });
    this.planner = new DeploymentPlanner({
      providers,
    });
    this.providers = providers;
  }

  public async loadAndCompile(
    deploymentRootPath: string,
  ): Promise<EngineSnapshot> {
    const loadedConfig = await this.loader.load(deploymentRootPath);
    const compileResult = this.compiler.compile({
      loadedConfig,
      now: new Date(),
    });

    return {
      loadedConfig,
      compileResult,
    };
  }

  public async validate(deploymentRootPath: string): Promise<EngineSnapshot> {
    const snapshot = await this.loadAndCompile(deploymentRootPath);

    if (snapshot.loadedConfig.documents.length === 0) {
      throw new Error(`No YAML config documents were found in "${deploymentRootPath}".`);
    }

    await this.validateResources(snapshot.compileResult.graph.resources);

    return snapshot;
  }

  public async plan(deploymentRootPath: string): Promise<{
    readonly snapshot: EngineSnapshot;
    readonly plan: DeploymentPlan;
  }> {
    const snapshot = await this.validate(deploymentRootPath);
    const plan = await this.planner.createPlanFromCompileResult({
      compileResult: snapshot.compileResult,
    });

    return {
      snapshot,
      plan,
    };
  }

  private async validateResources(
    resources: readonly ResourceDefinition[],
  ): Promise<void> {
    for (const resource of resources) {
      const providerName = mapProviderName(resource.provider);
      const provider = this.providers.get(providerName);

      if (!provider) {
        throw new Error(
          `No provider is registered for resource "${resource.name}" (${resource.provider}).`,
        );
      }

      await provider.validateResource({
        provider: providerName,
        type: mapResourceType(resource.type),
        name: resource.name,
        desired: resource.desired,
        dependsOn: [...resource.dependsOn],
      });
    }
  }
}

function mapProviderName(
  resourceProvider: ResourceDefinition['provider'],
): ProviderName {
  if (resourceProvider === 'internal' || resourceProvider === 'discord') {
    return 'host';
  }

  return resourceProvider;
}

function mapResourceType(resourceType: ResourceDefinition['type']): ResourceType {
  switch (resourceType) {
    case 'cloudflare.dns-record':
      return 'cloudflare_dns_record';
    case 'cloudflare.tunnel':
      return 'cloudflare_tunnel';
    case 'cloudflare.access-application':
      return 'cloudflare_access_application';
    case 'cloudflare.access-policy':
      return 'cloudflare_access_policy';
    case 'docker.compose-stack':
      return 'docker_compose_stack';
    case 'docker.network':
      return 'docker_network';
    case 'host.directory':
      return 'file';
    case 'host.file':
      return 'file';
    case 'host.package':
      return 'file';
    case 'host.systemd-unit':
      return 'systemd_service';
    case 'integration.discord-binding':
      return 'health_check';
    case 'integration.ovh-binding':
      return 'health_check';
    case 'internal.service-binding':
      return 'health_check';
    case 'vultr.firewall-group':
      return 'vultr_firewall';
    case 'vultr.instance':
      return 'vultr_instance';
  }
}

function resolveSecretReference(
  secretResolver: EnvironmentSecretResolver,
  reference: SecretReference,
): string {
  if (!secretResolver.canResolve(reference)) {
    throw new Error(
      `Unsupported secret provider "${reference.provider}" for "${reference.key}".`,
    );
  }

  return secretResolver.resolve(reference);
}
