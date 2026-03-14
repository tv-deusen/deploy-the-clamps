import { expect, test } from 'bun:test';

import { Compiler } from './compiler.ts';
import { parseConfigDocument } from '../config/schemas.ts';
import type {
  ConfigDocument,
  ConfigDocumentKind,
  LoadedConfig,
} from '../types/compiler.ts';

test('Compiler emits Cloudflare tunnel and host artifacts', () => {
  const documents = [
    parseConfigDocument({
      sourcePath: 'deployment.yaml',
      value: `
kind: deployment
version: v1
name: clamps
environment: production
target:
  instanceName: clamps-prod
  sshUser: ubuntu
  sshPort: 22
`,
    }),
    parseConfigDocument({
      sourcePath: 'providers.yaml',
      value: `
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
    }),
    parseConfigDocument({
      sourcePath: 'system.yaml',
      value: `
kind: system
version: v1
app:
  name: openclaw
  environment: production
  logLevel: info
  adminPort: 9999
  gatewayHost: 127.0.0.1
  gatewayPort: 3456
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
    }),
    parseConfigDocument({
      sourcePath: 'tunnel.yaml',
      value: `
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
systemd:
  unitName: cloudflared.service
  configPath: /etc/cloudflared/config.yml
`,
    }),
  ];
  const compiler = new Compiler();

  const compileResult = compiler.compile({
    loadedConfig: createLoadedConfig(documents),
    now: new Date('2026-03-13T20:00:00.000Z'),
  });
  const resourceTypes = compileResult.graph.resources.map((resource) => resource.type);
  const cloudflareTunnel = compileResult.graph.resources.find(
    (resource) => resource.type === 'cloudflare.tunnel',
  );
  const cloudflaredConfig = compileResult.graph.resources.find(
    (resource) => resource.type === 'host.file',
  );

  expect(resourceTypes).toEqual([
    'cloudflare.tunnel',
    'host.file',
    'host.systemd-unit',
    'cloudflare.access-application',
    'cloudflare.access-policy',
  ]);
  expect(cloudflareTunnel?.desired).toMatchObject({
    accountId: 'account-123',
    tunnelName: 'gateway',
    hostname: 'gateway.example.com',
    serviceUrl: 'http://127.0.0.1:3456',
  });
  expect(cloudflaredConfig?.desired).toMatchObject({
    kind: 'file',
    path: '/etc/cloudflared/config.yml',
  });

  if (!cloudflaredConfig || typeof cloudflaredConfig.desired !== 'object') {
    throw new Error('Expected a host.file resource');
  }

  expect((cloudflaredConfig.desired as { content: string }).content).toContain(
    'hostname: gateway.example.com',
  );
});

function createLoadedConfig(documents: readonly ConfigDocument[]): LoadedConfig {
  const documentsByKind = new Map<ConfigDocumentKind, ConfigDocument[]>();

  for (const document of documents) {
    const existing = documentsByKind.get(document.kind);

    if (existing) {
      existing.push(document);
      continue;
    }

    documentsByKind.set(document.kind, [document]);
  }

  return {
    documents,
    documentsByKind,
  };
}
