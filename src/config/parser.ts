import { z } from 'zod';
import type {
	CloudflareProviderConfig,
	CompileWarning,
	ConfigDocumentKind,
	ConfigDocumentParser,
	FirewallRuleConfig,
	OvhProviderConfig,
	ParsedDocumentResult,
	RawYamlDocument,
	SecretReference,
	StringValue,
	SystemConfigDocument,
	ToolDefinitionConfig,
	VultrProviderConfig,
	WorkerConfig,
} from '../types/compiler.ts';

const SUPPORTED_CONFIG_VERSIONS = ['1.0'] as const;
const SUPPORTED_DOCUMENT_KINDS = [
	'deployment',
	'memory',
	'network',
	'providers',
	'system',
	'tools',
	'workers',
] as const;

const DEFAULT_THREAD_PER_SESSION = false;
const DEFAULT_TYPING_INDICATOR = false;
const DEFAULT_VULTR_ENABLE_IPV6 = true;
const DEFAULT_VULTR_BACKUPS = 'disabled' as const;
const DEFAULT_VULTR_DDOS_PROTECTION = 'enabled' as const;
const DEFAULT_VULTR_TAGS: readonly string[] = [];
const DEFAULT_RULE_TTL_SECONDS = 300;
const MIN_PORT = 1;
const MIN_CPU_QUOTA_PERCENT = 1;
const MAX_PORT = 65_535;
const MAX_CPU_QUOTA_PERCENT = 100;
const SECRET_REFERENCE_PREFIX = '${';
const SECRET_REFERENCE_SUFFIX = '}';

const supportedConfigVersionSchema = z.enum(SUPPORTED_CONFIG_VERSIONS);
const supportedDocumentKindSchema = z.enum(SUPPORTED_DOCUMENT_KINDS);
const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
const restartPolicySchema = z.enum(['always', 'on-failure', 'never']);
const dnsRecordTypeSchema = z.enum(['A', 'AAAA', 'CNAME', 'TXT']);
const firewallProtocolSchema = z.enum(['tcp', 'udp']);
const stringWithContentSchema = z
	.string()
	.trim()
	.min(1, 'Value must not be empty.');

const positiveIntegerSchema = z
	.number()
	.int()
	.positive('Value must be a positive integer.');

const secretReferenceSchema = z
	.object({
		kind: z.literal('secret'),
		provider: stringWithContentSchema,
		key: stringWithContentSchema,
	})
	.strict();

const stringValueSchema = z.union([
	stringWithContentSchema,
	secretReferenceSchema,
]);

