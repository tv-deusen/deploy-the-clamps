import type {
	ConfigDocument,
	ConfigDocumentKind,
	ConfigValidationResult,
	ConfigValidator,
	LoadedConfig,
	SecretReference,
	ValidationIssue,
} from '../types/compiler.ts';

const SUPPORTED_SECRET_PROVIDERS = new Set(['environment']);
const REQUIRED_SINGLETON_DOCUMENT_KINDS: readonly ConfigDocumentKind[] = [
	'deployment',
	'providers',
	'system',
	'tools',
	'workers',
];

type DocumentOfKind<TKind extends ConfigDocumentKind> = Extract<
	ConfigDocument,
	{ readonly kind: TKind }
>;

export class SemanticConfigValidator implements ConfigValidator {
	public validate(loadedConfig: LoadedConfig): ConfigValidationResult {
		const issues: ValidationIssue[] = [];

		this.validateRequiredDocuments(loadedConfig, issues);
		this.validateSingletonDocuments(loadedConfig, issues);
		this.validateProviderReferences(loadedConfig, issues);
		this.validateWorkerDependencies(loadedConfig, issues);
		this.validateDiscordConfiguration(loadedConfig, issues);
		this.validateNetworkConfiguration(loadedConfig, issues);
		this.validateSecretReferences(loadedConfig, issues);

		return {
			issues,
			errors: issues.filter((issue) => issue.severity === 'error'),
			warnings: issues.filter((issue) => issue.severity === 'warning'),
		};
	}

	private validateRequiredDocuments(
		loadedConfig: LoadedConfig,
		issues: ValidationIssue[],
	): void {
		for (const kind of REQUIRED_SINGLETON_DOCUMENT_KINDS) {
			const matchingDocuments = loadedConfig.documentsByKind.get(kind);

			if (
				matchingDocuments !== undefined &&
				matchingDocuments.length > 0
			) {
				continue;
			}

			issues.push({
				code: 'CONFIG_REQUIRED_DOCUMENT_MISSING',
				message: `Missing required ${kind} configuration document.`,
				severity: 'error',
				documentKind: kind,
			});
		}
	}

	private validateSingletonDocuments(
		loadedConfig: LoadedConfig,
		issues: ValidationIssue[],
	): void {
		for (const kind of REQUIRED_SINGLETON_DOCUMENT_KINDS) {
			const matchingDocuments = loadedConfig.documentsByKind.get(kind);

			if (
				matchingDocuments === undefined ||
				matchingDocuments.length <= 1
			) {
				continue;
			}

			for (const document of matchingDocuments.slice(1)) {
				issues.push({
					code: 'CONFIG_DUPLICATE_DOCUMENT',
					message: `Only one ${kind} document is allowed.`,
					severity: 'error',
					documentKind: kind,
					sourcePath: document.sourcePath,
				});
			}
		}
	}

	private validateProviderReferences(
		loadedConfig: LoadedConfig,
		issues: ValidationIssue[],
	): void {
		const deploymentDocument = this.getDocumentByKind(
			loadedConfig,
			'deployment',
		);
		const providersDocument = this.getDocumentByKind(
			loadedConfig,
			'providers',
		);
		const systemDocument = this.getDocumentByKind(loadedConfig, 'system');
		const networkDocument = this.getDocumentByKind(loadedConfig, 'network');

		if (providersDocument === undefined) {
			return;
		}

		if (
			deploymentDocument !== undefined &&
			providersDocument.vultr === undefined
		) {
			issues.push({
				code: 'CONFIG_PROVIDER_MISSING',
				message:
					'Deployment configuration requires a Vultr provider configuration.',
				severity: 'error',
				documentKind: 'providers',
				sourcePath: deploymentDocument.sourcePath,
			});
		}

		if (
			systemDocument !== undefined &&
			systemDocument.inference.provider === 'ovh' &&
			providersDocument.ovh === undefined
		) {
			issues.push({
				code: 'CONFIG_PROVIDER_REFERENCE_INVALID',
				message:
					'System inference provider references "ovh", but no OVH provider configuration was found.',
				severity: 'error',
				documentKind: 'system',
				sourcePath: systemDocument.sourcePath,
			});
		}

		if (
			networkDocument?.dns !== undefined &&
			networkDocument.dns.provider === 'cloudflare' &&
			providersDocument.cloudflare === undefined
		) {
			issues.push({
				code: 'CONFIG_PROVIDER_REFERENCE_INVALID',
				message:
					'Network DNS configuration references "cloudflare", but no Cloudflare provider configuration was found.',
				severity: 'error',
				documentKind: 'network',
				sourcePath: networkDocument.sourcePath,
			});
		}

		if (
			networkDocument?.firewall !== undefined &&
			networkDocument.firewall.provider === 'vultr' &&
			providersDocument.vultr === undefined
		) {
			issues.push({
				code: 'CONFIG_PROVIDER_REFERENCE_INVALID',
				message:
					'Network firewall configuration references "vultr", but no Vultr provider configuration was found.',
				severity: 'error',
				documentKind: 'network',
				sourcePath: networkDocument.sourcePath,
			});
		}
	}

