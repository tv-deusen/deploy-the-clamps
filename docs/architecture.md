# Deployment Controller Architecture and TypeScript Interface Design

## Purpose

This document defines the architecture for a declarative deployment controller that reads YAML configuration and produces correctly configured, connected, and verified infrastructure and services across their target cloud platforms and host environments.

The system is designed for:

- extensibility across providers and resource kinds
- strong validation at trust boundaries
- idempotent planning and apply behavior
- auditable deployment history
- secure secret handling
- implementation in TypeScript on the Bun runtime

---

## Goals

- Treat YAML as the source of truth for deployment intent.
- Validate configuration before any side effects occur.
- Compile high-level configuration into a normalized internal representation.
- Produce deterministic plans by comparing desired state with discovered state.
- Apply resources in dependency order with health verification.
- Keep provider integrations replaceable and narrowly scoped.
- Ensure secret material is never logged or persisted in plain state.
- Support future expansion to additional clouds, services, and secret backends.

## Non-goals

- Replacing Terraform, Pulumi, or Kubernetes for all workloads.
- Supporting arbitrary imperative provisioning logic inside config files.
- Managing every external third-party service directly from day one.
- Building a full workflow engine in the first version.

---

## Architectural Principles

### Declarative-first
The user declares desired state in YAML. The engine computes the actions required to reach that state.

### Compiler and reconciler model
The system behaves like a compiler followed by a reconciler:

1. load configuration
2. validate configuration
3. compile configuration into internal resources
4. discover current state
5. compute a plan
6. apply changes
7. verify resulting state

### Explicit trust boundaries
All external input is validated at the boundary:

- YAML files
- environment variables
- secret backends
- provider API responses
- host command output
- remote service health responses

### Narrow interfaces
Provider implementations expose a small, predictable contract. The planner and compiler operate on internal types rather than provider-specific response shapes.

### Idempotency
Repeated `apply` operations against unchanged input should converge to no-op behavior.

### Security by default
Secrets are resolved as late as practical, redacted in output, and excluded from state persistence. Public exposure is explicit, not incidental.

---

## System Overview

The deployment controller is composed of the following major subsystems:

- CLI
- configuration loader
- schema and semantic validator
- compiler
- dependency graph
- provider adapters
- planner
- apply executor
- renderer layer
- state store
- secret resolver
- health verification
- structured logging and audit trail

### High-level flow

1. The CLI reads a deployment root.
2. The loader parses YAML documents and environment overlays.
3. Structural schemas validate each document.
4. Semantic validation checks cross-document references and invariants.
5. The compiler produces a normalized deployment model and resource graph.
6. Providers discover actual state.
7. The planner computes create, update, replace, delete, or no-op actions.
8. The executor applies actions in dependency order.
9. Health checks confirm service and integration readiness.
10. State and audit records are persisted.

---

## Runtime Context

Initial target environment:

- Bun runtime
- TypeScript codebase
- Vultr for compute and firewall resources
- Cloudflare for DNS
- Ubuntu host for runtime provisioning
- Docker for Graphiti and FalkorDB
- systemd for OpenClaw and worker lifecycles
- OVH AI Endpoints for inference and embeddings
- Discord for messaging integration

---

## Layered Architecture

## 1. CLI Layer

The CLI is the user-facing entrypoint.

### Responsibilities

- parse command-line arguments
- load project paths and environment selection
- invoke validation, plan, apply, and diagnostics workflows
- present redacted summaries and diffs
- manage confirmation prompts for risky actions

### Initial commands

- `validate`
- `plan`
- `apply`
- `doctor`
- `render`
- `state show`

---

## 2. Configuration Layer

This layer discovers and parses YAML configuration files.

### Responsibilities

- file discovery
- YAML parsing
- config document classification
- interpolation of non-secret variables where appropriate
- secret reference capture without immediate expansion
- version compatibility checks

### Design notes

