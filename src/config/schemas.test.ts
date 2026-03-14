import { expect, test } from 'bun:test';

import { parseConfigDocument } from './schemas.ts';

test('parseConfigDocument applies tunnel defaults', () => {
  const document = parseConfigDocument({
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
`,
  });

  expect(document.kind).toBe('tunnel');

  if (document.kind !== 'tunnel') {
    throw new Error('Expected tunnel document');
  }

  expect(document.service.target).toBe('openclaw-gateway');
  expect(document.systemd.unitName).toBe('cloudflared.service');
  expect(document.systemd.configPath).toBe('/etc/cloudflared/config.yml');
});

test('parseConfigDocument rejects tunnel URL targets without a URL', () => {
  expect(() =>
    parseConfigDocument({
      sourcePath: 'tunnel.yaml',
      value: `
kind: tunnel
version: v1
provider: cloudflare
name: gateway
hostname: gateway.example.com
service:
  target: url
access:
  enabled: true
  applicationName: Gateway
  policyName: Gateway Admins
  allowedEmails:
    - you@example.com
`,
    }),
  ).toThrow('tunnel.service.url is required');
});
