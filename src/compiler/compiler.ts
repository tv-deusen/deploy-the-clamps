import type {
	CloudflareProviderConfig,
	CompileResult,
	CompilerContext,
	ConfigCompiler,
	ConfigDocument,
	ConfigDocumentKind,
	DeploymentConfigDocument,
	ProvidersConfigDocument,
	ResourceDefinition,
	ResourceGraph,
	ResourceType,
	StringValue,
	VultrProviderConfig,
} from '../types/compiler.ts';

export class Compiler implements ConfigCompiler {
	public compile(context: CompilerContext): CompileResult {
		const deploymentDocument = this.getDeploymentDocument(
			context.loadedConfig,
		);
		const providersDocument = this.getProvidersDocument(
			context.loadedConfig,
		);

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
			resources.push(
				this.createResourceDefinition({
					id: 'vultr.instance.main',
					type: 'vultr.instance',
					name: deploymentDocument.target.instanceName,
					provider: 'vultr',
					desired: this.buildVultrInstanceDesiredState(
						providersDocument.vultr,
						deploymentDocument,
					),
					dependsOn: [],
					tags: deploymentTags,
				}),
			);

			if (providersDocument.cloudflare) {
				resources.push(
					this.createResourceDefinition({
						id: 'vultr.firewall-group.main',
						type: 'vultr.firewall-group',
						name: `${deploymentDocument.name}-${deploymentDocument.environment}`,
						provider: 'vultr',
						desired: {
							groupName: `${deploymentDocument.name}-${deploymentDocument.environment}`,
							inboundRules: [
								{
									protocol: 'tcp',
									portRange: {
										from: deploymentDocument.target.sshPort,
										to: deploymentDocument.target.sshPort,
									},
									sourceCidrs: ['0.0.0.0/0'],
									description:
										'Allow SSH access to the deployment host.',
								},
							],
						},
						dependsOn: ['vultr.instance.main'],
						tags: deploymentTags,
					}),
				);
			}
		}

		if (providersDocument?.cloudflare) {
			resources.push(
				this.createResourceDefinition({
					id: 'cloudflare.dns-record.gateway',
					type: 'cloudflare.dns-record',
					name: deploymentDocument.target.instanceName,
					provider: 'cloudflare',
					desired: this.buildCloudflareDnsRecordDesiredState(
						providersDocument.cloudflare,
						deploymentDocument,
					),
					dependsOn: ['vultr.instance.main'],
					tags: deploymentTags,
				}),
			);
		}

		return resources;
	}

	private createResourceDefinition<TDesired>(input: {
		id: string;
		type: ResourceType;
		name: string;
		provider: ResourceDefinition<TDesired>['provider'];
		desired: TDesired;
		dependsOn: readonly string[];
		tags: Readonly<Record<string, string>>;
	}): ResourceDefinition<TDesired> {
		return {
			id: input.id,
			type: input.type,
			name: input.name,
			provider: input.provider,
			desired: input.desired,
			dependsOn: input.dependsOn,
			tags: input.tags,
		};
	}

	private buildVultrInstanceDesiredState(
		vultrProviderConfig: VultrProviderConfig,
		deploymentDocument: DeploymentConfigDocument,
	): {
		readonly hostname: string;
		readonly region: string;
		readonly plan: string;
		readonly image: string;
		readonly enableIpv6: boolean;
		readonly backups: 'enabled' | 'disabled';
		readonly ddosProtection: 'enabled' | 'disabled';
		readonly tags: readonly string[];
	} {
		return {
			hostname: vultrProviderConfig.hostname,
			region: vultrProviderConfig.region,
			plan: vultrProviderConfig.plan,
			image: vultrProviderConfig.image,
			enableIpv6: vultrProviderConfig.enableIpv6 ?? true,
			backups: vultrProviderConfig.backups ?? 'disabled',
			ddosProtection: vultrProviderConfig.ddosProtection ?? 'enabled',
			tags: [
				...(vultrProviderConfig.tags ?? []),
				deploymentDocument.name,
				deploymentDocument.environment,
			],
		};
	}

	private buildCloudflareDnsRecordDesiredState(
		cloudflareProviderConfig: CloudflareProviderConfig,
		deploymentDocument: DeploymentConfigDocument,
	): {
		readonly zoneId: string;
		readonly recordName: string;
		readonly recordType: 'A';
		readonly value: string;
		readonly ttl: number;
		readonly proxied: boolean;
	} {
		return {
			zoneId: this.stringifyValue(cloudflareProviderConfig.zoneId),
			recordName: deploymentDocument.target.instanceName,
			recordType: 'A',
			value: '__DT_CLAMPS_INSTANCE_PUBLIC_IP__',
			ttl: 300,
			proxied: false,
		};
	}

	private stringifyValue(value: StringValue): string {
		if (typeof value === 'string') {
			return value;
		}

		return `${value.provider}:${value.key}`;
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
