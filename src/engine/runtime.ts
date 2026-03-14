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
import type { DeploymentPlan, PlannedChange } from '../types/planner.ts';
import type {
	ApplyResult,
	Provider,
	ProviderName,
	ProviderPlanContext,
	ProviderResourceState,
	ResourceDefinition as ProviderResourceDefinition,
	ResourceType,
} from '../types/providers.ts';

export interface EngineSnapshot {
	readonly loadedConfig: LoadedConfig;
	readonly compileResult: CompileResult;
}

export interface ApplyExecutionStep {
	readonly change: PlannedChange;
	readonly result: ApplyResult;
}

export interface ApplyFailureReport {
	readonly failedChange: PlannedChange;
	readonly message: string;
	readonly appliedSteps: readonly ApplyExecutionStep[];
	readonly pendingChanges: readonly PlannedChange[];
	readonly rollbackCandidates: readonly PlannedChange[];
}

export interface ApplyExecutionResult {
	readonly success: boolean;
	readonly snapshot: EngineSnapshot;
	readonly plan: DeploymentPlan;
	readonly orderedChanges: readonly PlannedChange[];
	readonly steps: readonly ApplyExecutionStep[];
	readonly failure: ApplyFailureReport | null;
}

export interface DeploymentEngineDependencies {
	readonly loader?: DefaultConfigLoader;
	readonly compiler?: Compiler;
	readonly planner?: DeploymentPlanner;
	readonly providers?: ReadonlyMap<ProviderName, Provider>;
	readonly secretResolver?: EnvironmentSecretResolver;
}

export class DeploymentEngine {
	private readonly loader: DefaultConfigLoader;
	private readonly compiler: Compiler;
	private readonly planner: DeploymentPlanner;
	private readonly providers: ReadonlyMap<ProviderName, Provider>;

