export type ConfigDocumentVersion = 'v1alpha1';

export type ConfigDocumentKind =
  | 'Deployment'
  | 'ProviderConfig'
  | 'NetworkConfig'
  | 'RuntimeConfig'
  | 'WorkerConfig'
  | 'MemoryConfig'
  | 'ToolConfig'
  | 'SecretConfig';

export interface DocumentMetadata {
  name: string;
  description?: string;
  labels?: Record<string, string>;
}

export interface ConfigDocumentBase {
  apiVersion: ConfigDocumentVersion;
  kind: ConfigDocumentKind;
  metadata: DocumentMetadata;
}

export interface DeploymentConfigDocument extends ConfigDocumentBase {
  kind: 'Deployment';
  spec: DeploymentSpec;
}

export interface ProviderConfigDocument extends ConfigDocumentBase {
  kind: 'ProviderConfig';
  spec: ProviderConfigSpec;
}

export interface NetworkConfigDocument extends ConfigDocumentBase {
  kind: 'NetworkConfig';
  spec: NetworkConfigSpec;
}

export interface RuntimeConfigDocument extends ConfigDocumentBase {
  kind: 'RuntimeConfig';
  spec: RuntimeConfigSpec;
}

export interface WorkerConfigDocument extends ConfigDocumentBase {
  kind: 'WorkerConfig';
  spec: WorkerConfigSpec;
}

export interface MemoryConfigDocument extends ConfigDocumentBase {
  kind: 'MemoryConfig';
  spec: MemoryConfigSpec;
}

export interface ToolConfigDocument extends ConfigDocumentBase {
  kind: 'ToolConfig';
  spec: ToolConfigSpec;
}

export interface SecretConfigDocument extends ConfigDocumentBase {
  kind: 'SecretConfig';
  spec: SecretConfigSpec;
}

export type ConfigDocument =
  | DeploymentConfigDocument
  | ProviderConfigDocument
  | NetworkConfigDocument
  | RuntimeConfigDocument
  | WorkerConfigDocument
  | MemoryConfigDocument
  | ToolConfigDocument
  | SecretConfigDocument;

export interface DeploymentSpec {
  environment: DeploymentEnvironment;
  region: string;
  stack: StackComponentName[];
  providers: DeploymentProviderBindings;
}

export type DeploymentEnvironment = 'development' | 'staging' | 'production';

export interface DeploymentProviderBindings {
  compute: string;
  dns?: string;
  inference?: string;
  messaging?: string;
  secrets?: string;
}

export type StackComponentName =
  | 'openclaw'
  | 'graphiti'
  | 'falkordb'
  | 'caddy'
  | 'discord'
  | 'workers';

export interface ProviderConfigSpec {
  vultr?: VultrProviderConfig;
  cloudflare?: CloudflareProviderConfig;
  ovh?: OvhProviderConfig;
  discord?: DiscordProviderConfig;
  ssh?: SshProviderConfig;
}

export interface VultrProviderConfig {
  apiTokenSecretRef: SecretReference;
  region: string;
  plan: string;
  osId: number;
  enableIpv6: boolean;
  backups: 'enabled' | 'disabled';
  ddosProtection: 'enabled' | 'disabled';
  vpcId?: string;
  firewallGroupName?: string;
  tags?: string[];
}

export interface CloudflareProviderConfig {
  apiTokenSecretRef: SecretReference;
  accountId: string;
  zoneId: string;
  proxiedByDefault: boolean;
}

export interface OvhProviderConfig {
  baseUrl: string;
  apiKeySecretRef: SecretReference;
  defaultTimeoutSeconds: number;
  defaultRetryCount: number;
}

export interface DiscordProviderConfig {
  botTokenSecretRef: SecretReference;
  applicationId: string;
  guildId: string;
  channelId: string;
  allowedUserIds: string[];
  messageContentIntentEnabled: boolean;
}