Config remains human-oriented and domain-oriented. Multiple YAML files are allowed, but the loader outputs a single normalized set of raw documents.

### Example document families

- system configuration
- provider configuration
- network configuration
- memory configuration
- worker configuration
- tool configuration
- exposure and routing configuration

---

## 3. Validation Layer

Validation occurs in two passes.

### Structural validation

Each document is validated against a runtime schema. Unknown fields are rejected unless explicitly allowed.

### Semantic validation

Cross-document and cross-resource rules are validated after structural parsing.

### Example semantic rules

- referenced providers exist
- referenced workers exist
- secret references resolve to supported backends
- public DNS records target defined endpoints
- firewall rules align with exposed services
- worker dependencies point to enabled workers
- ports do not conflict
- resource names are unique within scope
- circular dependencies are forbidden
- disabled features do not require active resources

---

## 4. Compiler Layer

The compiler transforms validated config into a normalized internal representation called the deployment model.

### Responsibilities

- normalize config defaults
- derive implicit resources
- compute dependency edges
- split logical config into provider-specific resources
- attach lifecycle and health policies
- create renderer inputs

### Why this matters

This is the key extensibility layer. YAML documents should not be tightly coupled to individual provider APIs. The compiler converts user intent into stable internal resource definitions.

---

## 5. Dependency Graph

The deployment model is represented as a directed acyclic graph of resources and generated artifacts.

### Node examples

- Vultr instance
- Vultr firewall group
- Cloudflare DNS record
- host directory
- host file
- Docker network
- Docker volume
- Docker Compose stack
- systemd unit
- OpenClaw runtime config
- Graphiti service
- FalkorDB service

### Edge examples

- instance depends on provider credentials
- firewall attachment depends on instance creation
- DNS record depends on instance public IP
- host config files depend on compiled templates
- systemd units depend on uploaded files
- OpenClaw depends on Graphiti availability when memory is enabled
- Graphiti depends on FalkorDB and OVH configuration
- public route depends on service health

---

## 6. Provider Layer

Providers are the only subsystem allowed to know the details of external APIs and host operations.

### Initial providers

- Vultr provider
- Cloudflare provider
- Host provider
- Docker-capable host operations inside the host provider
- optional OVH connectivity validator
- optional Discord configuration validator

### Provider responsibilities

- validate provider-specific config
- discover actual state
- compute provider-specific diffs where needed
- execute create, update, replace, and delete actions
- return normalized outputs and errors

---

## 7. Planner Layer

The planner compares desired state with discovered state and produces an ordered plan.

### Responsibilities

- map desired resources to discovered resources
- classify action type
- mark disruptive operations
- attach reason and dependency metadata
- produce a stable textual and machine-readable plan

### Action types

- `create`
- `update`
- `replace`
- `delete`
- `noop`

---

## 8. Executor Layer

The executor applies plan actions in dependency order and records outcomes.

### Responsibilities

- enforce ordering constraints
- apply retries and backoff for transient failures
- stop on hard failure unless a strategy says otherwise
- surface actionable error context
- emit structured deployment events

### Execution policy

The first version should favor clear sequential stage boundaries over maximum concurrency. Safe parallelism can be introduced later for independent resources.

---

## 9. Renderer Layer

Renderers convert internal resource definitions into concrete artifacts.

### Initial outputs

- systemd unit files
- environment files
- Docker Compose files
- service configuration files
- Caddy configuration

### Design rule

Renderers are pure functions from typed input to file content. They should not perform I/O.

---

## 10. State and Audit Layer

This layer persists non-secret state and deployment history.

### Storage choice

Use SQLite through Bun for local state persistence.

### State responsibilities

- store deployment snapshots
- store resource identity mapping
- store hashes of rendered artifacts
- store non-secret outputs
- support drift and change comparisons

### Audit responsibilities

- record who ran a deployment
- record config digest
- record plan digest
- record changed resources
- record timestamps and final status

---

