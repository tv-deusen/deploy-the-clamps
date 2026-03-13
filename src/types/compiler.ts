export type ConfigDocumentKind =
	| 'deployment'
	| 'memory'
	| 'network'
	| 'providers'
	| 'system'
	| 'tools'
	| 'workers';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
		readonly logLevel: LogLevel;
		readonly adminPort: number;
	};
	readonly inference: {
		readonly provider: string;
		readonly baseUrl: StringValue;
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
			readonly guildId: StringValue;
			readonly channelId: StringValue;
			readonly allowedUserIds: readonly StringValue[];
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
	readonly zoneId: StringValue;
	readonly apiToken: SecretReference;
}

export interface OvhProviderConfig {
	readonly baseUrl: string;
	readonly apiKey: SecretReference;
}

export interface ProvidersConfigDocument extends ConfigDocumentBase {
	readonly kind: 'providers';
	readonly vultr?: VultrProviderConfig;
	readonly cloudflare?: CloudflareProviderConfig;
	readonly ovh?: OvhProviderConfig;
}

export interface DeploymentTargetConfig {
	readonly instanceName: string;
	readonly sshUser: string;
	readonly sshPort: number;
}

export interface DeploymentConfigDocument extends ConfigDocumentBase {
	readonly kind: 'deployment';
	readonly name: string;
	readonly environment: string;
	readonly target: DeploymentTargetConfig;
}

export type ConfigDocument =
	| DeploymentConfigDocument
	| MemoryConfigDocument
	| NetworkConfigDocument
	| ProvidersConfigDocument
	| SystemConfigDocument
	| ToolsConfigDocument
	| WorkersConfigDocument;

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
	| 'cloudflare.dns-record'
	| 'docker.compose-stack'
	| 'docker.network'
	| 'host.directory'
	| 'host.file'
	| 'host.package'
	| 'host.systemd-unit'
	| 'integration.discord-binding'
	| 'integration.ovh-binding'
	| 'internal.service-binding'
	| 'vultr.firewall-group'
	| 'vultr.instance';

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
