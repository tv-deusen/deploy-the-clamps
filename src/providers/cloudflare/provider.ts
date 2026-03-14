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

type CloudflareDnsRecordActualState = CloudflareDnsRecordDesiredState & {
	readonly recordId: string;
	readonly proxied: boolean;
};

type CloudflareTunnelDesiredState = {
	readonly accountId: string;
	readonly tunnelName: string;
	readonly hostname: string;
	readonly serviceUrl: string;
};

type CloudflareTunnelActualState = CloudflareTunnelDesiredState & {
	readonly tunnelId: string;
};

type CloudflareAccessApplicationDesiredState = {
	readonly accountId: string;
	readonly applicationName: string;
	readonly domain: string;
	readonly sessionDuration: string;
};

type CloudflareAccessApplicationActualState =
	CloudflareAccessApplicationDesiredState & {
		readonly applicationId: string;
	};

type CloudflareAccessPolicyDesiredState = {
	readonly accountId: string;
	readonly applicationName: string;
	readonly policyName: string;
	readonly allowedEmails: readonly string[];
	readonly precedence: number;
};

type CloudflareAccessPolicyActualState = CloudflareAccessPolicyDesiredState & {
	readonly policyId: string;
};

type SupportedDesiredState =
	| CloudflareDnsRecordDesiredState
	| CloudflareTunnelDesiredState
	| CloudflareAccessApplicationDesiredState
	| CloudflareAccessPolicyDesiredState;

type SupportedActualState =
	| CloudflareDnsRecordActualState
	| CloudflareTunnelActualState
	| CloudflareAccessApplicationActualState
	| CloudflareAccessPolicyActualState;

type CloudflareProviderResource = ResourceDefinition<SupportedDesiredState>;

type CloudflareProviderState = ProviderResourceState<SupportedActualState>;