## 11. Secret Resolution Layer

Secrets are resolved by dedicated backends instead of being treated as ordinary strings.

### Initial backend

- environment variables

### Future backends

- 1Password
- Vault
- SOPS-backed file resolution

### Rules

- secret references are validated structurally
- raw secret values are resolved only when required
- secret values are redacted from logs, plans, and state
- secret writes to disk use restrictive permissions

---

## 12. Health Verification Layer

Health verification happens during and after apply.

### Checks include

- host reachability
- Docker service health
- systemd unit active state
- Graphiti HTTP readiness
- FalkorDB readiness
- OpenClaw admin or gateway readiness
- DNS record propagation check where useful
- outbound integration checks for OVH and Discord where safe

---

## Data Flow

## Input flow

1. user invokes CLI
2. deployment root is scanned
3. YAML is parsed into raw documents
4. schemas create typed config models
5. semantic validation creates a validated configuration set

## Compilation flow

1. validated configuration enters compiler
2. compiler emits deployment model
3. deployment model emits resource graph and renderer inputs

## Reconciliation flow

1. providers discover actual state
2. planner compares actual state against desired resources
3. planner emits an execution plan

## Apply flow

1. executor walks plan
2. providers execute actions
3. health layer verifies results
4. state and audit layers persist outcomes

---

## Security Model

## Secrets

Secrets must not be embedded directly in committed configuration. Configuration should support secret references instead of plain values whenever a field is sensitive.

### Secret reference examples

- environment variable reference
- named backend reference
- host-injected reference for runtime-only expansion

### Secret handling rules

- never include raw secrets in logs
- never include raw secrets in state snapshots
- redact secrets in exceptions where possible
- prefer runtime environment files with strict file permissions
- keep provider tokens narrowly scoped

## Least privilege

Provider credentials should be scoped to only required operations:

- Cloudflare token limited to relevant zone DNS actions
- Vultr token limited to required instance and firewall operations
- OVH token limited to inference access
- deployment SSH key separate from general administration keys

## Transport security

Host connections should use SSH with host verification. The design should allow future transport abstractions without changing planner semantics.

## Change safety

Potentially destructive actions should be labeled and require explicit confirmation in interactive use.

---

## Extensibility Strategy

## Provider extensibility

A new provider should be addable by implementing provider contracts and registering supported resource kinds.

## Resource extensibility

The deployment model should allow new resource kinds without changing unrelated parts of the system. New resources should define:

- a stable type identifier
- desired state shape
- identity rules
- outputs
- health behavior
- diff behavior where needed

## Schema versioning

Each config family should include a version marker. New versions should either be migrated during load or rejected with a clear upgrade path.

## Secret backend extensibility

Secret backends should be pluggable through a small interface so the rest of the system remains backend-agnostic.

---

## Failure Model

Failures are categorized to support clearer behavior:

- validation failure
- compilation failure
- discovery failure
- planning failure
- apply failure
- post-apply health failure

### Handling policy

- validation and compilation failures stop immediately
- discovery failures stop unless explicitly marked partial-safe
- apply failures stop the deployment and preserve partial progress in audit history
- health failures are surfaced distinctly from apply failures
- errors preserve context and resource identity

---

## Recommended Repository Structure

```text
dt-clamps/
  docs/
    architecture.md
  src/
    cli/
    config/
    compiler/
    planner/
    providers/
      cloudflare/
      host/
      vultr/
    renderers/
    secrets/
    state/
    types/
    index.ts
  package.json
  tsconfig.json
  biome.json
```

This structure keeps concerns separate without fragmenting the codebase into unnecessary micro-modules.

---

## TypeScript Interface Design

The following interfaces define the intended internal contracts for the first version of the system.

## Core result and error types

