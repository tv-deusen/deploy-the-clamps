import type {
	CompileResult,
	CompilerContext,
	ConfigCompiler,
	ConfigDocument,
	ConfigDocumentKind,
	DeploymentConfigDocument,
	NetworkConfigDocument,
	ProvidersConfigDocument,
	ResourceDefinition,
	ResourceGraph,
	SecretReference,
	SystemConfigDocument,
	TunnelConfigDocument,
} from '../types/compiler.ts';

export interface CompilerDependencies {
	readonly resolveSecret?: (reference: SecretReference) => string;
}

type BuildResourcesInput = {
	readonly deploymentDocument: DeploymentConfigDocument;
	readonly networkDocument: NetworkConfigDocument | null;
	readonly providersDocument: ProvidersConfigDocument | null;
	readonly systemDocument: SystemConfigDocument | null;
	readonly tunnelDocument: TunnelConfigDocument | null;
};

type BuildResourcesResult = {
	readonly resources: readonly ResourceDefinition[];
	readonly warnings: CompileResult['warnings'];
};

export class Compiler implements ConfigCompiler {
	private readonly resolveSecretValue:
		| ((reference: SecretReference) => string)
		| undefined;

	public constructor(dependencies: CompilerDependencies = {}) {
		this.resolveSecretValue = dependencies.resolveSecret;
	}

