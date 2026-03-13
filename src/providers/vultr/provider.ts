import type {
  ApplyResult,
  PlanAction,
  Provider,
  ProviderApplyContext,
  ProviderPlanContext,
  ProviderResourceState,
  ResourceDefinition,
} from '../../types/providers.ts';

const MIN_PORT = 1;
const MAX_PORT = 65_535;

type VultrInstanceDesiredState = {
  readonly hostname: string;
  readonly region: string;
  readonly plan: string;
  readonly image: string;
  readonly enableIpv6: boolean;
  readonly backups: 'enabled' | 'disabled';
  readonly ddosProtection: 'enabled' | 'disabled';
  readonly tags: readonly string[];
};

type VultrFirewallPortRange = {
  readonly from: number;
  readonly to: number;
};

type VultrFirewallRule = {
  readonly protocol: 'tcp' | 'udp' | 'icmp';
  readonly portRange?: VultrFirewallPortRange;
  readonly sourceCidrs: readonly string[];
  readonly description: string;
};

type VultrFirewallDesiredState = {
  readonly groupName: string;
  readonly inboundRules: readonly VultrFirewallRule[];
};

type VultrActualState = {
  readonly externalId: string;
  readonly fingerprint: string;
  readonly attributes: Readonly<Record<string, unknown>>;
};

type SupportedDesiredState =
  | VultrInstanceDesiredState
  | VultrFirewallDesiredState;

export class VultrProvider
  implements Provider<SupportedDesiredState, VultrActualState> {
  public readonly name = 'vultr';

  public async validateResource(
    resource: ResourceDefinition<SupportedDesiredState>,
  ): Promise<void> {
    switch (resource.type) {
      case 'vultr_instance':
        this.validateInstanceResource(resource);
        return;
      case 'vultr_firewall':
        this.validateFirewallResource(resource);
        return;
      default:
        throw new Error(
          `Vultr provider does not support resource type "${resource.type}"`,
        );
    }
  }

  public async discoverResources(
    resources: readonly ResourceDefinition<SupportedDesiredState>[],
    context: ProviderPlanContext,
  ): Promise<readonly ProviderResourceState<VultrActualState>[]> {
    void resources;
    void context;

    return [];
  }

  public async planResource(
    resource: ResourceDefinition<SupportedDesiredState>,
    currentState: ProviderResourceState<VultrActualState> | null,
    context: ProviderPlanContext,
  ): Promise<PlanAction<SupportedDesiredState, VultrActualState>> {
    void context;

    if (currentState === null) {
      return {
        kind: 'create',
        resource,
        currentState: null,
        reason: 'Resource does not exist in discovered Vultr state.',
      };
    }

    return {
      kind: 'update',
      resource,
      currentState,
      reason: 'Provider-specific diffing is not implemented yet.',
    };
  }

  public async applyAction(
    action: PlanAction<SupportedDesiredState, VultrActualState>,
    context: ProviderApplyContext,
  ): Promise<ApplyResult> {
    void context;

    return {
      resource: {
        provider: action.resource.provider,
        type: action.resource.type,
        name: action.resource.name,
      },
      action: action.kind,
      resourceId: null,
      changed: action.kind !== 'noop',
      outputs: [],
    };
  }

  private validateInstanceResource(
    resource: ResourceDefinition<SupportedDesiredState>,
  ): void {
    const desired = resource.desired;

    if (resource.type !== 'vultr_instance') {
      throw new Error(
        `Expected vultr_instance resource, received "${resource.type}"`,
      );
    }

    if (!this.isVultrInstanceDesiredState(desired)) {
      throw new Error(
        `Invalid desired state for Vultr instance resource "${resource.name}"`,
      );
    }

    this.ensureNonEmptyValue(desired.hostname, 'Vultr instance hostname');
    this.ensureNonEmptyValue(desired.region, 'Vultr instance region');
    this.ensureNonEmptyValue(desired.plan, 'Vultr instance plan');
    this.ensureNonEmptyValue(desired.image, 'Vultr instance image');
  }

  private validateFirewallResource(
    resource: ResourceDefinition<SupportedDesiredState>,
  ): void {
    const desired = resource.desired;

    if (resource.type !== 'vultr_firewall') {
      throw new Error(
        `Expected vultr_firewall resource, received "${resource.type}"`,
      );
    }

    if (!this.isVultrFirewallDesiredState(desired)) {
      throw new Error(
        `Invalid desired state for Vultr firewall resource "${resource.name}"`,
      );
    }

    this.ensureNonEmptyValue(
      desired.groupName,
      'Vultr firewall group name',
    );

    for (const inboundRule of desired.inboundRules) {
      this.validateFirewallRule(resource.name, inboundRule);
    }
  }

  private validateFirewallRule(
    resourceName: string,
    inboundRule: VultrFirewallRule,
  ): void {
    if (inboundRule.sourceCidrs.length === 0) {
      throw new Error(
        `Vultr firewall rule in "${resourceName}" must include at least one source CIDR.`,
      );
    }

    this.ensureNonEmptyValue(
      inboundRule.description,
      `Vultr firewall rule description in "${resourceName}"`,
    );

    if (inboundRule.portRange === undefined) {
      return;
    }

    this.validatePortRange(resourceName, inboundRule.portRange);
  }

  private validatePortRange(
    resourceName: string,
    portRange: VultrFirewallPortRange,
  ): void {
    this.ensureValidPort(
      resourceName,
      portRange.from,
      'starting port',
    );
    this.ensureValidPort(resourceName, portRange.to, 'ending port');

    if (portRange.to < portRange.from) {
      throw new Error(
        `Vultr firewall rule in "${resourceName}" has an invalid port range.`,
      );
    }
  }

  private ensureValidPort(
    resourceName: string,
    port: number,
    label: string,
  ): void {
    if (port < MIN_PORT || port > MAX_PORT) {
      throw new Error(
        `Vultr firewall rule in "${resourceName}" has an invalid ${label}.`,
      );
    }
  }

  private ensureNonEmptyValue(value: string, label: string): void {
    if (value.trim().length === 0) {
      throw new Error(`${label} must not be empty.`);
    }
  }

  private isVultrInstanceDesiredState(
    value: SupportedDesiredState,
  ): value is VultrInstanceDesiredState {
    return (
      'hostname' in value &&
      'region' in value &&
      'plan' in value &&
      'image' in value
    );
  }

  private isVultrFirewallDesiredState(
    value: SupportedDesiredState,
  ): value is VultrFirewallDesiredState {
    return 'groupName' in value && 'inboundRules' in value;
  }
}

export function createVultrProvider(): VultrProvider {
  return new VultrProvider();
}
