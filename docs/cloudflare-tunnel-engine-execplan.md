# Implement Cloudflare Tunnel Config Schemas and Planning Engine Support

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not check in `PLANS.md`, but this document is written to comply with the process described in `C:\Users\verle\.codex\PLANS.md`.

## Purpose / Big Picture

After this change, a contributor can place YAML configuration documents in a deployment directory, run the engine's `validate` and `plan` commands, and see Cloudflare Tunnel resources show up alongside the host artifacts needed to run `cloudflared`. The user-visible win is that the engine will understand the free Cloudflare Tunnel + Access architecture described in the docs instead of only recognizing direct DNS exposure.

## Progress

- [x] (2026-03-13 20:25Z) Reviewed repository architecture, active compiler/planner/provider path, and Cloudflare-oriented documentation.
- [x] (2026-03-13 20:31Z) Identified that `src/types/compiler.ts` is the active engine contract and that `src/types/domain.ts` is not wired into the runnable path.
- [x] (2026-03-13 21:05Z) Implemented schema-backed YAML parsing and filesystem config discovery for the active engine.
- [x] (2026-03-13 21:12Z) Added tunnel-aware compiler resources, Cloudflare provider support, and host renderers for `cloudflared`.
- [x] (2026-03-13 21:23Z) Wired `validate` and `plan` CLI commands to the engine and added tests proving the new behavior.
- [x] (2026-03-13 21:30Z) Verified the implementation with `bun test` and `bunx tsc -p tsconfig.json --noEmit` outside the sandbox due workspace permission quirks.

## Surprises & Discoveries

- Observation: The repository contains two parallel type systems for deployment config.
  Evidence: `src/types/domain.ts` defines a much richer model, but the runnable compiler imports `src/types/compiler.ts`.

- Observation: The CLI currently accepts commands but does not yet call the loader/compiler/planner stack.
  Evidence: `src/index.ts` prints `not implemented yet` for `validate`, `plan`, `apply`, and `doctor`.

- Observation: Bun and TypeScript toolchain commands could not read installed dependencies from `node_modules` inside the default sandbox for this worktree.
  Evidence: Initial test and typecheck runs failed with `Cannot find package 'yaml'` and `EPERM` errors until rerun outside the sandbox.

## Decision Log

- Decision: Extend the active engine path instead of migrating to the richer unused domain model.
  Rationale: The user asked to continue implementation, and the active path can be made working end-to-end with much lower risk than a wholesale type-system migration.
  Date/Author: 2026-03-13 / Codex

- Decision: Model Cloudflare Tunnel as a dedicated `tunnel` config document instead of overloading the existing `network` document.
  Rationale: Tunnel publication, Access policy, and `cloudflared` host artifacts form a distinct concern from raw DNS/firewall networking and deserve their own schema boundary.
  Date/Author: 2026-03-13 / Codex

## Outcomes & Retrospective

The engine now has a working `validate` and `plan` path for the active config model, including a new `tunnel` document kind that compiles into Cloudflare Tunnel, Cloudflare Access, and host `cloudflared` resources. The work stayed intentionally scoped to planning and validation rather than apply-time provisioning, which keeps the implementation demonstrable without pretending the provider execution layer is complete.

## Context and Orientation

The current runnable engine is composed of a small set of modules under `src/`. `src/config/loader.ts` defines the loader interfaces but does not provide a filesystem resolver or schema parser. `src/compiler/compiler.ts` converts loaded config documents into a `ResourceGraph`, but currently only emits a Vultr instance and a single Cloudflare DNS resource. `src/planner/planner.ts` groups resources by provider and asks each provider to classify them as `create`, `update`, `replace`, `delete`, or `noop`. Provider contracts live in `src/types/providers.ts`, and the concrete Cloudflare, Vultr, and host providers live under `src/providers/`.

The relevant term "resource graph" means the list of typed desired resources plus dependency edges between them. In this repository, a resource graph is the `ResourceGraph` type in `src/types/compiler.ts`.

