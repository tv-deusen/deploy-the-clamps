import type {
  ApplyResult,
  PlanAction,
  Provider,
  ProviderApplyContext,
  ProviderPlanContext,
  ProviderResourceState,
  ResourceDefinition,
} from '../../types/providers.ts';

type CloudflareDnsRecordDesiredState = {
  readonly zoneId: string;
  readonly recordName: string;
  readonly recordType: 'A' | 'AAAA' | 'CNAME' | 'TXT';
  readonly value: string;
  readonly ttl: number;
  readonly proxied?: boolean;
};

type CloudflareDnsRecordActualState = {
  readonly zoneId: string;
  readonly recordId: string;
  readonly recordName: string;
  readonly recordType: 'A' | 'AAAA' | 'CNAME' | 'TXT';
  readonly value: string;
  readonly ttl: number;
  readonly proxied: boolean;
};

type CloudflareProviderResource =
  ResourceDefinition<CloudflareDnsRecordDesiredState>;

type CloudflareProviderState =
  ProviderResourceState<CloudflareDnsRecordActualState>;

export class CloudflareProvider
  implements Provider<CloudflareDnsRecordDesiredState, CloudflareDnsRecordActualState> {
  public readonly name = 'cloudflare';

  public async validateResource(
    resource: CloudflareProviderResource,
  ): Promise<void> {
    this.ensureSupportedResourceType(resource);
    this.validateDesiredState(resource.desired);
  }

  public async discoverResources(
    resources: readonly CloudflareProviderResource[],
    _context: ProviderPlanContext,
  ): Promise<readonly CloudflareProviderState[]> {
    for (const resource of resources) {
      this.ensureSupportedResourceType(resource);
    }

    return [];
  }

  public async planResource(
    resource: CloudflareProviderResource,
    currentState: CloudflareProviderState | null,
    _context: ProviderPlanContext,
  ): Promise<
    PlanAction<CloudflareDnsRecordDesiredState, CloudflareDnsRecordActualState>
  > {
    this.ensureSupportedResourceType(resource);
    this.validateDesiredState(resource.desired);

    if (currentState === null) {
      return {
        kind: 'create',
        resource,
        currentState: null,
        reason: 'DNS record does not exist in discovered Cloudflare state.',
      };
    }

    if (this.hasMeaningfulDifference(resource.desired, currentState.actual)) {
      return {
        kind: 'update',
        resource,
        currentState,
        reason: 'Discovered DNS record differs from desired configuration.',
      };
    }

    return {
      kind: 'noop',
      resource,
      currentState,
      reason: 'Discovered DNS record already matches desired configuration.',
    };
  }

  public async applyAction(
    action: PlanAction<CloudflareDnsRecordDesiredState, CloudflareDnsRecordActualState>,
    context: ProviderApplyContext,
  ): Promise<ApplyResult> {
    this.ensureSupportedResourceType(action.resource);

    if (context.isDryRun) {
      return {
        resource: action.resource,
        action: action.kind,
        resourceId: action.currentState?.id ?? null,
        changed: action.kind !== 'noop',
        outputs: [
          {
            name: 'mode',
            value: 'dry-run',
            sensitive: false,
          },
        ],
      };
    }

    throw new Error(
      `Cloudflare apply is not implemented yet for resource "${action.resource.name}".`,
    );
  }

  private ensureSupportedResourceType(resource: {
    readonly type: string;
    readonly name: string;
  }): void {
    if (resource.type !== 'cloudflare_dns_record') {
      throw new Error(
        `Cloudflare provider does not support resource type "${resource.type}" for "${resource.name}".`,
      );
    }
  }

  private validateDesiredState(
    desiredState: CloudflareDnsRecordDesiredState,
  ): void {
    if (desiredState.zoneId.trim().length === 0) {
      throw new Error('Cloudflare DNS record zoneId must not be empty.');
    }

    if (desiredState.recordName.trim().length === 0) {
      throw new Error('Cloudflare DNS record recordName must not be empty.');
    }

    if (desiredState.value.trim().length === 0) {
      throw new Error('Cloudflare DNS record value must not be empty.');
    }

    if (desiredState.ttl < 1) {
      throw new Error('Cloudflare DNS record ttl must be greater than 0.');
    }
  }

  private hasMeaningfulDifference(
    desiredState: CloudflareDnsRecordDesiredState,
    actualState: CloudflareDnsRecordActualState,
  ): boolean {
    const desiredProxied = desiredState.proxied ?? false;

    return (
      desiredState.zoneId !== actualState.zoneId ||
      desiredState.recordName !== actualState.recordName ||
      desiredState.recordType !== actualState.recordType ||
      desiredState.value !== actualState.value ||
      desiredState.ttl !== actualState.ttl ||
      desiredProxied !== actualState.proxied
    );
  }
}

export function createCloudflareProvider(): CloudflareProvider {
  return new CloudflareProvider();
}
