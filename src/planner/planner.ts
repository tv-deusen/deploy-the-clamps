import type {
  CompileResult,
  ResourceDefinition,
  ResourceGraph,
} from '../types/compiler.ts';
import type {
  DeploymentPlan,
  PlannedChange,
  PlanSummary,
  Planner,
  PlanRiskLevel,
} from '../types/planner.ts';
import type {
  Provider,
  ProviderName,
  ProviderPlanContext,
  ProviderResourceState,
  ResourceDefinition as ProviderResourceDefinition,
} from '../types/providers.ts';

type ProviderRegistry = ReadonlyMap<ProviderName, Provider>;

export interface PlannerDependencies {
  readonly providers: ProviderRegistry;
  readonly now?: Date;
}

export interface CreateDeploymentPlanInput {
  readonly compileResult: CompileResult;
}

type ResourceWithProvider = {
  readonly resource: ResourceDefinition;
  readonly provider: Provider;
};

type ProviderStateIndex = ReadonlyMap<string, ProviderResourceState>;

export class DeploymentPlanner
  implements Planner<ResourceGraph, ResourceGraph> {
  private readonly providers: ProviderRegistry;
  private readonly now: Date;

  public constructor(dependencies: PlannerDependencies) {
    this.providers = dependencies.providers;
    this.now = dependencies.now ?? new Date();
  }

  public async createPlan(input: {
    readonly currentState: ResourceGraph;
    readonly desiredState: ResourceGraph;
  }): Promise<DeploymentPlan> {
    return await this.createPlanFromGraph(input.desiredState);
  }

  public async createPlanFromCompileResult(
    input: CreateDeploymentPlanInput,
  ): Promise<DeploymentPlan> {
    const context = this.createProviderPlanContext({
      deploymentName: input.compileResult.deployment.name,
      environmentName: input.compileResult.deployment.environment,
    });

    return await this.createPlanFromGraph(input.compileResult.graph, context);
  }

  public async createPlanFromGraph(
    desiredGraph: ResourceGraph,
    context: ProviderPlanContext = this.createProviderPlanContext(),
  ): Promise<DeploymentPlan> {
    const resourceGroups = this.groupResourcesByProvider(desiredGraph.resources);
    const plannedChanges: PlannedChange[] = [];
    const warnings: string[] = [];

    for (const [providerName, resources] of resourceGroups) {
      const provider = this.providers.get(providerName);

      if (!provider) {
        warnings.push(
          `No provider implementation is registered for "${providerName}". Resources will be skipped.`,
        );
        continue;
      }

      const indexedStates = await this.discoverCurrentState(
        provider,
        resources,
        context,
      );

      for (const { resource } of resources) {
        const currentState = indexedStates.get(resource.name) ?? null;
        const action = await provider.planResource(
          this.toProviderResourceDefinition(resource),
          currentState,
          context,
        );

        plannedChanges.push(
          this.toPlannedChange({
            resource,
            action: action.kind,
            reason: action.reason,
          }),
        );
      }
    }

    const summary = this.buildPlanSummary(plannedChanges);

    return {
      createdAt: this.now.toISOString(),
      summary,
      changes: plannedChanges,
      warnings,
    };
  }

  private createProviderPlanContext(
    override: Partial<ProviderPlanContext> = {},
  ): ProviderPlanContext {
    return {
      deploymentName: override.deploymentName ?? 'default',
      environmentName: override.environmentName ?? 'default',
    };
  }

  private groupResourcesByProvider(
    resources: readonly ResourceDefinition[],
  ): Map<ProviderName, ResourceWithProvider[]> {
    const groupedResources = new Map<ProviderName, ResourceWithProvider[]>();

    for (const resource of resources) {
      const providerName = this.mapCompilerProviderName(resource.provider);
      const provider = this.providers.get(providerName);

      if (!provider) {
        continue;
      }

      const existingGroup = groupedResources.get(providerName);

      if (existingGroup) {
        existingGroup.push({
          resource,
          provider,
        });
        continue;
      }

      groupedResources.set(providerName, [
        {
          resource,
          provider,
        },
      ]);
    }

    return groupedResources;
  }

  private async discoverCurrentState(
    provider: Provider,
    resources: readonly ResourceWithProvider[],
    context: ProviderPlanContext,
  ): Promise<ProviderStateIndex> {
    const providerResources = resources.map(({ resource }) =>
      this.toProviderResourceDefinition(resource),
    );

    const discoveredResources = await provider.discoverResources(
      providerResources,
      context,
    );

    const indexedStates = new Map<string, ProviderResourceState>();

    for (const state of discoveredResources) {
      indexedStates.set(state.name, state);
    }

    return indexedStates;
  }

  private toProviderResourceDefinition(
    resource: ResourceDefinition,
  ): ProviderResourceDefinition {
    return {
      provider: this.mapCompilerProviderName(resource.provider),
      type: this.mapCompilerResourceType(resource.type),
      name: resource.name,
      desired: resource.desired,
      dependsOn: [...resource.dependsOn],
    };
  }

  private toPlannedChange(input: {
    readonly resource: ResourceDefinition;
    readonly action: PlannedChange['action'];
    readonly reason: string;
  }): PlannedChange {
    return {
      resource: {
        type: input.resource.type,
        name: input.resource.name,
        provider: input.resource.provider,
      },
      action: input.action,
      riskLevel: this.inferRiskLevel(input.action),
      reason: input.reason,
      disruptive: input.action === 'replace' || input.action === 'delete',
      changes: [],
      dependencies: input.resource.dependsOn.map((dependencyId) => ({
        type: 'dependsOn',
        resource: {
          type: 'unknown',
          name: dependencyId,
          provider: 'internal',
        },
      })),
    };
  }

  private buildPlanSummary(
    plannedChanges: readonly PlannedChange[],
  ): PlanSummary {
    let createCount = 0;
    let updateCount = 0;
    let replaceCount = 0;
    let deleteCount = 0;
    let noopCount = 0;

    for (const change of plannedChanges) {
      switch (change.action) {
        case 'create':
          createCount += 1;
          break;
        case 'update':
          updateCount += 1;
          break;
        case 'replace':
          replaceCount += 1;
          break;
        case 'delete':
          deleteCount += 1;
          break;
        case 'noop':
          noopCount += 1;
          break;
      }
    }

    return {
      createCount,
      updateCount,
      replaceCount,
      deleteCount,
      noopCount,
      changeCount: plannedChanges.length,
    };
  }

  private inferRiskLevel(action: PlannedChange['action']): PlanRiskLevel {
    switch (action) {
      case 'create':
      case 'noop':
        return 'low';
      case 'update':
        return 'medium';
      case 'replace':
      case 'delete':
        return 'high';
    }
  }

  private mapCompilerProviderName(
    providerName: ResourceDefinition['provider'],
  ): ProviderName {
    switch (providerName) {
      case 'cloudflare':
      case 'docker':
      case 'host':
      case 'ovh':
      case 'vultr':
        return providerName;
      case 'discord':
      case 'internal':
        return 'host';
    }
  }

  private mapCompilerResourceType(
    resourceType: ResourceDefinition['type'],
  ): ProviderResourceDefinition['type'] {
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
}