export interface SshProviderConfig {
  host: string;
  port: number;
  user: string;
  privateKeySecretRef: SecretReference;
  hostKey?: string;
}

export interface NetworkConfigSpec {
  domain?: DomainConfig;
  firewall: FirewallConfig;
  privateNetwork: PrivateNetworkConfig;
  gateway: GatewayConfig;
}

export interface DomainConfig {
  hostname: string;
  recordType: 'A' | 'AAAA' | 'CNAME';
  proxied: boolean;
  ttlSeconds: number;
}

export interface FirewallConfig {
  allowInbound: FirewallRule[];
  allowOutbound?: FirewallRule[];
}

export interface FirewallRule {
  protocol: 'tcp' | 'udp' | 'icmp';
  portRange?: PortRange;
  sourceCidrs?: string[];
  destinationCidrs?: string[];
  description: string;
}

export interface PortRange {
  from: number;
  to: number;
}

export interface PrivateNetworkConfig {
  name: string;
  cidr?: string;
  exposeGraphitiPublicly: boolean;
  exposeFalkorDbPublicly: boolean;
}

export interface GatewayConfig {
  listenAddress: string;
  listenPort: number;
  tlsMode: 'managed' | 'passthrough' | 'disabled';
  allowedSourceCidrs: string[];
}