	private validateWorkerDependencies(
		loadedConfig: LoadedConfig,
		issues: ValidationIssue[],
	): void {
		const toolsDocument = this.getDocumentByKind(loadedConfig, 'tools');
		const workersDocument = this.getDocumentByKind(loadedConfig, 'workers');

		if (toolsDocument === undefined || workersDocument === undefined) {
			return;
		}

		const workersByName = new Map(
			workersDocument.workers.map(
				(worker) => [worker.name, worker] as const,
			),
		);

		for (const tool of toolsDocument.tools) {
			if (tool.workerDependency === undefined) {
				continue;
			}

			const worker = workersByName.get(tool.workerDependency);

			if (worker === undefined) {
				issues.push({
					code: 'CONFIG_WORKER_DEPENDENCY_MISSING',
					message: `Tool "${tool.name}" references missing worker "${tool.workerDependency}".`,
					severity: 'error',
					documentKind: 'tools',
					sourcePath: toolsDocument.sourcePath,
				});
				continue;
			}

			if (!worker.enabled) {
				issues.push({
					code: 'CONFIG_WORKER_DEPENDENCY_DISABLED',
					message: `Tool "${tool.name}" depends on disabled worker "${worker.name}".`,
					severity: 'error',
					documentKind: 'tools',
					sourcePath: toolsDocument.sourcePath,
				});
			}
		}
	}

	private validateDiscordConfiguration(
		loadedConfig: LoadedConfig,
		issues: ValidationIssue[],
	): void {
		const systemDocument = this.getDocumentByKind(loadedConfig, 'system');

		if (systemDocument === undefined) {
			return;
		}

		const discordIntegration = systemDocument.integrations.discord;

		if (discordIntegration === undefined || !discordIntegration.enabled) {
			return;
		}

		if (discordIntegration.allowedUserIds.length === 0) {
			issues.push({
				code: 'CONFIG_DISCORD_ALLOWED_USERS_EMPTY',
				message:
					'Discord integration is enabled, but allowed_user_ids is empty.',
				severity: 'warning',
				documentKind: 'system',
				sourcePath: systemDocument.sourcePath,
			});
		}
	}

	private validateNetworkConfiguration(
		loadedConfig: LoadedConfig,
		issues: ValidationIssue[],
	): void {
		const networkDocument = this.getDocumentByKind(loadedConfig, 'network');
		const deploymentDocument = this.getDocumentByKind(
			loadedConfig,
			'deployment',
		);

		if (networkDocument === undefined || deploymentDocument === undefined) {
			return;
		}

		const sshPort = deploymentDocument.target.sshPort;

		for (const rule of networkDocument.firewall?.inboundRules ?? []) {
			if (rule.port !== sshPort) {
				continue;
			}

			return;
		}

		if (networkDocument.firewall !== undefined) {
			issues.push({
				code: 'CONFIG_FIREWALL_SSH_PORT_MISSING',
				message: `Firewall rules do not expose the deployment SSH port ${sshPort}.`,
				severity: 'warning',
				documentKind: 'network',
				sourcePath: networkDocument.sourcePath,
			});
		}
	}

	private validateSecretReferences(
		loadedConfig: LoadedConfig,
		issues: ValidationIssue[],
	): void {
		for (const document of loadedConfig.documents) {
			this.validateSecretReferencesInValue(document, document, issues);
		}
	}

	private validateSecretReferencesInValue(
		document: ConfigDocument,
		value: unknown,
		issues: ValidationIssue[],
	): void {
		if (Array.isArray(value)) {
			for (const item of value) {
				this.validateSecretReferencesInValue(document, item, issues);
			}
			return;
		}

		if (!this.isRecord(value)) {
			return;
		}

		if (this.isSecretReference(value)) {
			if (!SUPPORTED_SECRET_PROVIDERS.has(value.provider)) {
				issues.push({
					code: 'CONFIG_SECRET_PROVIDER_UNSUPPORTED',
					message: `Secret provider "${value.provider}" is not supported.`,
					severity: 'error',
					documentKind: document.kind,
					sourcePath: document.sourcePath,
				});
			}

			if (value.key.trim().length === 0) {
				issues.push({
					code: 'CONFIG_SECRET_KEY_EMPTY',
					message: 'Secret reference key must not be empty.',
					severity: 'error',
					documentKind: document.kind,
					sourcePath: document.sourcePath,
				});
			}

			return;
		}

		for (const nestedValue of Object.values(value)) {
			this.validateSecretReferencesInValue(document, nestedValue, issues);
		}
	}

	private getDocumentByKind<TKind extends ConfigDocumentKind>(
		loadedConfig: LoadedConfig,
		kind: TKind,
	): DocumentOfKind<TKind> | undefined {
		const matchingDocuments = loadedConfig.documentsByKind.get(kind);

		// TODO: is there a way to get tsc to see that
		// it's checking undefined?
		if (
			matchingDocuments === undefined ||
			matchingDocuments.length === 0 ||
			!this.isDocumentOfKind<TKind>(
				matchingDocuments[0] as ConfigDocument,
				kind,
			)
		) {
			return undefined;
		}

		return matchingDocuments[0] as DocumentOfKind<TKind>;
	}

	private isDocumentOfKind<TKind extends ConfigDocumentKind>(
		document: ConfigDocument,
		kind: TKind,
	): document is DocumentOfKind<TKind> {
		return document.kind === kind;
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null;
	}

	private isSecretReference(value: unknown): value is SecretReference {
		if (!this.isRecord(value)) {
			return false;
		}

		return (
			value.kind === 'secret' &&
			typeof value.provider === 'string' &&
			typeof value.key === 'string'
		);
	}
}

export function createConfigValidator(): ConfigValidator {
	return new SemanticConfigValidator();
}
