import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import type {
	ConfigDocument,
	ConfigDocumentParser,
	ParsedDocumentResult,
	RawYamlDocument,
	SecretReference,
} from '../types/compiler.ts';
const secretReferenceSchema = z
	.object({
		kind: z.literal('secret'),
		provider: z.string().min(1),
		key: z.string().min(1),
	})
	.strict();

const secretOrStringSchema = z.union([z.string(), secretReferenceSchema]);

const configDocumentBaseSchema = z.object({
	version: z.string().min(1),
});

const gwPort = 3000;
const systemConfigSchema = configDocumentBaseSchema
	.extend({
		kind: z.literal('system'),
		app: z.object({
			name: z.string().min(1),
			environment: z.string().min(1),
			logLevel: z.enum(['debug', 'info', 'warn', 'error']),
			adminPort: z.number().int().positive(),
			gatewayHost: z.string().min(1).default('127.0.0.1'),
			gatewayPort: z.number().int().positive().default(gwPort),
		}),
		inference: z.object({
			provider: z.string().min(1),
			baseUrl: secretOrStringSchema,
			apiKey: secretReferenceSchema,
			timeoutSeconds: z.number().int().positive(),
			retryCount: z.number().int().nonnegative(),
			models: z.object({
				reasoning: z.string().min(1),
				extraction: z.string().min(1),
				embedding: z.string().min(1),
			}),
		}),
		integrations: z
			.object({
				discord: z
					.object({
						enabled: z.boolean(),
						botToken: secretReferenceSchema,
						guildId: secretOrStringSchema,
						channelId: secretOrStringSchema,
						allowedUserIds: z.array(secretOrStringSchema),
					})
					.optional(),
			})
			.default({}),
	})
	.strict();

const toolsConfigSchema = configDocumentBaseSchema
	.extend({
		kind: z.literal('tools'),
		tools: z.array(
			z
				.object({
					name: z.string().min(1),
					enabled: z.boolean(),
					description: z.string().min(1),
					timeoutMs: z.number().int().positive(),
					workerDependency: z.string().min(1).optional(),
				})
				.strict(),
		),
		concurrency: z
			.object({
				maxConcurrentTools: z.number().int().positive(),
				maxPerWorker: z.number().int().positive(),
				toolCallTimeoutMs: z.number().int().positive(),
			})
			.strict(),
	})
	.strict();

const workersConfigSchema = configDocumentBaseSchema
	.extend({
		kind: z.literal('workers'),
		workers: z.array(
			z
				.object({
					name: z.string().min(1),
					enabled: z.boolean(),
					script: z.string().min(1),
					socket: z.string().min(1),
					restartPolicy: z.enum(['always', 'on-failure', 'never']),
					maxRestarts: z.number().int().nonnegative(),
					restartDelayMs: z.number().int().nonnegative(),
					healthCheck: z
						.object({
							enabled: z.boolean(),
							intervalMs: z.number().int().positive(),
							timeoutMs: z.number().int().positive(),
						})
						.strict()
						.optional(),
					resources: z
						.object({
							memoryLimitMb: z
								.number()
								.int()
								.positive()
								.optional(),
							cpuQuotaPercent: z
								.number()
								.int()
								.positive()
								.optional(),
						})
						.strict()
						.optional(),
				})
				.strict(),
		),
	})
	.strict();

const memoryConfigSchema = configDocumentBaseSchema
	.extend({
		kind: z.literal('memory'),
		graphiti: z
			.object({
				enabled: z.boolean(),
				url: z.string().min(1),
				healthCheckIntervalMs: z.number().int().positive(),
				extraction: z
					.object({
						enabled: z.boolean(),
						model: z.string().min(1),
						batchSize: z.number().int().positive(),
						extractionIntervalSeconds: z.number().int().positive(),
					})
					.strict()
					.optional(),
				embedding: z
					.object({
						enabled: z.boolean(),
						model: z.string().min(1),
						cacheVectors: z.boolean(),
					})
					.strict()
					.optional(),
				retention: z
					.object({
						defaultTtlDays: z.number().int().positive(),
						archiveAfterDays: z.number().int().positive(),
					})
					.strict()
					.optional(),
			})
			.strict(),
		docker: z
			.object({
				composeFile: z.string().min(1),
				graphitiContainer: z.string().min(1),
				falkordbContainer: z.string().min(1),
				network: z.string().min(1),
			})
			.strict()
			.optional(),
	})
	.strict();

const networkConfigSchema = configDocumentBaseSchema
	.extend({
		kind: z.literal('network'),
		dns: z
			.object({
				provider: z.string().min(1),
				zone: z.string().min(1),
				records: z.array(
					z
						.object({
							name: z.string().min(1),
							type: z.enum(['A', 'AAAA', 'CNAME', 'TXT']),
							ttl: z.number().int().positive(),
							proxied: z.boolean().optional(),
							target: z.string().min(1),
						})
						.strict(),
				),
			})
			.strict()
			.optional(),
		firewall: z
			.object({
				provider: z.string().min(1),
				inboundRules: z.array(
					z
						.object({
							protocol: z.enum(['tcp', 'udp']),
							port: z.number().int().positive(),
							source: z.string().min(1),
							description: z.string().min(1),
						})
						.strict(),
				),
			})
			.strict()
			.optional(),
	})
	.strict();

