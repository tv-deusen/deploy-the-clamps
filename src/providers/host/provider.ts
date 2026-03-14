import type {
	ApplyResult,
	PlanAction,
	Provider,
	ProviderApplyContext,
	ProviderPlanContext,
	ProviderResourceState,
	ResourceDefinition,
} from '../../types/providers.ts';

type HostResourceType = 'file' | 'health_check' | 'systemd_service';

type HostResourceDefinition = ResourceDefinition<HostDesiredState> & {
	readonly provider: 'host';
	readonly type: HostResourceType;
};

type HostProviderState =
	| HostFileState
	| HostHealthCheckState
	| HostSystemdServiceState;

type HostDesiredState =
	| HostFileDesiredState
	| HostHealthCheckDesiredState
	| HostSystemdServiceDesiredState;

interface HostFileDesiredState {
	readonly kind: 'file';
	readonly path: string;
	readonly content: string;
	readonly owner?: string;
	readonly group?: string;
	readonly mode?: string;
}

interface HostHealthCheckDesiredState {
	readonly kind: 'health_check';
	readonly name: string;
	readonly checkType: 'http' | 'systemd' | 'tcp';
	readonly target: string;
	readonly timeoutMilliseconds: number;
}

interface HostSystemdServiceDesiredState {
	readonly kind: 'systemd_service';
	readonly unitName: string;
	readonly enabled: boolean;
	readonly wantedState: 'active' | 'inactive';
	readonly unitFileContent?: string;
}

interface HostFileState {
	readonly kind: 'file';
	readonly path: string;
	readonly contentHash?: string;
	readonly owner?: string;
	readonly group?: string;
	readonly mode?: string;
}

interface HostHealthCheckState {
	readonly kind: 'health_check';
	readonly name: string;
	readonly healthy: boolean;
	readonly lastObservedAt?: string;
}

interface HostSystemdServiceState {
	readonly kind: 'systemd_service';
	readonly unitName: string;
	readonly enabled: boolean;
	readonly activeState: 'active' | 'inactive' | 'failed' | 'unknown';
	readonly unitFileHash?: string;
}

