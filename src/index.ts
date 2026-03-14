import { resolve } from 'node:path';

import { DeploymentEngine } from './engine/runtime.ts';

type CommandName = 'help' | 'validate' | 'plan' | 'apply' | 'doctor';

type CliOptions = {
	command: CommandName;
	arguments: string[];
};

const supportedCommands: readonly CommandName[] = [
	'help',
	'validate',
	'plan',
	'apply',
	'doctor',
];

export async function main(argv: readonly string[]): Promise<number> {
	const options = parseCommandLineArguments(argv);

	switch (options.command) {
		case 'help':
			printHelp();
			return 0;
		case 'validate':
			return await runValidateCommand(options.arguments);
		case 'plan':
			return await runPlanCommand(options.arguments);
		case 'apply':
			return await runApplyCommand(options.arguments);
		case 'doctor':
			return await runDoctorCommand(options.arguments);
	}
}

function parseCommandLineArguments(argv: readonly string[]): CliOptions {
	const [rawCommand, ...remainingArguments] = argv;

	if (!rawCommand || rawCommand === '--help' || rawCommand === '-h') {
		return {
			command: 'help',
			arguments: [],
		};
	}

	if (isCommandName(rawCommand)) {
		return {
			command: rawCommand,
			arguments: remainingArguments,
		};
	}

	throw new Error(
		`Unknown command "${rawCommand}". Supported commands: ${supportedCommands.join(', ')}`,
	);
}

function isCommandName(value: string): value is CommandName {
	return supportedCommands.includes(value as CommandName);
}

function printHelp(): void {
	console.log('deploy-the-clamps');
	console.log('');
	console.log('Usage: bun run src/index.ts <command> [options]');
	console.log('');
	console.log('Commands:');
	console.log('  help       Show this help output');
	console.log('  validate   Validate deployment configuration');
	console.log('  plan       Build and print a deployment plan');
	console.log('  apply      Apply the deployment plan');
	console.log('  doctor     Run environment and configuration diagnostics');
	console.log('');
	console.log('Options:');
	console.log(
		'  --root <path>   Path to the deployment directory containing config/',
	);
}

async function runValidateCommand(
	arguments_: readonly string[],
): Promise<number> {
	const deploymentRootPath = getDeploymentRootPath(arguments_);
	const engine = new DeploymentEngine();
	const snapshot = await engine.validate(deploymentRootPath);

	console.log(
		`Validated ${snapshot.loadedConfig.documents.length} document(s).`,
	);
	console.log(
		`Compiled ${snapshot.compileResult.graph.resources.length} resource(s).`,
	);

	if (snapshot.compileResult.warnings.length > 0) {
		console.log('');
		console.log('Warnings:');

		for (const warning of snapshot.compileResult.warnings) {
			console.log(`- [${warning.code}] ${warning.message}`);
		}
	}

	return 0;
}

async function runPlanCommand(arguments_: readonly string[]): Promise<number> {
	const deploymentRootPath = getDeploymentRootPath(arguments_);
	const engine = new DeploymentEngine();
	const { snapshot, plan } = await engine.plan(deploymentRootPath);

	console.log(
		`Plan for ${snapshot.compileResult.deployment.name} (${snapshot.compileResult.deployment.environment})`,
	);
	console.log(
		`Resources: ${snapshot.compileResult.graph.resources.length}, changes: ${plan.summary.changeCount}`,
	);
	console.log('');

	for (const change of plan.changes) {
		console.log(
			`${change.action.toUpperCase()} ${change.resource.type} ${change.resource.name} [${change.resource.provider}]`,
		);
		console.log(`  ${change.reason}`);
	}

	if (
		plan.warnings.length > 0 ||
		snapshot.compileResult.warnings.length > 0
	) {
		console.log('');
		console.log('Warnings:');

		for (const warning of snapshot.compileResult.warnings) {
			console.log(`- [compile] ${warning.message}`);
		}

		for (const warning of plan.warnings) {
			console.log(`- [plan] ${warning}`);
		}
	}

	return 0;
}

async function runApplyCommand(arguments_: readonly string[]): Promise<number> {
	const deploymentRootPath = getDeploymentRootPath(arguments_);
	const engine = new DeploymentEngine();
	const execution = await engine.apply(deploymentRootPath);
	const { snapshot, plan } = execution;

	console.log(
		`Apply for ${snapshot.compileResult.deployment.name} (${snapshot.compileResult.deployment.environment})`,
	);
	console.log(
		`Resources: ${snapshot.compileResult.graph.resources.length}, planned changes: ${plan.summary.changeCount}`,
	);
	console.log('');

	for (const change of execution.orderedChanges) {
		console.log(
			`${change.action.toUpperCase()} ${change.resource.type} ${change.resource.name} [${change.resource.provider}]`,
		);
	}

	if (execution.success) {
		const changedCount = execution.steps.filter(
			(step) => step.result.changed,
		).length;

		console.log('');
		console.log(
			`Apply completed successfully. Executed ${execution.steps.length} action(s), changed ${changedCount}.`,
		);

		return 0;
	}

	const failure = execution.failure;

	if (!failure) {
		return 1;
	}

	console.log('');
	console.log('Apply failed.');
	console.log(
		`Failed action: ${failure.failedChange.action.toUpperCase()} ${failure.failedChange.resource.type} ${failure.failedChange.resource.name} [${failure.failedChange.resource.provider}]`,
	);
	console.log(`Error: ${failure.message}`);
	console.log(`Applied actions: ${failure.appliedSteps.length}`);
	console.log(`Pending actions: ${failure.pendingChanges.length}`);

	if (failure.rollbackCandidates.length > 0) {
		console.log('Rollback candidates (latest first):');

		for (const candidate of failure.rollbackCandidates) {
			console.log(
				`- ${candidate.action.toUpperCase()} ${candidate.resource.type} ${candidate.resource.name} [${candidate.resource.provider}]`,
			);
		}
	}

	return 1;
}

async function runDoctorCommand(
	arguments_: readonly string[],
): Promise<number> {
	await Promise.resolve(arguments_);
	console.log('doctor: not implemented yet');
	return 0;
}

function getDeploymentRootPath(arguments_: readonly string[]): string {
	const [rawPath] = arguments_;

	if (!rawPath) {
		throw new Error(
			'A deployment root path is required. Example: bun run src/index.ts validate ./deploy',
		);
	}

	return resolve(rawPath);
}

async function runFromProcess(argv: readonly string[]): Promise<void> {
	try {
		const exitCode = await main(argv);
		process.exitCode = exitCode;
	} catch (error: unknown) {
		const message =
			error instanceof Error
				? error.message
				: 'An unknown CLI error occurred';
		console.error(message);
		process.exitCode = 1;
	}
}

if (import.meta.main) {
	void runFromProcess(process.argv.slice(2));
}
