import { resolve } from 'node:path';
import { Compiler } from './compiler/compiler.ts';
import {
	DefaultConfigLoader,
	FilesystemConfigPathResolver,
	NodeConfigFileReader,
} from './config/loader.ts';
import { createConfigDocumentParser } from './config/parser.ts';
import { DeploymentPlanner } from './planner/planner.ts';
import { createCloudflareProvider } from './providers/cloudflare/provider.ts';
import { HostProvider } from './providers/host/provider.ts';
import { createVultrProvider } from './providers/vultr/provider.ts';
import type { Provider, ProviderName } from './types/providers.ts';

type CommandName = 'help' | 'validate' | 'plan' | 'apply' | 'doctor';

type CliOptions = {
	command: CommandName;
	arguments: string[];
};

type CommandContext = {
	deploymentRootPath: string;
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
	const context = parseCommandArguments(arguments_);
	const loadedConfig = await loadConfig(context);

	console.log(`Validated ${loadedConfig.documents.length} document(s).`);

	if (loadedConfig.documents.length > 0) {
		console.log('Loaded documents:');

		for (const document of loadedConfig.documents) {
			console.log(`  - ${document.kind} (${document.sourcePath})`);
		}
	}

	if (loadedConfig.warnings.length > 0) {
		console.log('');
		console.log('Warnings:');

		for (const warning of loadedConfig.warnings) {
			const sourceSuffix =
				warning.sourcePath === undefined
					? ''
					: ` (${warning.sourcePath})`;
			console.log(
				`  - [${warning.code}] ${warning.message}${sourceSuffix}`,
			);
		}
	}

	return 0;
}

async function runPlanCommand(arguments_: readonly string[]): Promise<number> {
	const context = parseCommandArguments(arguments_);
	const loadedConfig = await loadConfig(context);
	const compiler = new Compiler();
	const compileResult = compiler.compile({
		loadedConfig,
		now: new Date(),
	});

	const providers = new Map<ProviderName, Provider>([
		['cloudflare', createCloudflareProvider()],
		['host', new HostProvider()],
		['vultr', createVultrProvider()],
	]);

	const planner = new DeploymentPlanner({
		providers,
	});

	const plan = await planner.createPlanFromCompileResult({
		compileResult,
	});

	console.log(
		`Plan for ${compileResult.deployment.name} (${compileResult.deployment.environment})`,
	);
	console.log(`Generated at: ${compileResult.deployment.generatedAt}`);
	console.log('');

	console.log('Summary:');
	console.log(`  Create:  ${plan.summary.createCount}`);
	console.log(`  Update:  ${plan.summary.updateCount}`);
	console.log(`  Replace: ${plan.summary.replaceCount}`);
	console.log(`  Delete:  ${plan.summary.deleteCount}`);
	console.log(`  No-op:   ${plan.summary.noopCount}`);
	console.log(`  Total:   ${plan.summary.changeCount}`);

	if (plan.changes.length > 0) {
		console.log('');
		console.log('Changes:');

		for (const change of plan.changes) {
			console.log(
				`  - ${change.action.toUpperCase()} ${change.resource.provider} ${change.resource.type} ${change.resource.name}`,
			);
			console.log(`    Reason: ${change.reason}`);
		}
	}

	const combinedWarnings = [
		...loadedConfig.warnings,
		...compileResult.warnings,
		...plan.warnings.map((warningMessage) => ({
			code: 'PLAN_WARNING',
			message: warningMessage,
			sourcePath: undefined,
		})),
	];

	if (combinedWarnings.length > 0) {
		console.log('');
		console.log('Warnings:');

		for (const warning of combinedWarnings) {
			const sourceSuffix =
				warning.sourcePath === undefined
					? ''
					: ` (${warning.sourcePath})`;
			console.log(
				`  - [${warning.code}] ${warning.message}${sourceSuffix}`,
			);
		}
	}

	return 0;
}

async function runApplyCommand(arguments_: readonly string[]): Promise<number> {
	await Promise.resolve(arguments_);
	console.log('apply: not implemented yet');
	return 0;
}

async function runDoctorCommand(
	arguments_: readonly string[],
): Promise<number> {
	await Promise.resolve(arguments_);
	console.log('doctor: not implemented yet');
	return 0;
}

function parseCommandArguments(arguments_: readonly string[]): CommandContext {
	let deploymentRootPath = process.cwd();

	for (
		let argumentIndex = 0;
		argumentIndex < arguments_.length;
		argumentIndex += 1
	) {
		const argument = arguments_[argumentIndex];

		if (argument === '--root') {
			const rootPath = arguments_[argumentIndex + 1];

			if (!rootPath) {
				throw new Error('Missing value for "--root".');
			}

			deploymentRootPath = resolve(rootPath);
			argumentIndex += 1;
			continue;
		}

		throw new Error(`Unknown option "${argument}".`);
	}

	return {
		deploymentRootPath,
	};
}

async function loadConfig(context: CommandContext) {
	const loader = new DefaultConfigLoader({
		pathResolver: new FilesystemConfigPathResolver(),
		fileReader: new NodeConfigFileReader(),
		documentParser: createConfigDocumentParser(),
	});

	return await loader.load(context.deploymentRootPath);
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

void runFromProcess(process.argv.slice(2));
