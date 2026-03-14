export type ConfigDocumentKind =
	| 'system'
	| 'tools'
	| 'workers'
	| 'memory'
	| 'network'
	| 'tunnel'
	| 'providers'
	| 'deployment';

export interface ConfigDocumentBase {
	readonly kind: ConfigDocumentKind;
	readonly version: string;
	readonly sourcePath: string;
}

export interface SecretReference {
	readonly kind: 'secret';
	readonly provider: string;
	readonly key: string;
}

export type StringValue = string | SecretReference;

export interface SystemConfigDocument extends ConfigDocumentBase {
	readonly kind: 'system';
	readonly app: {
		readonly name: string;
		readonly environment: string;
		readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
		readonly adminPort: number;
		readonly gatewayHost: string;
		readonly gatewayPort: number;
	};
	readonly inference: {
		readonly provider: string;
		readonly baseUrl: string | SecretReference;
		readonly apiKey: SecretReference;
		readonly timeoutSeconds: number;
		readonly retryCount: number;
		readonly models: {
			readonly reasoning: string;
			readonly extraction: string;
			readonly embedding: string;
		};
	};
	readonly integrations: {
		readonly discord?: {
			readonly enabled: boolean;
			readonly botToken: SecretReference;
			readonly guildId: string | SecretReference;
			readonly channelId: string | SecretReference;
			readonly allowedUserIds: readonly (string | SecretReference)[];
			readonly typingIndicator?: boolean;
			readonly threadPerSession?: boolean;
		};
	};
}

export interface ToolDefinitionConfig {
	readonly name: string;
	readonly enabled: boolean;
	readonly description: string;
	readonly timeoutMs: number;
	readonly workerDependency?: string;
}

export interface ToolsConfigDocument extends ConfigDocumentBase {
	readonly kind: 'tools';
	readonly tools: readonly ToolDefinitionConfig[];
	readonly concurrency: {
		readonly maxConcurrentTools: number;
		readonly maxPerWorker: number;
		readonly toolCallTimeoutMs: number;
	};
}

export interface WorkerHealthCheckConfig {
	readonly enabled: boolean;
	readonly intervalMs: number;
	readonly timeoutMs: number;
}

export interface WorkerResourcesConfig {
	readonly memoryLimitMb?: number;
	readonly cpuQuotaPercent?: number;
}

export interface WorkerConfig {
	readonly name: string;
	readonly enabled: boolean;
	readonly script: string;
	readonly socket: string;
	readonly restartPolicy: 'always' | 'on-failure' | 'never';
	readonly maxRestarts: number;
	readonly restartDelayMs: number;
	readonly healthCheck?: WorkerHealthCheckConfig;
	readonly resources?: WorkerResourcesConfig;
}

export interface WorkersConfigDocument extends ConfigDocumentBase {
	readonly kind: 'workers';
	readonly workers: readonly WorkerConfig[];
}

export interface GraphitiExtractionConfig {
	readonly enabled: boolean;
	readonly model: string;
	readonly batchSize: number;
	readonly extractionIntervalSeconds: number;
}

export interface GraphitiEmbeddingConfig {
	readonly enabled: boolean;
	readonly model: string;
	readonly cacheVectors: boolean;
}

export interface MemoryRetentionConfig {
	readonly defaultTtlDays: number;
	readonly archiveAfterDays: number;
}

export interface MemoryConfigDocument extends ConfigDocumentBase {
	readonly kind: 'memory';
	readonly graphiti: {
		readonly enabled: boolean;
		readonly url: string;
		readonly healthCheckIntervalMs: number;
		readonly extraction?: GraphitiExtractionConfig;
		readonly embedding?: GraphitiEmbeddingConfig;
		readonly retention?: MemoryRetentionConfig;
	};
	readonly docker?: {
		readonly composeFile: string;
		readonly graphitiContainer: string;
		readonly falkordbContainer: string;
		readonly network: string;
	};
}

export interface DnsRecordConfig {
	readonly name: string;
	readonly type: 'A' | 'AAAA' | 'CNAME' | 'TXT';
	readonly ttl: number;
	readonly proxied?: boolean;
	readonly target: string;
}

export interface FirewallRuleConfig {
	readonly protocol: 'tcp' | 'udp';
	readonly port: number;
	readonly source: string;
	readonly description: string;
}

export interface NetworkConfigDocument extends ConfigDocumentBase {
	readonly kind: 'network';
	readonly dns?: {
		readonly provider: string;
		readonly zone: string;
		readonly records: readonly DnsRecordConfig[];
	};
	readonly firewall?: {
		readonly provider: string;
		readonly inboundRules: readonly FirewallRuleConfig[];
	};
}

export interface VultrProviderConfig {
	readonly region: string;
	readonly plan: string;
	readonly image: string;
	readonly hostname: string;
	readonly apiToken: SecretReference;
	readonly enableIpv6?: boolean;
	readonly backups?: 'enabled' | 'disabled';
	readonly ddosProtection?: 'enabled' | 'disabled';
	readonly tags?: readonly string[];
}

export interface CloudflareProviderConfig {
	readonly accountId: StringValue;
	readonly zoneId: StringValue;
	readonly apiToken: SecretReference;
}