```ts
export type Result<Value, ErrorValue> =
	| { ok: true; value: Value }
	| { ok: false; error: ErrorValue };

export interface Diagnostic {
	readonly code: string;
	readonly message: string;
	readonly severity: 'error' | 'warning';
	readonly path?: string;
	readonly detail?: string;
}

export class DomainError extends Error {
	public readonly code: string;
	public readonly causeValue?: unknown;

	public constructor(code: string, message: string, causeValue?: unknown) {
		super(message);
		this.name = 'DomainError';
		this.code = code;
		this.causeValue = causeValue;
	}
}
```

## Configuration model

```ts
export interface DeploymentConfigSet {
	readonly deploymentName: string;
	readonly environmentName: string;
	readonly documents: readonly ConfigDocument[];
	readonly providers: readonly ProviderConfig[];
	readonly services: readonly ServiceConfig[];
	readonly workers: readonly WorkerConfig[];
	readonly network: NetworkConfig | null;
	readonly memory: MemoryConfig | null;
}

export interface ConfigDocument {
	readonly kind: string;
	readonly version: string;
	readonly sourcePath: string;
	readonly rawValue: unknown;
}

export interface ProviderConfig {
	readonly name: string;
	readonly kind: ProviderKind;
	readonly options: Record<string, unknown>;
}

export type ProviderKind =
	| 'vultr'
	| 'cloudflare'
	| 'host'
	| 'ovh'
	| 'discord';

export interface ServiceConfig {
	readonly name: string;
	readonly kind: ServiceKind;
	readonly enabled: boolean;
	readonly settings: Record<string, unknown>;
	readonly dependsOn: readonly string[];
}

export type ServiceKind =
	| 'openclaw'
	| 'graphiti'
	| 'falkordb'
	| 'caddy';

export interface WorkerConfig {
	readonly name: string;
	readonly enabled: boolean;
	readonly scriptPath: string;
	readonly socketPath: string | null;
	readonly resourcePolicy: WorkerResourcePolicy | null;
}

export interface WorkerResourcePolicy {
	readonly memoryLimitMegabytes: number | null;
	readonly cpuQuotaPercent: number | null;
}

export interface NetworkConfig {
	readonly publicHostnames: readonly PublicHostnameConfig[];
	readonly firewallRules: readonly FirewallRuleConfig[];
}

export interface PublicHostnameConfig {
	readonly hostname: string;
	readonly target: HostnameTarget;
}

export type HostnameTarget =
	| { readonly type: 'instance-public-ip'; readonly instanceName: string }
	| { readonly type: 'literal-ip'; readonly ipAddress: string };

export interface FirewallRuleConfig {
	readonly name: string;
	readonly protocol: 'tcp' | 'udp';
	readonly portRange: string;
	readonly sourceRanges: readonly string[];
	readonly targetInstanceName: string;
}

export interface MemoryConfig {
	readonly enabled: boolean;
	readonly graphitiUrl: string | null;
	readonly providerModelNames: MemoryModelNames;
}

export interface MemoryModelNames {
	readonly extractionModel: string | null;
	readonly embeddingModel: string | null;
}
```

## Secret references

```ts
export type SecretReference =
	| {
			readonly type: 'environment';
			readonly variableName: string;
	  }
	| {
			readonly type: 'inline';
			readonly value: string;
	  };

export interface SecretResolver {
	public readonly kind: string;
	resolve(reference: SecretReference): Promise<string>;
}
```

The `inline` variant may exist for testing or controlled local development, but production guidance should discourage it.

## Deployment model and resource graph

