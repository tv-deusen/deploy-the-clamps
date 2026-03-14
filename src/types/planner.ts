export type PlannerAction = 'create' | 'update' | 'replace' | 'delete' | 'noop';

export type PlanRiskLevel = 'low' | 'medium' | 'high';

export interface PlanResourceRef {
	readonly id: string;
	readonly type: string;
	readonly name: string;
	readonly provider: string;
}

export interface PlanChangeSummary {
	readonly path: string;
	readonly currentValue: string | number | boolean | null;
	readonly desiredValue: string | number | boolean | null;
	readonly sensitive: boolean;
}

export interface PlanDependency {
	readonly type: 'dependsOn' | 'blockedBy' | 'orderedAfter';
	readonly resource: PlanResourceRef;
}

export interface PlannedChange {
	readonly resource: PlanResourceRef;
	readonly action: PlannerAction;
	readonly riskLevel: PlanRiskLevel;
	readonly reason: string;
	readonly disruptive: boolean;
	readonly changes: readonly PlanChangeSummary[];
	readonly dependencies: readonly PlanDependency[];
}

export interface PlanSummary {
	readonly createCount: number;
	readonly updateCount: number;
	readonly replaceCount: number;
	readonly deleteCount: number;
	readonly noopCount: number;
	readonly changeCount: number;
}

export interface DeploymentPlan {
	readonly createdAt: string;
	readonly summary: PlanSummary;
	readonly changes: readonly PlannedChange[];
	readonly warnings: readonly string[];
}

export interface Planner<State, DesiredState> {
	createPlan(input: {
		readonly currentState: State;
		readonly desiredState: DesiredState;
	}): Promise<DeploymentPlan>;
}
