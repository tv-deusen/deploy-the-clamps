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
}

async function runValidateCommand(arguments_: readonly string[]): Promise<number> {
  await Promise.resolve(arguments_);
  console.log('validate: not implemented yet');
  return 0;
}

async function runPlanCommand(arguments_: readonly string[]): Promise<number> {
  await Promise.resolve(arguments_);
  console.log('plan: not implemented yet');
  return 0;
}

async function runApplyCommand(arguments_: readonly string[]): Promise<number> {
  await Promise.resolve(arguments_);
  console.log('apply: not implemented yet');
  return 0;
}

async function runDoctorCommand(arguments_: readonly string[]): Promise<number> {
  await Promise.resolve(arguments_);
  console.log('doctor: not implemented yet');
  return 0;
}

async function runFromProcess(argv: readonly string[]): Promise<void> {
  try {
    const exitCode = await main(argv);
    process.exitCode = exitCode;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'An unknown CLI error occurred';
    console.error(message);
    process.exitCode = 1;
  }
}

void runFromProcess(process.argv.slice(2));
