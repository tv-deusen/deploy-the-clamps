export type ProviderName = 'cloudflare' | 'docker' | 'host' | 'ovh' | 'vultr';

export type ResourceType =
  | 'cloudflare_dns_record'
  | 'cloudflare_tunnel'
  | 'cloudflare_access_application'
  | 'cloudflare_access_policy'
  | 'docker_compose_stack'
  | 'docker_network'
  | 'docker_volume'
  | 'file'
  | 'health_check'
  | 'systemd_service'
  | 'vultr_firewall'
  | 'vultr_instance';

export type PlanActionKind = 'create' | 'update' | 'replace' | 'delete' | 'noop';

export interface ResourceReference {
  readonly provider: ProviderName;
  readonly type: ResourceType;
  readonly name: string;
}

export interface ResourceDefinition<TDesired = unknown> extends ResourceReference {
  readonly dependsOn: readonly string[];
  readonly desired: TDesired;
}

export interface ProviderResourceState<TActual = unknown> extends ResourceReference {
  readonly id: string;
  readonly actual: TActual;
  readonly fingerprint?: string;
}

export interface ProviderOutput {
  readonly name: string;
  readonly value: string | number | boolean | null;
  readonly sensitive: boolean;
}

export interface PlanAction<TDesired = unknown, TActual = unknown> {
  readonly kind: PlanActionKind;
  readonly resource: ResourceDefinition<TDesired>;
  readonly currentState: ProviderResourceState<TActual> | null;
  readonly reason: string;
  readonly replacesResourceId?: string;
}

export interface ApplyResult {
  readonly resource: ResourceReference;
  readonly action: PlanActionKind;
  readonly resourceId: string | null;
  readonly changed: boolean;
  readonly outputs: readonly ProviderOutput[];
}

export interface ProviderPlanContext {
  readonly deploymentName: string;
  readonly environmentName: string;
}

export interface ProviderApplyContext extends ProviderPlanContext {
  readonly isDryRun: boolean;
}

export interface Provider<TDesired = unknown, TActual = unknown> {
  readonly name: ProviderName;

  validateResource(resource: ResourceDefinition<TDesired>): Promise<void>;

  discoverResources(
    resources: readonly ResourceDefinition<TDesired>[],
    context: ProviderPlanContext,
  ): Promise<readonly ProviderResourceState<TActual>[]>;

  planResource(
    resource: ResourceDefinition<TDesired>,
    currentState: ProviderResourceState<TActual> | null,
    context: ProviderPlanContext,
  ): Promise<PlanAction<TDesired, TActual>>;

  applyAction(
    action: PlanAction<TDesired, TActual>,
    context: ProviderApplyContext,
  ): Promise<ApplyResult>;
}
