export interface StateSnapshot {
	readonly runId: string;
	readonly deploymentName: string;
	readonly environmentName: string;
	readonly configDigest: string;
	readonly recordedAtIso: string;
	readonly resources: readonly StateResourceRecord[];
}

export interface StateResourceRecord {
	readonly resourceId: string;
	readonly providerKind: string;
	readonly resourceKind: string;
	readonly externalId: string | null;
	readonly desiredStateHash: string;
	readonly outputs: Readonly<Record<string, unknown>>;
}

export interface AuditEvent {
	readonly runId: string;
	readonly timestampIso: string;
	readonly eventType: string;
	readonly message: string;
	readonly resourceId: string | null;
	readonly detail: Readonly<Record<string, unknown>>;
}

export interface StateStore {
	saveSnapshot(snapshot: StateSnapshot): Promise<void>;
	loadLatestSnapshot(
		deploymentName: string,
		environmentName: string,
	): Promise<StateSnapshot | null>;
	recordAuditEvent(event: AuditEvent): Promise<void>;
}