export interface OvhProviderConfig {
	readonly baseUrl: string;
	readonly apiKey: SecretReference;
}

export interface DeploymentTargetConfig {
	readonly instanceName: string;
	readonly sshUser: string;
	readonly sshPort: number;
}

export interface TunnelConfigDocument extends ConfigDocumentBase {
	readonly kind: 'tunnel';
	readonly provider: string;
	readonly name: string;
	readonly hostname: string;
	readonly service: {
		readonly target: 'openclaw-gateway' | 'url';
		readonly url?: string;
	};
	readonly access: {
		readonly enabled: boolean;
		readonly applicationName: string;
		readonly policyName: string;
		readonly allowedEmails: readonly string[];
		readonly sessionDuration: string;
	};
	readonly systemd: {
		readonly unitName: string;
		readonly configPath: string;
	};
}

export interface ProvidersConfigDocument extends ConfigDocumentBase {
	readonly kind: 'providers';
	readonly vultr?: {
		readonly region: string;
		readonly plan: string;
		readonly image: string;
		readonly hostname: string;
		readonly apiToken: SecretReference;
	};
	readonly cloudflare?: {
		readonly accountId: string | SecretReference;
		readonly zoneId: string | SecretReference;
		readonly apiToken: SecretReference;
	};
	readonly ovh?: {
		readonly baseUrl: string;
		readonly apiKey: SecretReference;
	};
}

export interface DeploymentConfigDocument extends ConfigDocumentBase {
	readonly kind: 'deployment';
	readonly name: string;
	readonly environment: string;
	readonly target: DeploymentTargetConfig;
}

export type ConfigDocument =
	| SystemConfigDocument
	| ToolsConfigDocument
	| WorkersConfigDocument
	| MemoryConfigDocument
	| NetworkConfigDocument
	| TunnelConfigDocument
	| ProvidersConfigDocument
	| DeploymentConfigDocument;

export interface LoadedConfig {
	readonly documents: readonly ConfigDocument[];
	readonly documentsByKind: ReadonlyMap<
		ConfigDocumentKind,
		readonly ConfigDocument[]
	>;
	readonly warnings: readonly CompileWarning[];
}

export type ResourceProviderKind =
	| 'cloudflare'
	| 'discord'
	| 'docker'
	| 'host'
	| 'internal'
	| 'ovh'
	| 'vultr';

export type ResourceType =
	| 'vultr.instance'
	| 'vultr.firewall-group'
	| 'cloudflare.dns-record'
	| 'cloudflare.tunnel'
	| 'cloudflare.access-application'
	| 'cloudflare.access-policy'
	| 'host.file'
	| 'host.directory'
	| 'host.systemd-unit'
	| 'host.package'
	| 'docker.network'
	| 'docker.compose-stack'
	| 'integration.ovh-binding'
	| 'integration.discord-binding'
	| 'internal.service-binding';

export interface ResourceLifecycle {
	readonly preventDestroy?: boolean;
	readonly replaceOnChanges?: readonly string[];
	readonly createBeforeDestroy?: boolean;
}

export interface ResourceDefinition<TDesired = unknown> {
	readonly id: string;
	readonly type: ResourceType;
	readonly name: string;
	readonly provider: ResourceProviderKind;
	readonly desired: TDesired;
	readonly dependsOn: readonly string[];
	readonly lifecycle?: ResourceLifecycle;
	readonly tags?: Readonly<Record<string, string>>;
}

export interface CompileWarning {
	readonly code: string;
	readonly message: string;
	readonly sourcePath?: string;
}

export interface CompileError {
	readonly code: string;
	readonly message: string;
	readonly sourcePath?: string;
}

export interface ValidationIssue {
	readonly code: string;
	readonly message: string;
	readonly severity: 'error' | 'warning';
	readonly documentKind?: ConfigDocumentKind;
	readonly sourcePath?: string;
}

export interface ConfigValidationResult {
	readonly issues: readonly ValidationIssue[];
	readonly errors: readonly ValidationIssue[];
	readonly warnings: readonly ValidationIssue[];
}

export interface ResourceGraph {
	readonly resources: readonly ResourceDefinition[];
	readonly resourceIds: ReadonlySet<string>;
}

export interface DeploymentMetadata {
	readonly name: string;
	readonly environment: string;
	readonly generatedAt: string;
	readonly configVersion: string;
}

export interface CompileResult {
	readonly deployment: DeploymentMetadata;
	readonly graph: ResourceGraph;
	readonly warnings: readonly CompileWarning[];
}

export interface CompilerContext {
	readonly loadedConfig: LoadedConfig;
	readonly now: Date;
}

export interface ConfigCompiler {
	compile(context: CompilerContext): CompileResult;
}

export interface ConfigValidator {
	validate(loadedConfig: LoadedConfig): ConfigValidationResult;
}

export interface RawYamlDocument {
	readonly sourcePath: string;
	readonly parsedValue: unknown;
}

export interface ParsedDocumentResult {
	readonly document: ConfigDocument;
	readonly warnings: readonly CompileWarning[];
}

export interface ConfigDocumentParser {
	parseDocument(input: RawYamlDocument): ParsedDocumentResult;
}
