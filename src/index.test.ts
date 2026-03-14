import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from './index.ts';

const createdDirectories: string[] = [];

afterEach(async () => {
	while (createdDirectories.length > 0) {
		const directoryPath = createdDirectories.pop();

		if (!directoryPath) {
			continue;
		}

		await rm(directoryPath, {
			recursive: true,
			force: true,
		});
	}
});

test('main plan command prints tunnel resources for a valid deployment root', async () => {
	const deploymentRootPath = await createDeploymentFixture();
	const originalLog = console.log;
	const capturedLines: string[] = [];

	console.log = (...values: unknown[]) => {
		capturedLines.push(values.join(' '));
	};

	try {
		const exitCode = await main(['plan', deploymentRootPath]);

		expect(exitCode).toBe(0);
		expect(
			capturedLines.some((line) => line.includes('cloudflare.tunnel')),
		).toBe(true);
		expect(
			capturedLines.some((line) =>
				line.includes('cloudflare.access-policy'),
			),
		).toBe(true);
	} finally {
		console.log = originalLog;
	}
});

async function createDeploymentFixture(): Promise<string> {
	const deploymentRootPath = await mkdtemp(join(tmpdir(), 'dt-clamps-'));

	createdDirectories.push(deploymentRootPath);

	await writeFile(
		join(deploymentRootPath, 'deployment.yaml'),
		`
kind: deployment
version: v1
name: clamps
environment: production
target:
  instanceName: clamps-prod
  sshUser: ubuntu
  sshPort: 22
`,
	);
	await writeFile(
		join(deploymentRootPath, 'providers.yaml'),
		`
kind: providers
version: v1
cloudflare:
  accountId: account-123
  zoneId: zone-123
  apiToken:
    kind: secret
    provider: environment
    key: CF_API_TOKEN
`,
	);
	await writeFile(
		join(deploymentRootPath, 'system.yaml'),
		`
kind: system
version: v1
app:
  name: openclaw
  environment: production
  logLevel: info
  adminPort: 9999
  gatewayHost: 127.0.0.1
  gatewayPort: 3000
inference:
  provider: ovh
  baseUrl: https://example.invalid
  apiKey:
    kind: secret
    provider: environment
    key: OVH_API_KEY
  timeoutSeconds: 120
  retryCount: 3
  models:
    reasoning: reasoner
    extraction: extractor
    embedding: embedder
integrations: {}
`,
	);
	await writeFile(
		join(deploymentRootPath, 'tunnel.yaml'),
		`
kind: tunnel
version: v1
provider: cloudflare
name: gateway
hostname: gateway.example.com
access:
  enabled: true
  applicationName: Gateway
  policyName: Gateway Admins
  allowedEmails:
    - you@example.com
`,
	);

	return deploymentRootPath;
}