const systemConfigSchema = z
	.object({
		version: supportedConfigVersionSchema,
		app: z
			.object({
				name: stringWithContentSchema,
				environment: stringWithContentSchema,
				log_level: logLevelSchema,
				admin_port: positiveIntegerSchema,
			})
			.strict(),
		inference: z
			.object({
				provider: stringWithContentSchema,
				base_url: stringValueSchema,
				api_key: secretReferenceSchema,
				timeout_seconds: positiveIntegerSchema,
				retry_count: z.number().int().min(0),
				models: z
					.object({
						reasoning: stringWithContentSchema,
						extraction: stringWithContentSchema,
						embedding: stringWithContentSchema,
					})
					.strict(),
			})
			.strict(),
		integrations: z
			.object({
				discord: z
					.object({
						enabled: z.boolean(),
						bot_token: secretReferenceSchema,
						guild_id: stringValueSchema,
						channel_id: stringValueSchema,
						allowed_user_ids: z.array(stringValueSchema),
						typing_indicator: z.boolean().optional(),
						thread_per_session: z.boolean().optional(),
					})
					.strict()
					.optional(),
			})
			.strict()
			.optional(),
		discord: z
			.object({
				enabled: z.boolean(),
				bot_token: stringValueSchema,
				guild_id: stringValueSchema,
				channel_id: stringValueSchema,
				allowed_user_ids: z.array(stringValueSchema),
				features: z
					.object({
						typing_indicator: z.boolean().optional(),
						thread_per_session: z.boolean().optional(),
					})
					.strict()
					.optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

const toolsConfigSchema = z
	.object({
		version: supportedConfigVersionSchema,
		tools: z.array(
			z
				.object({
					name: stringWithContentSchema,
					enabled: z.boolean(),
					description: stringWithContentSchema,
					timeout_ms: positiveIntegerSchema,
					worker_dependency: stringWithContentSchema.optional(),
				})
				.strict(),
		),
		concurrency: z
			.object({
				max_concurrent_tools: positiveIntegerSchema,
				max_per_worker: positiveIntegerSchema,
				tool_call_timeout_ms: positiveIntegerSchema,
			})
			.strict(),
	})
	.strict();

const workerHealthCheckSchema = z
	.object({
		enabled: z.boolean(),
		interval_ms: positiveIntegerSchema,
		timeout_ms: positiveIntegerSchema,
	})
	.strict();

const workerResourcesSchema = z
	.object({
		memory_limit_mb: positiveIntegerSchema.optional(),
		cpu_quota_percent: z
			.number()
			.int()
			.min(MIN_CPU_QUOTA_PERCENT)
			.max(MAX_CPU_QUOTA_PERCENT)
			.optional(),
	})
	.strict();

const workersConfigSchema = z
	.object({
		version: supportedConfigVersionSchema,
		workers: z.array(
			z
				.object({
					name: stringWithContentSchema,
					enabled: z.boolean(),
					script: stringWithContentSchema,
					socket: stringWithContentSchema,
					restart_policy: restartPolicySchema,
					max_restarts: z.number().int().min(0),
					restart_delay_ms: z.number().int().min(0),
					health_check: workerHealthCheckSchema.optional(),
					resources: workerResourcesSchema.optional(),
				})
				.strict(),
		),
	})
	.strict();

const memoryConfigSchema = z
	.object({
		version: supportedConfigVersionSchema,
		graphiti: z
			.object({
				enabled: z.boolean(),
				url: stringWithContentSchema,
				health_check_interval_ms: positiveIntegerSchema,
				extraction: z
					.object({
						enabled: z.boolean(),
						model: stringWithContentSchema,
						batch_size: positiveIntegerSchema,
						extraction_interval_seconds: positiveIntegerSchema,
					})
					.strict()
					.optional(),
				embedding: z
					.object({
						enabled: z.boolean(),
						model: stringWithContentSchema,
						cache_vectors: z.boolean(),
					})
					.strict()
					.optional(),
				retention: z
					.object({
						default_ttl_days: positiveIntegerSchema,
						archive_after_days: positiveIntegerSchema,
					})
					.strict()
					.optional(),
			})
			.strict(),
		docker: z
			.object({
				compose_file: stringWithContentSchema,
				graphiti_container: stringWithContentSchema,
				falkordb_container: stringWithContentSchema,
				network: stringWithContentSchema,
			})
			.strict()
			.optional(),
	})
	.strict();

const networkConfigSchema = z
	.object({
		version: supportedConfigVersionSchema,
		dns: z
			.object({
				provider: stringWithContentSchema,
				zone: stringWithContentSchema,
				records: z.array(
					z
						.object({
							name: stringWithContentSchema,
							type: dnsRecordTypeSchema,
							ttl: positiveIntegerSchema.default(
								DEFAULT_RULE_TTL_SECONDS,
							),
							proxied: z.boolean().optional(),
							target: stringWithContentSchema,
						})
						.strict(),
				),
			})
			.strict()
			.optional(),
		firewall: z
			.object({
				provider: stringWithContentSchema,
				inbound_rules: z.array(
					z
						.object({
							protocol: firewallProtocolSchema,
							port: z.number().int().min(MIN_PORT).max(MAX_PORT),
							source: stringWithContentSchema,
							description: stringWithContentSchema,
						})
						.strict(),
				),
			})
			.strict()
			.optional(),
	})
	.strict();

const deploymentConfigSchema = z
	.object({
		version: supportedConfigVersionSchema,
		name: stringWithContentSchema,
		environment: stringWithContentSchema,
		target: z
			.object({
				instance_name: stringWithContentSchema,
				ssh_user: stringWithContentSchema,
				ssh_port: z.number().int().min(MIN_PORT).max(MAX_PORT),
			})
			.strict(),
	})
	.strict();

const providersConfigSchema = z
	.object({
		version: supportedConfigVersionSchema,
		vultr: z
			.object({
				region: stringWithContentSchema,
				plan: stringWithContentSchema,
				image: stringWithContentSchema,
				hostname: stringWithContentSchema,
				api_token: stringValueSchema,
				enable_ipv6: z.boolean().optional(),
				backups: z.enum(['enabled', 'disabled']).optional(),
				ddos_protection: z.enum(['enabled', 'disabled']).optional(),
				tags: z.array(stringWithContentSchema).optional(),
			})
			.strict()
			.optional(),
		cloudflare: z
			.object({
				zone_id: stringValueSchema,
				api_token: stringValueSchema,
			})
			.strict()
			.optional(),
		ovh: z
			.object({
				base_url: stringWithContentSchema,
				api_key: stringValueSchema,
			})
			.strict()
			.optional(),
	})
	.strict();

type SystemConfigInput = z.infer<typeof systemConfigSchema>;
type ToolsConfigInput = z.infer<typeof toolsConfigSchema>;
type WorkersConfigInput = z.infer<typeof workersConfigSchema>;
type MemoryConfigInput = z.infer<typeof memoryConfigSchema>;
type ProvidersConfigInput = z.infer<typeof providersConfigSchema>;

export class StrictConfigDocumentParser implements ConfigDocumentParser {
	public parseDocument(input: RawYamlDocument): ParsedDocumentResult {
		const documentKind = this.inferDocumentKind(input.sourcePath);

		switch (documentKind) {
			case 'deployment':
				return this.parseDeploymentDocument(input);
			case 'memory':
				return this.parseMemoryDocument(input);
			case 'network':
				return this.parseNetworkDocument(input);
			case 'providers':
				return this.parseProvidersDocument(input);
			case 'system':
				return this.parseSystemDocument(input);
			case 'tools':
				return this.parseToolsDocument(input);
			case 'workers':
				return this.parseWorkersDocument(input);
		}
	}

	private inferDocumentKind(sourcePath: string): ConfigDocumentKind {
		const normalizedSourcePath = sourcePath.replaceAll('\\', '/');
		const fileName = normalizedSourcePath.split('/').at(-1);

		if (!fileName) {
			throw new Error(
				`Unable to infer config document kind from "${sourcePath}".`,
			);
		}

		const [baseName] = fileName.split('.');

		if (!baseName) {
			throw new Error(
				`Unable to infer config document kind from "${sourcePath}".`,
			);
		}

		const parsedKind = supportedDocumentKindSchema.safeParse(baseName);

		if (!parsedKind.success) {
			throw new Error(
				`Unsupported config document "${fileName}". Supported document names: ${SUPPORTED_DOCUMENT_KINDS.join(', ')}.`,
			);
		}

		return parsedKind.data;
	}

	private parseSystemDocument(input: RawYamlDocument): ParsedDocumentResult {
		const normalizedInput = systemConfigSchema.parse(input.parsedValue);
		const discordIntegration =
			this.normalizeDiscordIntegration(normalizedInput);

		return {
			document: {
				kind: 'system',
				version: normalizedInput.version,
				sourcePath: input.sourcePath,
				app: {
					name: normalizedInput.app.name,
					environment: normalizedInput.app.environment,
					logLevel: normalizedInput.app.log_level,
					adminPort: normalizedInput.app.admin_port,
				},
				inference: {
					provider: normalizedInput.inference.provider,
					baseUrl: this.normalizeStringValue(
						normalizedInput.inference.base_url,
					),
					apiKey: this.normalizeSecretReference(
						normalizedInput.inference.api_key,
					),
					timeoutSeconds: normalizedInput.inference.timeout_seconds,
					retryCount: normalizedInput.inference.retry_count,
					models: {
						reasoning: normalizedInput.inference.models.reasoning,
						extraction: normalizedInput.inference.models.extraction,
						embedding: normalizedInput.inference.models.embedding,
					},
				},
				integrations:
					discordIntegration === undefined
						? {}
						: { discord: discordIntegration },
			},
			warnings: [],
		};
	}

	private parseToolsDocument(input: RawYamlDocument): ParsedDocumentResult {
		const normalizedInput = toolsConfigSchema.parse(input.parsedValue);

		return {
			document: {
				kind: 'tools',
				version: normalizedInput.version,
				sourcePath: input.sourcePath,
				tools: normalizedInput.tools.map((toolDefinition) =>
					this.toToolDefinition(toolDefinition),
				),
				concurrency: {
					maxConcurrentTools:
						normalizedInput.concurrency.max_concurrent_tools,
					maxPerWorker: normalizedInput.concurrency.max_per_worker,
					toolCallTimeoutMs:
						normalizedInput.concurrency.tool_call_timeout_ms,
				},
			},
			warnings: [],
		};
	}

	private parseWorkersDocument(input: RawYamlDocument): ParsedDocumentResult {
		const normalizedInput = workersConfigSchema.parse(input.parsedValue);

		return {
			document: {
				kind: 'workers',
				version: normalizedInput.version,
				sourcePath: input.sourcePath,
				workers: normalizedInput.workers.map((worker) =>
					this.toWorkerConfig(worker),
				),
			},
			warnings: [],
		};
	}

	private parseMemoryDocument(input: RawYamlDocument): ParsedDocumentResult {
		const normalizedInput = memoryConfigSchema.parse(input.parsedValue);
		const graphiti = this.toMemoryGraphitiConfig(normalizedInput.graphiti);
		const docker =
			normalizedInput.docker === undefined
				? undefined
				: {
						composeFile: normalizedInput.docker.compose_file,
						graphitiContainer:
							normalizedInput.docker.graphiti_container,
						falkordbContainer:
							normalizedInput.docker.falkordb_container,
						network: normalizedInput.docker.network,
					};

		return {
			document: {
				kind: 'memory',
				version: normalizedInput.version,
				sourcePath: input.sourcePath,
				graphiti,
				...(docker === undefined ? {} : { docker }),
			},
			warnings: [],
		};
	}

	private parseNetworkDocument(input: RawYamlDocument): ParsedDocumentResult {
		const normalizedInput = networkConfigSchema.parse(input.parsedValue);
		const dns =
			normalizedInput.dns === undefined
				? undefined
				: {
						provider: normalizedInput.dns.provider,
						zone: normalizedInput.dns.zone,
						records: normalizedInput.dns.records.map((record) => ({
							name: record.name,
							type: record.type,
							ttl: record.ttl,
							...(record.proxied === undefined
								? {}
								: { proxied: record.proxied }),
							target: record.target,
						})),
					};
		const firewall =
			normalizedInput.firewall === undefined
				? undefined
				: {
						provider: normalizedInput.firewall.provider,
						inboundRules:
							normalizedInput.firewall.inbound_rules.map(
								(rule): FirewallRuleConfig => ({
									protocol: rule.protocol,
									port: rule.port,
									source: rule.source,
									description: rule.description,
								}),
							),
					};

		return {
			document: {
				kind: 'network',
				version: normalizedInput.version,
				sourcePath: input.sourcePath,
				...(dns === undefined ? {} : { dns }),
				...(firewall === undefined ? {} : { firewall }),
			},
			warnings: [],
		};
	}

	private parseDeploymentDocument(
		input: RawYamlDocument,
	): ParsedDocumentResult {
		const normalizedInput = deploymentConfigSchema.parse(input.parsedValue);

		return {
			document: {
				kind: 'deployment',
				version: normalizedInput.version,
				sourcePath: input.sourcePath,
				name: normalizedInput.name,
				environment: normalizedInput.environment,
				target: {
					instanceName: normalizedInput.target.instance_name,
					sshUser: normalizedInput.target.ssh_user,
					sshPort: normalizedInput.target.ssh_port,
				},
			},
			warnings: [],
		};
	}

	private parseProvidersDocument(
		input: RawYamlDocument,
	): ParsedDocumentResult {
		const normalizedInput = providersConfigSchema.parse(input.parsedValue);
		const vultr =
			normalizedInput.vultr === undefined
				? undefined
				: this.normalizeVultrProvider(normalizedInput.vultr);
		const cloudflare =
			normalizedInput.cloudflare === undefined
				? undefined
				: this.normalizeCloudflareProvider(normalizedInput.cloudflare);
		const ovh =
			normalizedInput.ovh === undefined
				? undefined
				: this.normalizeOvhProvider(normalizedInput.ovh);

		return {
			document: {
				kind: 'providers',
				version: normalizedInput.version,
				sourcePath: input.sourcePath,
				...(vultr === undefined ? {} : { vultr }),
				...(cloudflare === undefined ? {} : { cloudflare }),
				...(ovh === undefined ? {} : { ovh }),
			},
			warnings: this.collectProviderWarnings(input, normalizedInput),
		};
	}

	private normalizeDiscordIntegration(
		input: SystemConfigInput,
	): SystemConfigDocument['integrations']['discord'] | undefined {
		if (input.integrations?.discord) {
			return {
				enabled: input.integrations.discord.enabled,
				botToken: this.normalizeSecretReference(
					input.integrations.discord.bot_token,
				),
				guildId: this.normalizeStringValue(
					input.integrations.discord.guild_id,
				),
				channelId: this.normalizeStringValue(
					input.integrations.discord.channel_id,
				),
				allowedUserIds: input.integrations.discord.allowed_user_ids.map(
					(userId) => this.normalizeStringValue(userId),
				),
				typingIndicator:
					input.integrations.discord.typing_indicator ??
					DEFAULT_TYPING_INDICATOR,
				threadPerSession:
					input.integrations.discord.thread_per_session ??
					DEFAULT_THREAD_PER_SESSION,
			};
		}

		if (input.discord) {
			return {
				enabled: input.discord.enabled,
				botToken: this.normalizeSecretReference(
					input.discord.bot_token,
				),
				guildId: this.normalizeStringValue(input.discord.guild_id),
				channelId: this.normalizeStringValue(input.discord.channel_id),
				allowedUserIds: input.discord.allowed_user_ids.map((userId) =>
					this.normalizeStringValue(userId),
				),
				typingIndicator:
					input.discord.features?.typing_indicator ??
					DEFAULT_TYPING_INDICATOR,
				threadPerSession:
					input.discord.features?.thread_per_session ??
					DEFAULT_THREAD_PER_SESSION,
			};
		}

		return undefined;
	}

	private toToolDefinition(
		toolDefinition: ToolsConfigInput['tools'][number],
	): ToolDefinitionConfig {
		return {
			name: toolDefinition.name,
			enabled: toolDefinition.enabled,
			description: toolDefinition.description,
			timeoutMs: toolDefinition.timeout_ms,
			...(toolDefinition.worker_dependency === undefined
				? {}
				: { workerDependency: toolDefinition.worker_dependency }),
		};
	}

	private toWorkerConfig(
		worker: WorkersConfigInput['workers'][number],
	): WorkerConfig {
		const healthCheck =
			worker.health_check === undefined
				? undefined
				: {
						enabled: worker.health_check.enabled,
						intervalMs: worker.health_check.interval_ms,
						timeoutMs: worker.health_check.timeout_ms,
					};
		const resources =
			worker.resources === undefined
				? undefined
				: {
						...(worker.resources.memory_limit_mb === undefined
							? {}
							: {
									memoryLimitMb:
										worker.resources.memory_limit_mb,
								}),
						...(worker.resources.cpu_quota_percent === undefined
							? {}
							: {
									cpuQuotaPercent:
										worker.resources.cpu_quota_percent,
								}),
					};

		return {
			name: worker.name,
			enabled: worker.enabled,
			script: worker.script,
			socket: worker.socket,
			restartPolicy: worker.restart_policy,
			maxRestarts: worker.max_restarts,
			restartDelayMs: worker.restart_delay_ms,
			...(healthCheck === undefined ? {} : { healthCheck }),
			...(resources === undefined || Object.keys(resources).length === 0
				? {}
				: { resources }),
		};
	}

	private toMemoryGraphitiConfig(graphiti: MemoryConfigInput['graphiti']): {
		readonly enabled: boolean;
		readonly url: string;
		readonly healthCheckIntervalMs: number;
		readonly extraction?: {
			readonly enabled: boolean;
			readonly model: string;
			readonly batchSize: number;
			readonly extractionIntervalSeconds: number;
		};
		readonly embedding?: {
			readonly enabled: boolean;
			readonly model: string;
			readonly cacheVectors: boolean;
		};
		readonly retention?: {
			readonly defaultTtlDays: number;
			readonly archiveAfterDays: number;
		};
	} {
		const extraction =
			graphiti.extraction === undefined
				? undefined
				: {
						enabled: graphiti.extraction.enabled,
						model: graphiti.extraction.model,
						batchSize: graphiti.extraction.batch_size,
						extractionIntervalSeconds:
							graphiti.extraction.extraction_interval_seconds,
					};
		const embedding =
			graphiti.embedding === undefined
				? undefined
				: {
						enabled: graphiti.embedding.enabled,
						model: graphiti.embedding.model,
						cacheVectors: graphiti.embedding.cache_vectors,
					};
		const retention =
			graphiti.retention === undefined
				? undefined
				: {
						defaultTtlDays: graphiti.retention.default_ttl_days,
						archiveAfterDays: graphiti.retention.archive_after_days,
					};

		return {
			enabled: graphiti.enabled,
			url: graphiti.url,
			healthCheckIntervalMs: graphiti.health_check_interval_ms,
			...(extraction === undefined ? {} : { extraction }),
			...(embedding === undefined ? {} : { embedding }),
			...(retention === undefined ? {} : { retention }),
		};
	}

	private normalizeVultrProvider(
		input: NonNullable<ProvidersConfigInput['vultr']>,
	): VultrProviderConfig {
		return {
			region: input.region,
			plan: input.plan,
			image: input.image,
			hostname: input.hostname,
			apiToken: this.normalizeSecretReference(input.api_token),
			enableIpv6: input.enable_ipv6 ?? DEFAULT_VULTR_ENABLE_IPV6,
			backups: input.backups ?? DEFAULT_VULTR_BACKUPS,
			ddosProtection:
				input.ddos_protection ?? DEFAULT_VULTR_DDOS_PROTECTION,
			tags: input.tags ?? DEFAULT_VULTR_TAGS,
		};
	}

	private normalizeCloudflareProvider(
		input: NonNullable<ProvidersConfigInput['cloudflare']>,
	): CloudflareProviderConfig {
		return {
			zoneId: this.normalizeStringValue(input.zone_id),
			apiToken: this.normalizeSecretReference(input.api_token),
		};
	}

	private normalizeOvhProvider(
		input: NonNullable<ProvidersConfigInput['ovh']>,
	): OvhProviderConfig {
		return {
			baseUrl: input.base_url,
			apiKey: this.normalizeSecretReference(input.api_key),
		};
	}

	private collectProviderWarnings(
		input: RawYamlDocument,
		normalizedInput: ProvidersConfigInput,
	): readonly CompileWarning[] {
		const warnings: CompileWarning[] = [];

		if (
			normalizedInput.cloudflare !== undefined &&
			typeof normalizedInput.cloudflare.zone_id !== 'string'
		) {
			warnings.push({
				code: 'CONFIG_CLOUDFLARE_ZONE_SECRET',
				message:
					'Using a secret reference for Cloudflare zone_id is supported, but a plain string value is usually easier to audit.',
				sourcePath: input.sourcePath,
			});
		}

		return warnings;
	}

	private normalizeStringValue(value: StringValue): StringValue {
		if (typeof value !== 'string') {
			return value;
		}

		return this.tryParseSecretReference(value);
	}

	private normalizeSecretReference(value: StringValue): SecretReference {
		if (typeof value !== 'string') {
			return value;
		}

		const normalizedValue = this.tryParseSecretReference(value);

		if (typeof normalizedValue === 'string') {
			throw new Error(
				`Expected a secret reference like "${SECRET_REFERENCE_PREFIX}ENV_VAR${SECRET_REFERENCE_SUFFIX}" but received a plain string.`,
			);
		}

		return normalizedValue;
	}

	private tryParseSecretReference(value: string): StringValue {
		if (
			value.startsWith(SECRET_REFERENCE_PREFIX) &&
			value.endsWith(SECRET_REFERENCE_SUFFIX)
		) {
			const rawReference = value.slice(
				SECRET_REFERENCE_PREFIX.length,
				value.length - SECRET_REFERENCE_SUFFIX.length,
			);
			const trimmedReference = rawReference.trim();

			if (trimmedReference.length === 0) {
				throw new Error('Secret reference must include a key.');
			}

			return {
				kind: 'secret',
				provider: 'environment',
				key: trimmedReference,
			};
		}

		return value;
	}
}

export function createConfigDocumentParser(): ConfigDocumentParser {
	return new StrictConfigDocumentParser();
}