The relevant term "schema-backed parsing" means turning raw YAML text into typed config documents with runtime validation. In this repository, that means introducing Zod schemas and using them from the config loader before the compiler sees any data.

## Plan of Work

First, add the missing configuration runtime pieces. Create a filesystem path resolver and file reader in `src/config/`, plus a Zod-backed document parser that understands all currently used config kinds and a new `tunnel` document kind. Update `src/types/compiler.ts` so the active engine types match the new schema fields, including Cloudflare account information, gateway host/port defaults, and tunnel/access configuration.

Second, extend compilation and planning. Update `src/compiler/compiler.ts` so it reads deployment, provider, system, network, and tunnel documents together and produces a richer set of resources: Vultr compute and firewall resources when configured, Cloudflare tunnel and Access resources, and host file/systemd resources for `cloudflared`. Update `src/types/providers.ts`, `src/providers/cloudflare/provider.ts`, and `src/planner/planner.ts` so the new Cloudflare resource types can be validated and planned.

Third, make the engine observable from the CLI. Update `src/index.ts` so `validate <path>` loads and validates configuration and `plan <path>` prints a concise plan summary plus per-resource actions. Add Bun tests covering document parsing, tunnel compilation, and CLI-visible planning behavior.

## Concrete Steps

From the repository root `C:\Users\verle\.codex\worktrees\8eb9\dt-clamps`:

1. Run `bun test` after the new tests are added and expect the tunnel parsing and compiler tests to pass.
2. Run `bun run src/index.ts validate <deployment-root>` against a fixture directory and expect a success summary naming the number of documents and resources.
3. Run `bun run src/index.ts plan <deployment-root>` and expect to see `cloudflare.tunnel`, `cloudflare.access-application`, `cloudflare.access-policy`, `host.file`, and `host.systemd-unit` actions in the plan output when the tunnel document is present.

## Validation and Acceptance

Acceptance is reached when the following are true:

- A deployment directory containing valid YAML documents, including the new `tunnel` document, is accepted by `validate`.
- The compiler emits Cloudflare tunnel and Access resources plus host artifacts for `cloudflared`.
- The planner can classify those resources without throwing provider-type errors.
- Automated tests prove the parser rejects invalid tunnel documents and that a valid tunnel deployment produces the expected resource set.

## Idempotence and Recovery

The implementation is additive and safe to re-run. `validate` and `plan` are read-only operations. If a schema or compiler edit breaks validation, recovery is simply to revert the affected files and re-run `bun test`.

## Artifacts and Notes

The key artifacts for this change will be:

- runtime schemas under `src/config/`
- compiler and provider changes under `src/compiler/`, `src/planner/`, and `src/providers/`
- automated tests under `src/`

## Interfaces and Dependencies

The end state must include the following concrete interfaces and behaviors:

- `src/config/schemas.ts` must export a parser that accepts raw YAML text and returns a typed `ConfigDocument`.
- `src/config/filesystem.ts` must provide a filesystem-backed `ConfigPathResolver` and `ConfigFileReader`.
- `src/types/compiler.ts` must include `tunnel` in `ConfigDocumentKind`, a `TunnelConfigDocument` type, and Cloudflare tunnel/access resource types.
- `src/compiler/compiler.ts` must emit resource definitions for Cloudflare tunnel publication and the `cloudflared` host artifacts.
- `src/providers/cloudflare/provider.ts` must validate and plan `cloudflare_tunnel`, `cloudflare_access_application`, and `cloudflare_access_policy` resources.
- `src/index.ts` must implement `validate` and `plan` using the real engine pipeline.

Revision note: created this plan before implementation to capture the active-engine decision and the Cloudflare Tunnel scope.

Revision note: updated after implementation to record the sandbox-related verification quirk, the completed milestones, and the fact that the feature now works end-to-end through `validate`, `plan`, tests, and strict typecheck.