export class CloudflareProvider
	implements Provider<SupportedDesiredState, SupportedActualState>
{
	public readonly name = 'cloudflare';

	public async validateResource(
		resource: CloudflareProviderResource,
	): Promise<void> {
		switch (resource.type) {
			case 'cloudflare_dns_record':
				this.validateDnsRecordDesiredState(resource.desired);
				return;
			case 'cloudflare_tunnel':
				this.validateTunnelDesiredState(resource.desired);
				return;
			case 'cloudflare_access_application':
				this.validateAccessApplicationDesiredState(resource.desired);
				return;
			case 'cloudflare_access_policy':
				this.validateAccessPolicyDesiredState(resource.desired);
				return;
			default:
				throw new Error(
					`Cloudflare provider does not support resource type "${resource.type}" for "${resource.name}".`,
				);
		}
	}

	public async discoverResources(
		resources: readonly CloudflareProviderResource[],
		_context: ProviderPlanContext,
	): Promise<readonly CloudflareProviderState[]> {
		for (const resource of resources) {
			await this.validateResource(resource);
		}

		return [];
	}

	public async planResource(
		resource: CloudflareProviderResource,
		currentState: CloudflareProviderState | null,
		_context: ProviderPlanContext,
	): Promise<PlanAction<SupportedDesiredState, SupportedActualState>> {
		await this.validateResource(resource);

		if (currentState === null) {
			return {
				kind: 'create',
				resource,
				currentState: null,
				reason: 'Resource does not exist in discovered Cloudflare state.',
			};
		}

		if (this.hasMeaningfulDifference(resource, currentState)) {
			return {
				kind: 'update',
				resource,
				currentState,
				reason: 'Discovered Cloudflare resource differs from desired configuration.',
			};
		}

		return {
			kind: 'noop',
			resource,
			currentState,
			reason: 'Discovered Cloudflare resource already matches desired configuration.',
		};
	}

	public async applyAction(
		action: PlanAction<SupportedDesiredState, SupportedActualState>,
		context: ProviderApplyContext,
	): Promise<ApplyResult> {
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

	private validateDnsRecordDesiredState(
		desiredState: SupportedDesiredState,
	): asserts desiredState is CloudflareDnsRecordDesiredState {
		if (!('zoneId' in desiredState)) {
			throw new Error('Cloudflare DNS record desired state is invalid.');
		}

		this.ensureNonEmptyValue(
			desiredState.zoneId,
			'Cloudflare DNS record zoneId',
		);
		this.ensureNonEmptyValue(
			desiredState.recordName,
			'Cloudflare DNS record recordName',
		);
		this.ensureNonEmptyValue(
			desiredState.value,
			'Cloudflare DNS record value',
		);

		if (desiredState.ttl < 1) {
			throw new Error(
				'Cloudflare DNS record ttl must be greater than 0.',
			);
		}
	}

	private validateTunnelDesiredState(
		desiredState: SupportedDesiredState,
	): asserts desiredState is CloudflareTunnelDesiredState {
		if (!('tunnelName' in desiredState)) {
			throw new Error('Cloudflare tunnel desired state is invalid.');
		}

		this.ensureNonEmptyValue(
			desiredState.accountId,
			'Cloudflare tunnel accountId',
		);
		this.ensureNonEmptyValue(
			desiredState.tunnelName,
			'Cloudflare tunnel tunnelName',
		);
		this.ensureNonEmptyValue(
			desiredState.hostname,
			'Cloudflare tunnel hostname',
		);
		this.ensureNonEmptyValue(
			desiredState.serviceUrl,
			'Cloudflare tunnel serviceUrl',
		);
	}

	private validateAccessApplicationDesiredState(
		desiredState: SupportedDesiredState,
	): asserts desiredState is CloudflareAccessApplicationDesiredState {
		if (
			!('applicationName' in desiredState) ||
			!('domain' in desiredState)
		) {
			throw new Error(
				'Cloudflare Access application desired state is invalid.',
			);
		}

		this.ensureNonEmptyValue(
			desiredState.accountId,
			'Cloudflare Access application accountId',
		);
		this.ensureNonEmptyValue(
			desiredState.applicationName,
			'Cloudflare Access application name',
		);
		this.ensureNonEmptyValue(
			desiredState.domain,
			'Cloudflare Access application domain',
		);
		this.ensureNonEmptyValue(
			desiredState.sessionDuration,
			'Cloudflare Access application sessionDuration',
		);
	}

	private validateAccessPolicyDesiredState(
		desiredState: SupportedDesiredState,
	): asserts desiredState is CloudflareAccessPolicyDesiredState {
		if (
			!('policyName' in desiredState) ||
			!('allowedEmails' in desiredState)
		) {
			throw new Error(
				'Cloudflare Access policy desired state is invalid.',
			);
		}

		this.ensureNonEmptyValue(
			desiredState.accountId,
			'Cloudflare Access policy accountId',
		);
		this.ensureNonEmptyValue(
			desiredState.applicationName,
			'Cloudflare Access policy applicationName',
		);
		this.ensureNonEmptyValue(
			desiredState.policyName,
			'Cloudflare Access policy policyName',
		);

		if (desiredState.allowedEmails.length === 0) {
			throw new Error(
				'Cloudflare Access policy must include at least one allowed email.',
			);
		}
	}

	private hasMeaningfulDifference(
		resource: CloudflareProviderResource,
		currentState: CloudflareProviderState,
	): boolean {
		switch (resource.type) {
			case 'cloudflare_dns_record':
				return this.hasDnsRecordDifference(
					resource.desired as CloudflareDnsRecordDesiredState,
					currentState.actual,
				);
			case 'cloudflare_tunnel':
				return this.hasTunnelDifference(
					resource.desired as CloudflareTunnelDesiredState,
					currentState.actual,
				);
			case 'cloudflare_access_application':
				return this.hasAccessApplicationDifference(
					resource.desired as CloudflareAccessApplicationDesiredState,
					currentState.actual,
				);
			case 'cloudflare_access_policy':
				return this.hasAccessPolicyDifference(
					resource.desired as CloudflareAccessPolicyDesiredState,
					currentState.actual,
				);
			default:
				return true;
		}
	}

	private hasDnsRecordDifference(
		desiredState: CloudflareDnsRecordDesiredState,
		actualState: SupportedActualState,
	): boolean {
		if (!('recordName' in actualState)) {
			return true;
		}

		return (
			desiredState.zoneId !== actualState.zoneId ||
			desiredState.recordName !== actualState.recordName ||
			desiredState.recordType !== actualState.recordType ||
			desiredState.value !== actualState.value ||
			desiredState.ttl !== actualState.ttl ||
			(desiredState.proxied ?? false) !== actualState.proxied
		);
	}

	private hasTunnelDifference(
		desiredState: CloudflareTunnelDesiredState,
		actualState: SupportedActualState,
	): boolean {
		if (!('tunnelName' in actualState)) {
			return true;
		}

		return (
			desiredState.accountId !== actualState.accountId ||
			desiredState.tunnelName !== actualState.tunnelName ||
			desiredState.hostname !== actualState.hostname ||
			desiredState.serviceUrl !== actualState.serviceUrl
		);
	}

	private hasAccessApplicationDifference(
		desiredState: CloudflareAccessApplicationDesiredState,
		actualState: SupportedActualState,
	): boolean {
		if (!('applicationName' in actualState) || !('domain' in actualState)) {
			return true;
		}

		return (
			desiredState.accountId !== actualState.accountId ||
			desiredState.applicationName !== actualState.applicationName ||
			desiredState.domain !== actualState.domain ||
			desiredState.sessionDuration !== actualState.sessionDuration
		);
	}

	private hasAccessPolicyDifference(
		desiredState: CloudflareAccessPolicyDesiredState,
		actualState: SupportedActualState,
	): boolean {
		if (
			!('policyName' in actualState) ||
			!('allowedEmails' in actualState)
		) {
			return true;
		}

		return (
			desiredState.accountId !== actualState.accountId ||
			desiredState.applicationName !== actualState.applicationName ||
			desiredState.policyName !== actualState.policyName ||
			desiredState.precedence !== actualState.precedence ||
			desiredState.allowedEmails.join(',') !==
				actualState.allowedEmails.join(',')
		);
	}

	private ensureNonEmptyValue(value: string, label: string): void {
		if (value.trim().length === 0) {
			throw new Error(`${label} must not be empty.`);
		}
	}
}

export function createCloudflareProvider(): CloudflareProvider {
	return new CloudflareProvider();
}