```ts
export interface DeploymentModel {
	readonly metadata: DeploymentMetadata;
	readonly resources: readonly ResourceDefinition[];
	readonly generatedArtifacts: readonly GeneratedArtifact[];
}

export interface DeploymentMetadata {
	readonly deploymentName: string;
	readonly environmentName: string;
	readonly configDigest: string;
	readonly createdAtIso: string;
}

export interface ResourceDefinition {
	readonly id: ResourceId;
	readonly kind: ResourceKind;
	readonly providerKind: ProviderKind;
	readonly desiredState: unknown;
	readonly dependencies: readonly ResourceId[];
	readonly lifecycle: ResourceLifecycle;
	readonly healthCheck: HealthCheckDefinition | null;
}

export type ResourceId = string;

export type ResourceKind =
	| 'vultr-instance'
	| 'vultr-firewall-group'
	| 'cloudflare-dns-record'
	| 'host-directory'
	| 'host-file'
	| 'docker-network'
	| 'docker-volume'
	| 'docker-compose-stack'
	| 'systemd-unit'
	| 'service-binding';

export interface ResourceLifecycle {
	readonly deletionPolicy: 'delete' | 'retain';
	readonly replaceOnChangeFields: readonly string[];
	readonly applyStrategy: 'immediate' | 'rolling' | 'recreate';
}

export interface GeneratedArtifact {
	readonly id: string;
	readonly path: string;
	readonly content: string;
	readonly contentHash: string;
	readonly owner: string | null;
	readonly group: string | null;
	readonly mode: string | null;
}
```

## Health definitions

```ts
export interface HealthCheckDefinition {
	readonly kind: 'http' | 'tcp' | 'command' | 'systemd';
	readonly timeoutMilliseconds: number;
	readonly intervalMilliseconds: number;
	readonly retries: number;
	readonly target: HealthTarget;
}

export type HealthTarget =
	| {
			readonly type: 'http';
			readonly url: string;
			readonly expectedStatusCodes: readonly number[];
	  }
	| {
			readonly type: 'tcp';
			readonly host: string;
			readonly port: number;
	  }
	| {
			readonly type: 'command';
			readonly command: readonly string[];
	  }
	| {
			readonly type: 'systemd';
			readonly unitName: string;
	  };

export interface HealthCheckResult {
	readonly resourceId: ResourceId;
	readonly healthy: boolean;
	readonly message: string;
}
```

## Provider interfaces

```ts
export interface ProviderContext {
	readonly logger: Logger;
	readonly stateStore: StateStore;
	readonly secretResolver: SecretResolver;
	readonly runId: string;
	readonly nowIso: string;
}

export interface ProviderCapabilities {
	readonly supportedResourceKinds: readonly ResourceKind[];
	readonly supportsDeletion: boolean;
	readonly supportsDiscovery: boolean;
}

export interface Provider<ResourceState = unknown, ProviderOutput = unknown> {
	readonly kind: ProviderKind;
	readonly capabilities: ProviderCapabilities;

	validateConfig(
		config: ProviderConfig,
	): Promise<readonly Diagnostic[]>;

	discover(
		resourceDefinitions: readonly ResourceDefinition[],
		context: ProviderContext,
	): Promise<readonly DiscoveredResource<ResourceState>[]>;

	plan(
		input: ProviderPlanInput<ResourceState>,
		context: ProviderContext,
	): Promise<readonly PlannedAction[]>;

	apply(
		action: PlannedAction,
		context: ProviderContext,
	): Promise<ProviderApplyResult<ProviderOutput>>;
}
```

## Discovery and planning types

```ts
export interface DiscoveredResource<ResourceState = unknown> {
	readonly resourceId: ResourceId;
	readonly kind: ResourceKind;
	readonly exists: boolean;
	readonly providerState: ResourceState | null;
	readonly outputs: Record<string, unknown>;
}

export interface ProviderPlanInput<ResourceState = unknown> {
	readonly desiredResources: readonly ResourceDefinition[];
	readonly discoveredResources: readonly DiscoveredResource<ResourceState>[];
}

export type PlanActionKind =
	| 'create'
	| 'update'
	| 'replace'
	| 'delete'
	| 'noop';

export interface PlannedAction {
	readonly actionId: string;
	readonly resourceId: ResourceId;
	readonly providerKind: ProviderKind;
	readonly kind: PlanActionKind;
	readonly reason: string;
	readonly dependsOnActionIds: readonly string[];
	readonly risk: 'low' | 'medium' | 'high';
	readonly desiredState: unknown;
	readonly currentState: unknown;
}

export interface ProviderApplyResult<ProviderOutput = unknown> {
	readonly actionId: string;
	readonly resourceId: ResourceId;
	readonly success: boolean;
	readonly message: string;
	readonly output: ProviderOutput | null;
}
```