export class HostProvider
	implements Provider<HostDesiredState, HostProviderState>
{
	public readonly name = 'host';

	public async validateResource(
		resource: ResourceDefinition<HostDesiredState>,
	): Promise<void> {
		assertHostResource(resource);

		switch (resource.desired.kind) {
			case 'file':
				this.validateFileResource(resource);
				return;
			case 'health_check':
				this.validateHealthCheckResource(resource);
				return;
			case 'systemd_service':
				this.validateSystemdServiceResource(resource);
				return;
			default:
				return assertNever(resource.desired);
		}
	}

	public async discoverResources(
		resources: readonly ResourceDefinition<HostDesiredState>[],
		_context: ProviderPlanContext,
	): Promise<readonly ProviderResourceState<HostProviderState>[]> {
		return resources.map((resource) =>
			this.createDiscoveredResource(resource),
		);
	}

	public async planResource(
		resource: ResourceDefinition<HostDesiredState>,
		currentState: ProviderResourceState<HostProviderState> | null,
		_context: ProviderPlanContext,
	): Promise<PlanAction<HostDesiredState, HostProviderState>> {
		assertHostResource(resource);

		if (currentState === null) {
			return {
				kind: 'create',
				resource,
				currentState: null,
				reason: 'Host resource does not exist in discovered state.',
			};
		}

		const actionKind = this.getActionKind(resource, currentState.actual);

		return {
			kind: actionKind,
			resource,
			currentState,
			reason:
				actionKind === 'noop'
					? 'Host resource already matches the desired state.'
					: 'Host resource differs from the desired state.',
		};
	}

	public async applyAction(
		action: PlanAction<HostDesiredState, HostProviderState>,
		context: ProviderApplyContext,
	): Promise<ApplyResult> {
		assertHostResource(action.resource);

		if (action.kind === 'noop') {
			return {
				resource: action.resource,
				action: action.kind,
				resourceId: action.currentState?.id ?? action.resource.name,
				changed: false,
				outputs: [],
			};
		}

		if (context.isDryRun) {
			return {
				resource: action.resource,
				action: action.kind,
				resourceId: action.currentState?.id ?? null,
				changed: true,
				outputs: [],
			};
		}

		return {
			resource: action.resource,
			action: action.kind,
			resourceId: action.currentState?.id ?? action.resource.name,
			changed: true,
			outputs: [],
		};
	}

	private createDiscoveredResource(
		resource: ResourceDefinition<HostDesiredState>,
	): ProviderResourceState<HostProviderState> {
		assertHostResource(resource);

		switch (resource.desired.kind) {
			case 'file':
				return {
					provider: 'host',
					type: 'file',
					name: resource.name,
					id: resource.name,
					actual: {
						kind: 'file',
						path: resource.desired.path,
					},
				};
			case 'health_check':
				return {
					provider: 'host',
					type: 'health_check',
					name: resource.name,
					id: resource.name,
					actual: {
						kind: 'health_check',
						name: resource.desired.name,
						healthy: false,
					},
				};
			case 'systemd_service':
				return {
					provider: 'host',
					type: 'systemd_service',
					name: resource.name,
					id: resource.name,
					actual: {
						kind: 'systemd_service',
						unitName: resource.desired.unitName,
						enabled: false,
						activeState: 'unknown',
					},
				};
			default:
				return assertNever(resource.desired);
		}
	}

	private validateFileResource(resource: HostResourceDefinition): void {
		if (resource.desired.kind !== 'file') {
			throw new Error(
				`Expected file desired state for resource "${resource.name}".`,
			);
		}

		if (resource.desired.path.length === 0) {
			throw new Error(
				`File resource "${resource.name}" must define a path.`,
			);
		}
	}

	private validateHealthCheckResource(
		resource: HostResourceDefinition,
	): void {
		if (resource.desired.kind !== 'health_check') {
			throw new Error(
				`Expected health check desired state for resource "${resource.name}".`,
			);
		}

		if (resource.desired.target.length === 0) {
			throw new Error(
				`Health check resource "${resource.name}" must define a target.`,
			);
		}

		if (resource.desired.timeoutMilliseconds <= 0) {
			throw new Error(
				`Health check resource "${resource.name}" must define a positive timeout.`,
			);
		}
	}

	private validateSystemdServiceResource(
		resource: HostResourceDefinition,
	): void {
		if (resource.desired.kind !== 'systemd_service') {
			throw new Error(
				`Expected systemd desired state for resource "${resource.name}".`,
			);
		}

		if (resource.desired.unitName.length === 0) {
			throw new Error(
				`Systemd resource "${resource.name}" must define a unit name.`,
			);
		}
	}

	private getActionKind(
		resource: HostResourceDefinition,
		currentState: HostProviderState,
	): PlanAction['kind'] {
		switch (resource.desired.kind) {
			case 'file':
				return this.getFileActionKind(resource.desired, currentState);
			case 'health_check':
				return this.getHealthCheckActionKind(
					resource.desired,
					currentState,
				);
			case 'systemd_service':
				return this.getSystemdActionKind(
					resource.desired,
					currentState,
				);
			default:
				return assertNever(resource.desired);
		}
	}

	private getFileActionKind(
		desiredState: HostFileDesiredState,
		currentState: HostProviderState,
	): PlanAction['kind'] {
		if (currentState.kind !== 'file') {
			return 'replace';
		}

		if (currentState.path !== desiredState.path) {
			return 'replace';
		}

		return 'update';
	}

	private getHealthCheckActionKind(
		desiredState: HostHealthCheckDesiredState,
		currentState: HostProviderState,
	): PlanAction['kind'] {
		if (currentState.kind !== 'health_check') {
			return 'replace';
		}

		if (currentState.name !== desiredState.name) {
			return 'replace';
		}

		return 'noop';
	}

	private getSystemdActionKind(
		desiredState: HostSystemdServiceDesiredState,
		currentState: HostProviderState,
	): PlanAction['kind'] {
		if (currentState.kind !== 'systemd_service') {
			return 'replace';
		}

		if (currentState.unitName !== desiredState.unitName) {
			return 'replace';
		}

		if (currentState.enabled !== desiredState.enabled) {
			return 'update';
		}

		if (
			desiredState.wantedState === 'active' &&
			currentState.activeState !== 'active'
		) {
			return 'update';
		}

		if (
			desiredState.wantedState === 'inactive' &&
			currentState.activeState === 'active'
		) {
			return 'update';
		}

		return 'noop';
	}
}

function assertHostResource(
	resource: ResourceDefinition<HostDesiredState>,
): asserts resource is HostResourceDefinition {
	if (resource.provider !== 'host') {
		throw new Error(
			`HostProvider received unsupported provider "${resource.provider}".`,
		);
	}

	if (
		resource.type !== 'file' &&
		resource.type !== 'health_check' &&
		resource.type !== 'systemd_service'
	) {
		throw new Error(
			`HostProvider received unsupported resource type "${resource.type}".`,
		);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unhandled host provider state: ${JSON.stringify(value)}`);
}

export function createHostProvider(): HostProvider {
	return new HostProvider();
}
