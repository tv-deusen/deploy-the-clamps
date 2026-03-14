import { expect, test } from 'bun:test';

import type { ResourceDefinition } from '../types/compiler.ts';
import type { PlannedChange } from '../types/planner.ts';
import { orderPlanChangesByDependencies } from './runtime.ts';

test('orderPlanChangesByDependencies executes dependencies first', () => {
	const resources: ResourceDefinition[] = [
		{
			id: 'resource.a',
			type: 'host.file',
			name: 'a',
			provider: 'host',
			desired: {},
			dependsOn: [],
		},
		{
			id: 'resource.b',
			type: 'host.file',
			name: 'b',
			provider: 'host',
			desired: {},
			dependsOn: ['resource.c'],
		},
		{
			id: 'resource.c',
			type: 'host.file',
			name: 'c',
			provider: 'host',
			desired: {},
			dependsOn: ['resource.a'],
		},
	];
	const changes: PlannedChange[] = [
		createChange('resource.b'),
		createChange('resource.a'),
		createChange('resource.c'),
	];

	const ordered = orderPlanChangesByDependencies(changes, resources);

	expect(ordered.map((change) => change.resource.id)).toEqual([
		'resource.a',
		'resource.c',
		'resource.b',
	]);
});

function createChange(resourceId: string): PlannedChange {
	return {
		resource: {
			id: resourceId,
			type: 'host.file',
			name: resourceId,
			provider: 'host',
		},
		action: 'create',
		riskLevel: 'low',
		reason: 'test',
		disruptive: false,
		changes: [],
		dependencies: [],
	};
}