	public compile(context: CompilerContext): CompileResult {
		const deploymentDocument = this.getDeploymentDocument(
			context.loadedConfig,
		);

		if (!deploymentDocument) {
			return {
				deployment: {
					name: 'unknown-deployment',
					environment: 'unknown-environment',
					generatedAt: context.now.toISOString(),
					configVersion: 'unknown-version',
				},
				graph: {
					resources: [],
					resourceIds: new Set<string>(),
				},
				warnings: [
					{
						code: 'missing-deployment',
						message: 'No deployment document was found.',
					},
				],
			};
		}

		const providersDocument = this.getProvidersDocument(
			context.loadedConfig,
		);
		const networkDocument = this.getNetworkDocument(context.loadedConfig);
		const systemDocument = this.getSystemDocument(context.loadedConfig);
		const tunnelDocument = this.getTunnelDocument(context.loadedConfig);

		const buildResourcesResult = this.buildResources({
			deploymentDocument,
			networkDocument,
			providersDocument,
			systemDocument,
			tunnelDocument,
		});

		const graph: ResourceGraph = {
			resources: buildResourcesResult.resources,
			resourceIds: new Set(
				buildResourcesResult.resources.map((resource) => resource.id),
			),
		};

		return {
			deployment: {
				name: deploymentDocument.name,
				environment: deploymentDocument.environment,
				generatedAt: context.now.toISOString(),
				configVersion: deploymentDocument.version,
			},
			graph,
			warnings: buildResourcesResult.warnings,
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

	private getNetworkDocument(
		loadedConfig: CompilerContext['loadedConfig'],
	): NetworkConfigDocument | null {
		return this.getFirstDocumentByKind(
			loadedConfig,
			'network',
			isNetworkConfigDocument,
		);
	}

	private getSystemDocument(
		loadedConfig: CompilerContext['loadedConfig'],
	): SystemConfigDocument | null {
		return this.getFirstDocumentByKind(
			loadedConfig,
			'system',
			isSystemConfigDocument,
		);
	}

	private getTunnelDocument(
		loadedConfig: CompilerContext['loadedConfig'],
	): TunnelConfigDocument | null {
		return this.getFirstDocumentByKind(
			loadedConfig,
			'tunnel',
			isTunnelConfigDocument,
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

	private buildResources(input: BuildResourcesInput): BuildResourcesResult {
		const resources: ResourceDefinition[] = [];
		const warnings: CompileResult['warnings'][number][] = [];
		const deploymentTags = {
			deployment: input.deploymentDocument.name,
			environment: input.deploymentDocument.environment,
		} as const;

		if (input.providersDocument?.vultr) {
			resources.push({
				id: 'vultr.instance.main',
				type: 'vultr.instance',
				name: input.deploymentDocument.target.instanceName,
				provider: 'vultr',
				desired: {
					hostname: input.providersDocument.vultr.hostname,
					region: input.providersDocument.vultr.region,
					plan: input.providersDocument.vultr.plan,
					image: input.providersDocument.vultr.image,
					enableIpv6: false,
					backups: 'disabled',
					ddosProtection: 'disabled',
					tags: [
						input.deploymentDocument.name,
						input.deploymentDocument.environment,
					],
				},
				dependsOn: [],
				tags: deploymentTags,
			});
		}

		if (input.networkDocument?.firewall) {
			const firewallDependsOn = input.providersDocument?.vultr
				? ['vultr.instance.main']
				: [];

			resources.push({
				id: 'vultr.firewall.gateway',
				type: 'vultr.firewall-group',
				name: `${input.deploymentDocument.target.instanceName}-firewall`,
				provider: 'vultr',
				desired: {
					groupName: `${input.deploymentDocument.target.instanceName}-firewall`,
					inboundRules:
						input.networkDocument.firewall.inboundRules.map(
							(rule) => ({
								protocol: rule.protocol,
								portRange: {
									from: rule.port,
									to: rule.port,
								},
								sourceCidrs: [rule.source],
								description: rule.description,
							}),
						),
				},
				dependsOn: firewallDependsOn,
				tags: deploymentTags,
			});
		}

		if (input.networkDocument?.dns && input.providersDocument?.cloudflare) {
			const zoneId = this.resolveConfigString(
				input.providersDocument.cloudflare.zoneId,
			);

			for (const [
				index,
				record,
			] of input.networkDocument.dns.records.entries()) {
				resources.push({
					id: `cloudflare.dns-record.${index}`,
					type: 'cloudflare.dns-record',
					name: record.name,
					provider: 'cloudflare',
					desired: {
						zoneId,
						recordName: record.name,
						recordType: record.type,
						value: record.target,
						ttl: record.ttl,
						proxied: record.proxied ?? false,
					},
					dependsOn: [],
					tags: deploymentTags,
				});
			}
		}

		if (input.tunnelDocument && input.providersDocument?.cloudflare) {
			const accountId = this.resolveConfigString(
				input.providersDocument.cloudflare.accountId,
			);
			const serviceUrl = this.getTunnelServiceUrl(
				input.tunnelDocument,
				input.systemDocument,
			);
			const baseDependsOn = input.providersDocument.vultr
				? ['vultr.instance.main']
				: [];

			resources.push({
				id: 'cloudflare.tunnel.gateway',
				type: 'cloudflare.tunnel',
				name: input.tunnelDocument.name,
				provider: 'cloudflare',
				desired: {
					accountId,
					tunnelName: input.tunnelDocument.name,
					hostname: input.tunnelDocument.hostname,
					serviceUrl,
				},
				dependsOn: baseDependsOn,
				tags: deploymentTags,
			});

			resources.push({
				id: 'host.file.cloudflared-config',
				type: 'host.file',
				name: input.tunnelDocument.systemd.configPath,
				provider: 'host',
				desired: {
					kind: 'file',
					path: input.tunnelDocument.systemd.configPath,
					content: renderCloudflaredConfig(
						input.tunnelDocument,
						serviceUrl,
					),
					mode: '0644',
				},
				dependsOn: baseDependsOn,
				tags: deploymentTags,
			});

			resources.push({
				id: 'host.systemd-unit.cloudflared',
				type: 'host.systemd-unit',
				name: input.tunnelDocument.systemd.unitName,
				provider: 'host',
				desired: {
					kind: 'systemd_service',
					unitName: input.tunnelDocument.systemd.unitName,
					enabled: true,
					wantedState: 'active',
					unitFileContent: renderCloudflaredServiceUnit(
						input.tunnelDocument,
					),
				},
				dependsOn: [
					'cloudflare.tunnel.gateway',
					'host.file.cloudflared-config',
					...baseDependsOn,
				],
				tags: deploymentTags,
			});

			if (input.tunnelDocument.access.enabled) {
				resources.push({
					id: 'cloudflare.access-application.gateway',
					type: 'cloudflare.access-application',
					name: input.tunnelDocument.access.applicationName,
					provider: 'cloudflare',
					desired: {
						accountId,
						applicationName:
							input.tunnelDocument.access.applicationName,
						domain: input.tunnelDocument.hostname,
						sessionDuration:
							input.tunnelDocument.access.sessionDuration,
					},
					dependsOn: ['cloudflare.tunnel.gateway'],
					tags: deploymentTags,
				});

				resources.push({
					id: 'cloudflare.access-policy.gateway',
					type: 'cloudflare.access-policy',
					name: input.tunnelDocument.access.policyName,
					provider: 'cloudflare',
					desired: {
						accountId,
						applicationName:
							input.tunnelDocument.access.applicationName,
						policyName: input.tunnelDocument.access.policyName,
						allowedEmails: [
							...input.tunnelDocument.access.allowedEmails,
						],
						precedence: 1,
					},
					dependsOn: ['cloudflare.access-application.gateway'],
					tags: deploymentTags,
				});
			}
		} else if (input.tunnelDocument) {
			warnings.push({
				code: 'missing-cloudflare-provider',
				message:
					'A tunnel document was provided, but no Cloudflare provider document is available.',
				sourcePath: input.tunnelDocument.sourcePath,
			});
		}

		return {
			resources,
			warnings,
		};
	}

	private getTunnelServiceUrl(
		tunnelDocument: TunnelConfigDocument,
		systemDocument: SystemConfigDocument | null,
	): string {
		if (tunnelDocument.service.target === 'url') {
			return tunnelDocument.service.url ?? 'http://127.0.0.1:3000';
		}

		if (!systemDocument) {
			return 'http://127.0.0.1:3000';
		}

		return `http://${systemDocument.app.gatewayHost}:${systemDocument.app.gatewayPort}`;
	}

	private resolveConfigString(value: string | SecretReference): string {
		if (typeof value === 'string') {
			return value;
		}

		if (!this.resolveSecretValue) {
			throw new Error(
				`Cannot resolve secret "${value.key}" because no secret resolver is configured.`,
			);
		}

		return this.resolveSecretValue(value);
	}
}

function renderCloudflaredConfig(
	tunnelDocument: TunnelConfigDocument,
	serviceUrl: string,
): string {
	return [
		`tunnel: ${tunnelDocument.name}`,
		`ingress:`,
		`  - hostname: ${tunnelDocument.hostname}`,
		`    service: ${serviceUrl}`,
		`  - service: http_status:404`,
		'',
	].join('\n');
}

function renderCloudflaredServiceUnit(
	tunnelDocument: TunnelConfigDocument,
): string {
	return [
		'[Unit]',
		'Description=Cloudflare Tunnel',
		'After=network-online.target',
		'Wants=network-online.target',
		'',
		'[Service]',
		'Type=simple',
		`ExecStart=/usr/local/bin/cloudflared tunnel --config ${tunnelDocument.systemd.configPath} run`,
		'Restart=on-failure',
		'RestartSec=5',
		'',
		'[Install]',
		'WantedBy=multi-user.target',
		'',
	].join('\n');
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

function isNetworkConfigDocument(
	document: ConfigDocument,
): document is NetworkConfigDocument {
	return document.kind === 'network';
}

function isSystemConfigDocument(
	document: ConfigDocument,
): document is SystemConfigDocument {
	return document.kind === 'system';
}

function isTunnelConfigDocument(
	document: ConfigDocument,
): document is TunnelConfigDocument {
	return document.kind === 'tunnel';
}