const tunnelConfigSchema = configDocumentBaseSchema
	.extend({
		kind: z.literal('tunnel'),
		provider: z.string().min(1),
		name: z.string().min(1),
		hostname: z.string().min(1),
		service: z
			.object({
				target: z
					.enum(['openclaw-gateway', 'url'])
					.default('openclaw-gateway'),
				url: z.string().min(1).optional(),
			})
			.strict()
			.default({
				target: 'openclaw-gateway',
			}),
		access: z
			.object({
				enabled: z.boolean().default(true),
				applicationName: z.string().min(1),
				policyName: z.string().min(1),
				allowedEmails: z.array(z.string().email()).min(1),
				sessionDuration: z.string().min(1).default('24h'),
			})
			.strict(),
		systemd: z
			.object({
				unitName: z.string().min(1).default('cloudflared.service'),
				configPath: z
					.string()
					.min(1)
					.default('/etc/cloudflared/config.yml'),
			})
			.strict()
			.default({
				unitName: 'cloudflared.service',
				configPath: '/etc/cloudflared/config.yml',
			}),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.service.target === 'url' && !value.service.url) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					'tunnel.service.url is required when service.target is "url".',
				path: ['service', 'url'],
			});
		}
	});

const providersConfigSchema = configDocumentBaseSchema
	.extend({
		kind: z.literal('providers'),
		vultr: z
			.object({
				region: z.string().min(1),
				plan: z.string().min(1),
				image: z.string().min(1),
				hostname: z.string().min(1),
				apiToken: secretReferenceSchema,
			})
			.strict()
			.optional(),
		cloudflare: z
			.object({
				accountId: secretOrStringSchema,
				zoneId: secretOrStringSchema,
				apiToken: secretReferenceSchema,
			})
			.strict()
			.optional(),
		ovh: z
			.object({
				baseUrl: z.string().min(1),
				apiKey: secretReferenceSchema,
			})
			.strict()
			.optional(),
	})
	.strict();

const deploymentConfigSchema = configDocumentBaseSchema
	.extend({
		kind: z.literal('deployment'),
		name: z.string().min(1),
		environment: z.string().min(1),
		target: z
			.object({
				instanceName: z.string().min(1),
				sshUser: z.string().min(1),
				sshPort: z.number().int().positive(),
			})
			.strict(),
	})
	.strict();

const documentKindSchema = z
	.object({
		kind: z.enum([
			'system',
			'tools',
			'workers',
			'memory',
			'network',
			'tunnel',
			'providers',
			'deployment',
		]),
	})
	.passthrough();

export class ZodConfigDocumentParser implements ConfigDocumentParser {
	public parseDocument(input: RawYamlDocument): ParsedDocumentResult {
		return {
			document: parseConfigDocument({
				sourcePath: input.sourcePath,
				value: input.parsedValue,
			}),
			warnings: [],
		};
	}
}

type ParsedConfigDocument = {
	readonly sourcePath: string;
	readonly value: unknown;
};

export function parseConfigDocument(
	input: ParsedConfigDocument,
): ConfigDocument {
	const parsedYaml = parseYamlDocument(input);
	const parsedDocument = parseDocumentByKind(parsedYaml);

	return addSourcePath(parsedDocument, input.sourcePath);
}

function parseYamlDocument(input: ParsedConfigDocument): unknown {
	if (typeof input.value !== 'string') {
		return input.value;
	}

	return parseYaml(input.value);
}

function addSourcePath(
	document: ConfigDocumentWithoutSourcePath,
	sourcePath: string,
): ConfigDocument {
	return {
		...document,
		sourcePath,
	} as ConfigDocument;
}

type ConfigDocumentWithoutSourcePath =
	| Omit<z.infer<typeof systemConfigSchema>, 'sourcePath'>
	| Omit<z.infer<typeof toolsConfigSchema>, 'sourcePath'>
	| Omit<z.infer<typeof workersConfigSchema>, 'sourcePath'>
	| Omit<z.infer<typeof memoryConfigSchema>, 'sourcePath'>
	| Omit<z.infer<typeof networkConfigSchema>, 'sourcePath'>
	| Omit<z.infer<typeof tunnelConfigSchema>, 'sourcePath'>
	| Omit<z.infer<typeof providersConfigSchema>, 'sourcePath'>
	| Omit<z.infer<typeof deploymentConfigSchema>, 'sourcePath'>;

function parseDocumentByKind(value: unknown): ConfigDocumentWithoutSourcePath {
	const { kind } = documentKindSchema.parse(value);

	switch (kind) {
		case 'system':
			return systemConfigSchema.parse(value);
		case 'tools':
			return toolsConfigSchema.parse(value);
		case 'workers':
			return workersConfigSchema.parse(value);
		case 'memory':
			return memoryConfigSchema.parse(value);
		case 'network':
			return networkConfigSchema.parse(value);
		case 'tunnel':
			return tunnelConfigSchema.parse(value);
		case 'providers':
			return providersConfigSchema.parse(value);
		case 'deployment':
			return deploymentConfigSchema.parse(value);
	}
}

export function isSecretReference(value: unknown): value is SecretReference {
	return secretReferenceSchema.safeParse(value).success;
}