export interface RuntimeConfigSpec {
  appName: string;
  logLevel: LogLevel;
  admin: AdminInterfaceConfig;
  openClaw: OpenClawRuntimeConfig;
  docker: DockerRuntimeConfig;
  caddy?: CaddyRuntimeConfig;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface AdminInterfaceConfig {
  enabled: boolean;
  bindAddress: string;
  port: number;
}

export interface OpenClawRuntimeConfig {
  enabled: boolean;
  installMethod: 'bun' | 'npm';
  version?: string;
  serviceUser: string;
  workingDirectory: string;
  dataDirectory: string;
  configDirectory: string;
  inference: InferenceBindingConfig;
  discord?: DiscordBindingConfig;
}

export interface InferenceBindingConfig {
  provider: string;
  reasoningModel: string;
  extractionModel?: string;
  embeddingModel?: string;
  timeoutSeconds: number;
  retryCount: number;
}

export interface DiscordBindingConfig {
  enabled: boolean;
  provider: string;
  guildId: string;
  channelId: string;
  allowedUserIds: string[];
  typingIndicator: boolean;
  threadPerSession: boolean;
}

export interface DockerRuntimeConfig {
  enabled: boolean;
  networkName: string;
  composeFilePath: string;
  manageComposeFile: boolean;
}

export interface CaddyRuntimeConfig {
  enabled: boolean;
  configPath: string;
  email?: string;
}

export interface WorkerConfigSpec {
  workers: WorkerDefinition[];
  concurrency: WorkerConcurrencyConfig;
}

export interface WorkerDefinition {
  name: string;
  enabled: boolean;
  entrypoint: string;
  transport: WorkerTransport;
  restartPolicy: RestartPolicy;
  healthCheck?: WorkerHealthCheck;
  resources?: WorkerResourceLimits;
  dependsOn?: string[];
}

export interface WorkerTransport {
  type: 'unix-socket' | 'http';
  socketPath?: string;
  url?: string;
}

export interface RestartPolicy {
  mode: 'always' | 'on-failure' | 'never';
  maxRestarts?: number;
  restartDelayMilliseconds?: number;
}

export interface WorkerHealthCheck {
  enabled: boolean;
  intervalMilliseconds: number;
  timeoutMilliseconds: number;
}

export interface WorkerResourceLimits {
  memoryLimitMegabytes?: number;
  cpuQuotaPercent?: number;
}

export interface WorkerConcurrencyConfig {
  maxConcurrentWorkers: number;
  maxConcurrentTasksPerWorker: number;
}

export interface MemoryConfigSpec {
  graphiti: GraphitiConfig;
  falkorDb: FalkorDbConfig;
  retention: MemoryRetentionConfig;
}

export interface GraphitiConfig {
  enabled: boolean;
  baseUrl: string;
  containerName: string;
  image: string;
  port: number;
  healthCheckIntervalMilliseconds: number;
  extraction: GraphitiExtractionConfig;
  embedding: GraphitiEmbeddingConfig;
}

export interface GraphitiExtractionConfig {
  enabled: boolean;
  model: string;
  batchSize: number;
  intervalSeconds: number;
}

export interface GraphitiEmbeddingConfig {
  enabled: boolean;
  model: string;
  cacheVectors: boolean;
}

export interface FalkorDbConfig {
  enabled: boolean;
  containerName: string;
  image: string;
  port: number;
  volumeName: string;
}

export interface MemoryRetentionConfig {
  defaultTtlDays: number;
  archiveAfterDays: number;
}

export interface ToolConfigSpec {
  tools: ToolDefinition[];
  concurrency: ToolConcurrencyConfig;
}

export interface ToolDefinition {
  name: string;
  enabled: boolean;
  description: string;
  timeoutMilliseconds: number;
  workerDependencyName?: string;
}

export interface ToolConcurrencyConfig {
  maxConcurrentTools: number;
  maxConcurrentToolsPerWorker: number;
  toolCallTimeoutMilliseconds: number;
}

export interface SecretConfigSpec {
  provider: SecretProviderKind;
  secrets: SecretDeclaration[];
}

export type SecretProviderKind = 'environment' | 'file' | 'external';

export interface SecretDeclaration {
  name: string;
  source: SecretReference;
  required: boolean;
}

export interface SecretReference {
  provider: SecretProviderKind;
  key: string;
  version?: string;
}

export interface DeploymentManifest {
  documents: ConfigDocument[];
}

export interface CompiledDeployment {
  deployment: DeploymentSpec;
  providers: ProviderConfigSpec;
  network: NetworkConfigSpec;
  runtime: RuntimeConfigSpec;
  workers: WorkerConfigSpec;
  memory: MemoryConfigSpec;
  tools: ToolConfigSpec;
  secrets?: SecretConfigSpec;
}

export type ResourceProviderKind =
  | 'vultr'
  | 'cloudflare'
  | 'host'
  | 'docker'
  | 'ovh'
  | 'discord';

export type ResourceKind =
  | 'vultr-instance'
  | 'vultr-firewall-group'
  | 'cloudflare-dns-record'
  | 'host-directory'
  | 'host-file'
  | 'systemd-unit'
  | 'docker-network'
  | 'docker-volume'
  | 'docker-container'
  | 'docker-compose-stack'
  | 'health-check'
  | 'integration-binding';

export interface ResourceIdentifier {
  provider: ResourceProviderKind;
  kind: ResourceKind;
  name: string;
}

export interface ResourceDefinition<TDesired> {
  id: ResourceIdentifier;
  desired: TDesired;
  dependsOn: ResourceIdentifier[];
  sensitiveFields?: string[];
}

export interface PlanAction<TDesired = unknown> {
  resource: ResourceIdentifier;
  action: PlanActionKind;
  desired?: TDesired;
  reason: string;
  disruptive: boolean;
}

export type PlanActionKind =
  | 'create'
  | 'update'
  | 'replace'
  | 'delete'
  | 'noop';

export interface DeploymentPlan {
  actions: PlanAction[];
  createdAt: string;
  configDigest: string;
}

export interface ProviderApplyResult {
  resource: ResourceIdentifier;
  action: Exclude<PlanActionKind, 'noop'>;
  providerId?: string;
  outputs?: Record<string, string>;
}

export interface ResourceStateRecord {
  resource: ResourceIdentifier;
  providerId?: string;
  observedHash: string;
  outputs: Record<string, string>;
  lastAppliedAt: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  operation: 'validate' | 'plan' | 'apply';
  environment: DeploymentEnvironment;
  configDigest: string;
  summary: string;
}