	public constructor(dependencies: DeploymentEngineDependencies = {}) {
		const secretResolver =
			dependencies.secretResolver ?? new EnvironmentSecretResolver();
		const providers =
			dependencies.providers ??
			new Map<ProviderName, Provider>([
				['cloudflare', createCloudflareProvider()],
				['host', createHostProvider()],
				['vultr', createVultrProvider()],
			]);

		this.loader =
			dependencies.loader ??
			new DefaultConfigLoader({
				pathResolver: new RecursiveConfigPathResolver(),
				fileReader: new FileSystemConfigFileReader(),
				documentParser: new ZodConfigDocumentParser(),
			});
		this.compiler =
			dependencies.compiler ??
			new Compiler({
				resolveSecret: (reference) =>
					resolveSecretReference(secretResolver, reference),
			});
		this.planner =
			dependencies.planner ??
			new DeploymentPlanner({
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
			throw new Error(
				`No YAML config documents were found in "${deploymentRootPath}".`,
			);
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

	public async apply(
		deploymentRootPath: string,
	): Promise<ApplyExecutionResult> {
		const { snapshot, plan } = await this.plan(deploymentRootPath);
		const resourceIndex = this.indexResourcesById(
			snapshot.compileResult.graph.resources,
		);
		const orderedChanges = orderPlanChangesByDependencies(
			plan.changes,
			snapshot.compileResult.graph.resources,
		);
		const context: ProviderPlanContext = {
			deploymentName: snapshot.compileResult.deployment.name,
			environmentName: snapshot.compileResult.deployment.environment,
		};
		const discoveredStateIndex = await this.discoverCurrentStateByChange(
			orderedChanges,
			resourceIndex,
			context,
		);
		const steps: ApplyExecutionStep[] = [];

		for (const [changeIndex, change] of orderedChanges.entries()) {
			const resource = resourceIndex.get(change.resource.id);

			if (!resource) {
				throw new Error(
					`Cannot apply resource "${change.resource.id}" because it is missing from the compiled graph.`,
				);
			}

			const providerName = mapProviderName(resource.provider);
			const provider = this.providers.get(providerName);

			if (!provider) {
				throw new Error(
					`No provider is registered for resource "${resource.name}" (${resource.provider}).`,
				);
			}

			const providerResource = toProviderResourceDefinition(resource);
			const stateKey = buildStateKey(providerResource);
			const currentState = discoveredStateIndex.get(stateKey) ?? null;

			try {
				const result = await provider.applyAction(
					{
						kind: change.action,
						resource: providerResource,
						currentState,
						reason: change.reason,
					},
					{
						...context,
						isDryRun: false,
					},
				);

				steps.push({
					change,
					result,
				});
			} catch (error: unknown) {
				return {
					success: false,
					snapshot,
					plan,
					orderedChanges,
					steps,
					failure: createApplyFailureReport({
						orderedChanges,
						failedChange: change,
						changeIndex,
						steps,
						error,
					}),
				};
			}
		}

		return {
			success: true,
			snapshot,
			plan,
			orderedChanges,
			steps,
			failure: null,
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

			await provider.validateResource(toProviderResourceDefinition(resource));
		}
	}

	private indexResourcesById(
		resources: readonly ResourceDefinition[],
	): ReadonlyMap<string, ResourceDefinition> {
		const index = new Map<string, ResourceDefinition>();

		for (const resource of resources) {
			index.set(resource.id, resource);
		}

		return index;
	}

	private async discoverCurrentStateByChange(
		changes: readonly PlannedChange[],
		resourceIndex: ReadonlyMap<string, ResourceDefinition>,
		context: ProviderPlanContext,
	): Promise<ReadonlyMap<string, ProviderResourceState>> {
		const resourcesByProvider = new Map<
			ProviderName,
			ProviderResourceDefinition[]
		>();

		for (const change of changes) {
			const resource = resourceIndex.get(change.resource.id);

			if (!resource) {
				continue;
			}

			const providerName = mapProviderName(resource.provider);
			const providerResources = resourcesByProvider.get(providerName) ?? [];

			providerResources.push(toProviderResourceDefinition(resource));
			resourcesByProvider.set(providerName, providerResources);
		}

		const discoveredStateByResource = new Map<string, ProviderResourceState>();

		for (const [providerName, providerResources] of resourcesByProvider) {
			const provider = this.providers.get(providerName);

			if (!provider) {
				continue;
			}

			const discoveredResources = await provider.discoverResources(
				providerResources,
				context,
			);

			for (const state of discoveredResources) {
				discoveredStateByResource.set(buildStateKey(state), state);
			}
		}

		return discoveredStateByResource;
	}
}

export function orderPlanChangesByDependencies(
	changes: readonly PlannedChange[],
	resources: readonly ResourceDefinition[],
): readonly PlannedChange[] {
	const resourceIndex = new Map<string, ResourceDefinition>();
	const changeIndexByResourceId = new Map<string, number>();
	const changeByResourceId = new Map<string, PlannedChange>();
	const indegreeByResourceId = new Map<string, number>();
	const dependentsByResourceId = new Map<string, string[]>();

	for (const resource of resources) {
		resourceIndex.set(resource.id, resource);
	}

	for (const [index, change] of changes.entries()) {
		changeIndexByResourceId.set(change.resource.id, index);
		changeByResourceId.set(change.resource.id, change);
		indegreeByResourceId.set(change.resource.id, 0);
	}

	for (const change of changes) {
		const resource = resourceIndex.get(change.resource.id);

		if (!resource) {
			throw new Error(
				`Cannot order plan changes because resource "${change.resource.id}" is missing from the compiled graph.`,
			);
		}

		for (const dependencyId of resource.dependsOn) {
			if (!changeByResourceId.has(dependencyId)) {
				continue;
			}

			indegreeByResourceId.set(
				change.resource.id,
				(indegreeByResourceId.get(change.resource.id) ?? 0) + 1,
			);

			const dependents = dependentsByResourceId.get(dependencyId) ?? [];

			dependents.push(change.resource.id);
			dependentsByResourceId.set(dependencyId, dependents);
		}
	}

	const readyQueue: string[] = [];

	for (const change of changes) {
		if ((indegreeByResourceId.get(change.resource.id) ?? 0) === 0) {
			readyQueue.push(change.resource.id);
		}
	}

	readyQueue.sort((left, right) => {
		const leftIndex = changeIndexByResourceId.get(left) ?? Number.MAX_SAFE_INTEGER;
		const rightIndex =
			changeIndexByResourceId.get(right) ?? Number.MAX_SAFE_INTEGER;

		return leftIndex - rightIndex;
	});

	const orderedChanges: PlannedChange[] = [];

	while (readyQueue.length > 0) {
		const resourceId = readyQueue.shift();

		if (!resourceId) {
			continue;
		}

		const change = changeByResourceId.get(resourceId);

		if (!change) {
			continue;
		}

		orderedChanges.push(change);

		const dependents = dependentsByResourceId.get(resourceId) ?? [];

		for (const dependentResourceId of dependents) {
			const nextIndegree =
				(indegreeByResourceId.get(dependentResourceId) ?? 0) - 1;

			indegreeByResourceId.set(dependentResourceId, nextIndegree);

			if (nextIndegree === 0) {
				readyQueue.push(dependentResourceId);
			}
		}

		readyQueue.sort((left, right) => {
			const leftIndex =
				changeIndexByResourceId.get(left) ?? Number.MAX_SAFE_INTEGER;
			const rightIndex =
				changeIndexByResourceId.get(right) ?? Number.MAX_SAFE_INTEGER;

			return leftIndex - rightIndex;
		});
	}

	if (orderedChanges.length !== changes.length) {
		const unresolvedResourceIds = changes
			.map((change) => change.resource.id)
			.filter(
				(resourceId) =>
					!orderedChanges.some(
						(orderedChange) => orderedChange.resource.id === resourceId,
					),
			);

		throw new Error(
			`Cannot order plan changes due to cyclic or unresolved dependencies: ${unresolvedResourceIds.join(', ')}`,
		);
	}

	return orderedChanges;
}

function createApplyFailureReport(input: {
	readonly orderedChanges: readonly PlannedChange[];
	readonly failedChange: PlannedChange;
	readonly changeIndex: number;
	readonly steps: readonly ApplyExecutionStep[];
	readonly error: unknown;
}): ApplyFailureReport {
	const pendingChanges = input.orderedChanges.slice(input.changeIndex + 1);
	const rollbackCandidates = [...input.steps]
		.reverse()
		.filter((step) => step.result.changed)
		.map((step) => step.change);

	return {
		failedChange: input.failedChange,
		message:
			input.error instanceof Error
				? input.error.message
				: 'Unknown provider apply error',
		appliedSteps: input.steps,
		pendingChanges,
		rollbackCandidates,
	};
}

function toProviderResourceDefinition(
	resource: ResourceDefinition,
): ProviderResourceDefinition {
	return {
		provider: mapProviderName(resource.provider),
		type: mapResourceType(resource.type),
		name: resource.name,
		desired: resource.desired,
		dependsOn: [...resource.dependsOn],
	};
}

function buildStateKey(input: {
	readonly provider: ProviderName;
	readonly type: ResourceType;
	readonly name: string;
}): string {
	return `${input.provider}:${input.type}:${input.name}`;
}

function mapProviderName(
	resourceProvider: ResourceDefinition['provider'],
): ProviderName {
	if (resourceProvider === 'internal' || resourceProvider === 'discord') {
		return 'host';
	}

	return resourceProvider;
}

function mapResourceType(
	resourceType: ResourceDefinition['type'],
): ResourceType {
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