## Compiler interfaces

```ts
export interface Compiler {
	compile(configSet: DeploymentConfigSet): Promise<CompilationResult>;
}

export interface CompilationResult {
	readonly diagnostics: readonly Diagnostic[];
	readonly model: DeploymentModel | null;
}
```

## Loader interfaces

```ts
export interface ConfigLoader {
	load(deploymentRootPath: string): Promise<LoadedConfig>;
}

export interface LoadedConfig {
	readonly documents: readonly ConfigDocument[];
	readonly diagnostics: readonly Diagnostic[];
}
```

## Validation interfaces

```ts
export interface ConfigValidator {
	validate(loadedConfig: LoadedConfig): Promise<ValidatedConfigResult>;
}

export interface ValidatedConfigResult {
	readonly diagnostics: readonly Diagnostic[];
	readonly configSet: DeploymentConfigSet | null;
}
```

## Planner interfaces

```ts
export interface DeploymentPlan {
	readonly metadata: DeploymentPlanMetadata;
	readonly actions: readonly PlannedAction[];
	readonly diagnostics: readonly Diagnostic[];
}

export interface DeploymentPlanMetadata {
	readonly createdAtIso: string;
	readonly configDigest: string;
	readonly actionCount: number;
	readonly destructiveActionCount: number;
}

export interface Planner {
	createPlan(
		model: DeploymentModel,
		providers: ProviderRegistry,
		context: ProviderContext,
	): Promise<DeploymentPlan>;
}
```

## Executor interfaces

```ts
export interface ApplyResult {
	readonly success: boolean;
	readonly actionResults: readonly ProviderApplyResult[];
	readonly healthResults: readonly HealthCheckResult[];
	readonly diagnostics: readonly Diagnostic[];
}

export interface Executor {
	applyPlan(
		plan: DeploymentPlan,
		model: DeploymentModel,
		providers: ProviderRegistry,
		context: ProviderContext,
	): Promise<ApplyResult>;
}
```

## Provider registry

```ts
export interface ProviderRegistry {
	get(providerKind: ProviderKind): Provider;
	list(): readonly Provider[];
}
```

## Renderer interfaces

```ts
export interface Renderer<Input> {
	render(input: Input): RenderedArtifact;
}

export interface RenderedArtifact {
	readonly content: string;
	readonly contentHash: string;
}

export interface SystemdUnitRenderInput {
	readonly unitName: string;
	readonly description: string;
	readonly serviceUser: string;
	readonly workingDirectory: string;
	readonly environmentFilePath: string | null;
	readonly execStart: readonly string[];
	readonly restartPolicy: 'no' | 'always' | 'on-failure';
}

export interface ComposeRenderInput {
	readonly projectName: string;
	readonly services: readonly ComposeService[];
	readonly networks: readonly ComposeNetwork[];
	readonly volumes: readonly ComposeVolume[];
}

export interface ComposeService {
	readonly name: string;
	readonly image: string;
	readonly environment: Record<string, string>;
	readonly ports: readonly string[];
	readonly volumes: readonly string[];
	readonly dependsOn: readonly string[];
}

export interface ComposeNetwork {
	readonly name: string;
	readonly internal: boolean;
}

export interface ComposeVolume {
	readonly name: string;
}
```

## State store interfaces

```ts
export interface StateSnapshot {
	readonly runId: string;
	readonly deploymentName: string;
	readonly environmentName: string;
	readonly configDigest: string;
	readonly recordedAtIso: string;
	readonly resources: readonly StateResourceRecord[];
}

export interface StateResourceRecord {
	readonly resourceId: ResourceId;
	readonly providerKind: ProviderKind;
	readonly kind: ResourceKind;
	readonly externalId: string | null;
	readonly desiredStateHash: string;
	readonly outputs: Record<string, unknown>;
}

export interface StateStore {
	saveSnapshot(snapshot: StateSnapshot): Promise<void>;
	loadLatestSnapshot(
		deploymentName: string,
		environmentName: string,
	): Promise<StateSnapshot | null>;
	recordAuditEvent(event: AuditEvent): Promise<void>;
}

export interface AuditEvent {
	readonly runId: string;
	readonly timestampIso: string;
	readonly eventType: string;
	readonly message: string;
	readonly resourceId: string | null;
	readonly detail: Record<string, unknown>;
}
```

## Logging interfaces

```ts
export interface Logger {
	debug(message: string, detail?: Record<string, unknown>): void;
	info(message: string, detail?: Record<string, unknown>): void;
	warn(message: string, detail?: Record<string, unknown>): void;
	error(message: string, detail?: Record<string, unknown>): void;
}
```

---

## Recommended First-Phase Resource Mapping

For the initial system described in the existing project documents, the compiler should emit at least the following resources:

### Vultr

- `vultr-instance`
- `vultr-firewall-group`

### Cloudflare

- `cloudflare-dns-record`

### Host

- `host-directory`
- `host-file`
- `systemd-unit`

### Docker and service runtime

- `docker-network`
- `docker-volume`
- `docker-compose-stack`

### Logical wiring

- `service-binding`

The `service-binding` resource exists so that dependency and validation logic can model relationships explicitly even where no standalone external object exists.

---

## Suggested Command Behavior

## `validate`

- load config
- run structural and semantic validation
- print diagnostics
- do not contact providers unless explicitly requested

## `plan`

- load and validate config
- compile deployment model
- discover actual state
- print proposed actions with risk labels
- redact all secret values

## `apply`

- perform `plan`
- require confirmation for high-risk changes in interactive mode
- apply resources in dependency order
- run health checks
- persist audit and state

## `doctor`

- verify provider credentials presence
- verify host reachability
- verify local config structure
- verify required runtime dependencies for the chosen target stack

---

## Milestone Plan

## Milestone 1: Core foundation

- Bun project setup
- TypeScript config
- CLI skeleton
- logger
- SQLite-backed state store
- YAML loader

## Milestone 2: Validation and compiler

- runtime schemas
- semantic validator
- deployment model
- dependency graph

## Milestone 3: Planning

- provider registry
- discovery interfaces
- plan generation
- plan formatting

## Milestone 4: Providers

- Vultr provider
- Cloudflare provider
- host provider

## Milestone 5: Rendering and runtime deployment

- systemd renderer
- Compose renderer
- generated env files
- OpenClaw, Graphiti, and FalkorDB stack wiring

## Milestone 6: Security and operations

- secret backend abstraction
- redaction
- audit events
- doctor command
- drift reporting

---

## Recommended Initial Implementation Boundaries

To keep the first version maintainable:

- prefer one config loader instead of a generalized plugin loader
- prefer one host transport strategy at first
- prefer sequential staged applies over aggressive concurrency
- prefer explicit typed resource kinds over highly dynamic generic resource objects
- prefer a small number of solid interfaces over speculative abstractions

---

## Summary

The recommended architecture is a declarative deployment controller built as a compiler and reconciler. YAML configuration is loaded, validated, compiled into a provider-agnostic deployment model, reconciled against actual state, and applied through provider adapters in dependency order.

The interface design centers on:

- a validated configuration model
- a normalized deployment model
- pluggable providers
- a deterministic planner
- a safe executor
- pure renderers
- secure secret resolution
- persistent state and audit recording

This provides a strong foundation for implementing the deployment system in Bun and TypeScript while keeping the codebase extensible, testable, and security-conscious.