# OpenClaw Declarative Deployment Architecture

## Overview

This system is configured entirely through declarative YAML files. There are no manual service setup steps, no imperative CLI commands to remember, and no "magic" configuration state that only exists in memory or in scattered env files. Everything the system does is described in code, version-controlled, auditable, and reproducible from a single source of truth.

The architecture is a layered stack where each layer's behavior is declared via config files that get validated, compiled, and deployed as immutable units. Pre-deployment, the config is validated and optimized. At runtime, changes to config files trigger zero-downtime hot reloads where supported.

## Declarative-First Philosophy

A declarative system describes **what should be running**, not **how to run it**. The operator writes config files describing the desired state, and the system converges to that state autonomously.

**Principles:**
- **Single source of truth**: All configuration lives in version-controlled YAML files
- **Validation before deployment**: Config is checked for validity and consistency before any service starts
- **Immutable deployments**: Each deployment is a snapshot of config files; rolling back means reverting commits
- **Zero-downtime reconfiguration**: Most runtime changes apply without restarting services
- **Observability by default**: Every service publishes its actual state; you can query what's running vs. what's declared
- **No manual operations**: If you're manually editing a file on the server or running one-off commands, the system isn't declarative

## System Architecture

```
Your machine
  → Cloudflare DNS (naming only)
  → Vultr public IP
  → Vultr firewall + UFW (source-IP allowlist)
  → Caddy reverse proxy (TLS, routing)
  → OpenClaw runtime (systemd, declaratively configured)
       → OVH AI Endpoints (inference)
       → Discord gateway (messaging)
       → Graphiti REST API (memory, on private Docker network)
            → FalkorDB (graph database, on private Docker network)
```

**Why this shape:**
- Flexibility: Each boundary is independently replaceable
- Stability: Hot path is simple; minimal cross-service hops
- Performance: Co-located services avoid remote DB latency
- Security: Public surface is minimal; private services stay internal

## Declarative Configuration Files

All system behavior is declared via YAML files in a git repository. On deployment, these files are pulled, validated, compiled into service definitions, and applied.

```
deploy/
├── README.md                    # Deployment instructions
├── config/
│   ├── system.yaml             # Core runtime config
│   ├── tools.yaml              # Agent tools and capabilities
│   ├── workers.yaml            # Worker process definitions
│   ├── inference.yaml          # Model assignments
│   ├── memory.yaml             # Graphiti and persistence
│   ├── discord.yaml            # Discord bot settings
│   ├── docker-compose.yaml     # Graphiti + FalkorDB stack
│   └── secrets.env.example     # Secrets template (→ .env on deployment)
├── scripts/
│   ├── validate.sh             # Validate all config files
│   ├── deploy.sh               # Main deployment script
│   ├── healthcheck.sh          # System health verification
│   └── rollback.sh             # Revert to previous deploy
├── systemd/
│   ├── openclaw.service        # Generated from config
│   ├── openclaw-cluster.target # Generated from config
│   └── caddy.service           # Generated from config
└── .gitignore                  # Excludes secrets, local state
```

## Pre-Deployment: Configuration as Code

Before a single service starts, the entire system is declared in YAML and validated.

### system.yaml — Runtime Environment

```yaml
version: '1.0'

app:
  name: openclaw
  environment: production
  log_level: info
  admin_port: 9999              # Admin API, localhost only

inference:
  provider: ovh
  base_url: ${OVH_API_BASE_URL}
  api_key: ${OVH_API_KEY}
  timeout_seconds: 120
  retry_count: 3
  models:
    reasoning: claude-3-5-sonnet-20241022
    extraction: claude-3-haiku-20240307
    embedding: nomic-embed-text-v1.5

memory:
  enabled: true
  backend: graphiti
  graphiti_url: http://localhost:8000
  cache_ttl_seconds: 3600
  sync_frequency_seconds: 30    # How often to persist memory

discord:
  enabled: true
  bot_token: ${DISCORD_BOT_TOKEN}
  guild_id: ${DISCORD_GUILD_ID}
  channel_id: ${DISCORD_CHANNEL_ID}
  allowed_user_ids:
    - ${DISCORD_USER_ID}
  features:
    typing_indicator: true
    thread_per_session: false
```

### tools.yaml — Agent Capabilities

```yaml
version: '1.0'

# Each tool is a capability the agent can invoke
# Tools are loaded from /opt/openclaw/tools/
tools:
  - name: web_search
    enabled: true
    description: Search the web for current information
    timeout_ms: 30000
    
  - name: memory_query
    enabled: true
    description: Query long-term memory from Graphiti
    timeout_ms: 5000
    
  - name: code_generate
    enabled: true
    description: Generate code (requires code worker)
    timeout_ms: 45000
    worker_dependency: code
    
  - name: research_deep
    enabled: false
    description: Delegate deep research to worker
    timeout_ms: 120000
    worker_dependency: research
    
  - name: validate_solution
    enabled: false
    description: Run tests and validation
    timeout_ms: 20000
    worker_dependency: validate

# Global tool settings
concurrency:
  max_concurrent_tools: 3       # Never run more than 3 tools at once
  max_per_worker: 2             # Max 2 concurrent requests to any one worker
  tool_call_timeout_ms: 30000   # Total timeout for any tool call
```

### workers.yaml — Specialized Processes

```yaml
version: '1.0'

# Workers are separate processes that handle specialized tasks
# Each worker has its own systemd unit, lifecycle, and health checks
workers:
  - name: research
    enabled: false
    script: workers/research.js
    socket: /tmp/openclaw-research.sock
    restart_policy: on-failure
    max_restarts: 3
    restart_delay_ms: 5000
    health_check:
      enabled: true
      interval_ms: 10000
      timeout_ms: 5000
    resources:
      memory_limit_mb: 512
      cpu_quota_percent: 50
    
  - name: code
    enabled: true
    script: workers/code.js
    socket: /tmp/openclaw-code.sock
    restart_policy: on-failure
    max_restarts: 3
    restart_delay_ms: 5000
    health_check:
      enabled: true
      interval_ms: 10000
      timeout_ms: 5000
    resources:
      memory_limit_mb: 1024
      cpu_quota_percent: 80
    
  - name: validate
    enabled: false
    script: workers/validate.js
    socket: /tmp/openclaw-validate.sock
    restart_policy: on-failure
    max_restarts: 3
    restart_delay_ms: 5000
    health_check:
      enabled: true
      interval_ms: 10000
      timeout_ms: 3000
```

### memory.yaml — Persistence Layer

```yaml
version: '1.0'

graphiti:
  enabled: true
  url: http://localhost:8000
  health_check_interval_ms: 30000
  
  extraction:
    enabled: true
    model: claude-3-haiku-20240307
    batch_size: 10
    extraction_interval_seconds: 60
    
  embedding:
    enabled: true
    model: nomic-embed-text-v1.5
    cache_vectors: true
    
  retention:
    default_ttl_days: 365
    archive_after_days: 90

docker:
  compose_file: config/docker-compose.yaml
  graphiti_container: graphiti
  falkordb_container: falkordb
  network: openclaw-private
```

### docker-compose.yaml — Memory Stack

```yaml
version: '3.8'

services:
  falkordb:
    image: falkordb/falkordb:latest
    container_name: falkordb
    networks:
      - openclaw-private
    volumes:
      - falkordb_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "PING"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: on-failure

  graphiti:
    image: graphiti/graphiti:latest
    container_name: graphiti
    environment:
      FALKORDB_URL: redis://falkordb:6379
      OVH_API_BASE_URL: ${OVH_API_BASE_URL}
      OVH_API_KEY: ${OVH_API_KEY}
      LLM_MODEL: ${GRAPHITI_LLM_MODEL}
      EMBEDDING_MODEL: ${GRAPHITI_EMBEDDING_MODEL}
    ports:
      - "127.0.0.1:8000:8000"
    depends_on:
      - falkordb
    networks:
      - openclaw-private
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: on-failure

volumes:
  falkordb_data:

networks:
  openclaw-private:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.name: br-openclaw
```

### inference.yaml — Model Configuration

```yaml
version: '1.0'

models:
  reasoning:
    provider: ovh
    name: claude-3-5-sonnet-20241022
    temperature: 0.7
    top_p: 0.95
    max_tokens: 4096
    
  extraction:
    provider: ovh
    name: claude-3-haiku-20240307
    temperature: 0.3
    top_p: 0.9
    max_tokens: 2048
    
  embedding:
    provider: ovh
    name: nomic-embed-text-v1.5
    dimensions: 768

providers:
  ovh:
    base_url: ${OVH_API_BASE_URL}
    api_key: ${OVH_API_KEY}
    timeout_seconds: 120
    max_retries: 3
    retry_backoff_ms: 1000
```

### discord.yaml — Bot Configuration

```yaml
version: '1.0'

bot:
  enabled: true
  token: ${DISCORD_BOT_TOKEN}
  guild_id: ${DISCORD_GUILD_ID}
  channel_id: ${DISCORD_CHANNEL_ID}
  
  access_control:
    mode: allowlist
    allowed_users:
      - ${DISCORD_USER_ID}
    
  features:
    typing_indicator: true
    thread_per_session: false
    reactions: true
    
  message_settings:
    prefix: null                 # Respond to all messages
    max_message_length: 2000     # Discord limit
    timeout_seconds: 120
```

### secrets.env.example — Environment Template

```bash
# Copy to secrets.env and populate with real values
# secrets.env is .gitignore'd and never committed

OVH_API_BASE_URL=https://api.ovh.example.com
OVH_API_KEY=your-api-key-here
DISCORD_BOT_TOKEN=your-bot-token-here
DISCORD_GUILD_ID=123456789
DISCORD_CHANNEL_ID=987654321
DISCORD_USER_ID=111111111
GRAPHITI_LLM_MODEL=claude-3-haiku-20240307
GRAPHITI_EMBEDDING_MODEL=nomic-embed-text-v1.5
ADMIN_API_TOKEN=randomly-generated-token-here
```

## Deployment Pipeline

The deployment script reads all YAML files, validates them, compiles them into service definitions, and starts the system with proper ordering guarantees.

### validate.sh — Pre-Deployment Validation

```bash
#!/bin/bash
set -e

echo "Validating configuration files..."

# Check YAML syntax
for file in config/*.yaml; do
  echo "  Checking $file..."
  python3 -c "import yaml; yaml.safe_load(open('$file'))" || exit 1
done

# Validate required fields
echo "Checking required configuration sections..."
for section in app inference memory discord; do
  if ! grep -q "^$section:" config/system.yaml; then
    echo "ERROR: Missing [$section] in system.yaml"
    exit 1
  fi
done

# Validate worker definitions
echo "Checking worker scripts exist..."
while IFS= read -r line; do
  if [[ $line =~ script:\ (.+) ]]; then
    script="${BASH_REMATCH[1]}"
    if [[ ! -f "/opt/openclaw/${script}" ]]; then
      echo "ERROR: Worker script not found: /opt/openclaw/${script}"
      exit 1
    fi
  fi
done < config/workers.yaml

echo "✓ All validations passed"
```

### deploy.sh — Complete Deployment

```bash
#!/bin/bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ID=$(date +%s)

echo "=========================================="
echo "OpenClaw Declarative Deployment"
echo "Deployment ID: $DEPLOY_ID"
echo "=========================================="

# 1. Validate configuration
echo "1. Validating configuration..."
bash "${REPO_ROOT}/scripts/validate.sh" || exit 1

# 2. Load secrets
echo "2. Loading environment secrets..."
if [[ ! -f "${REPO_ROOT}/secrets.env" ]]; then
  echo "ERROR: secrets.env not found. Copy from secrets.env.example and populate."
  exit 1
fi
export $(cat "${REPO_ROOT}/secrets.env" | xargs)

# 3. Stop existing services (gracefully)
echo "3. Stopping existing services (if any)..."
systemctl stop openclaw-cluster.target 2>/dev/null || true
sleep 2

# 4. Pull latest code
echo "4. Pulling latest code..."
cd /opt/openclaw && git pull origin main

# 5. Start Docker stack (Graphiti + FalkorDB)
echo "5. Starting memory stack (Docker)..."
cd "${REPO_ROOT}" && docker-compose -f config/docker-compose.yaml up -d
sleep 5

# 6. Wait for Graphiti to be healthy
echo "6. Waiting for Graphiti health check..."
for i in {1..30}; do
  if curl -s http://localhost:8000/health > /dev/null; then
    echo "  ✓ Graphiti is healthy"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "  ERROR: Graphiti failed to start"
    exit 1
  fi
  sleep 1
done

# 7. Generate systemd units from config
echo "7. Generating systemd units from configuration..."
python3 "${REPO_ROOT}/scripts/generate-systemd.py" \
  --config "${REPO_ROOT}/config" \
  --output /etc/systemd/system

# 8. Reload systemd
echo "8. Reloading systemd daemon..."
systemctl daemon-reload

# 9. Start OpenClaw cluster
echo "9. Starting OpenClaw cluster..."
systemctl enable openclaw-cluster.target
systemctl start openclaw-cluster.target

# 10. Wait for OpenClaw to be healthy
echo "10. Waiting for OpenClaw health check..."
for i in {1..30}; do
  if curl -s http://localhost:9999/admin/health > /dev/null; then
    echo "  ✓ OpenClaw is healthy"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "  ERROR: OpenClaw failed to start"
    systemctl status openclaw.service
    exit 1
  fi
  sleep 1
done

# 11. Verify system state
echo "11. Verifying system state..."
bash "${REPO_ROOT}/scripts/healthcheck.sh" || exit 1

# 12. Record deployment
echo "12. Recording deployment..."
cat > /var/log/openclaw/deployments.log << EOF
DEPLOY_ID=$DEPLOY_ID
TIMESTAMP=$(date -Iseconds)
GIT_COMMIT=$(git -C /opt/openclaw rev-parse HEAD)
GIT_BRANCH=$(git -C /opt/openclaw rev-parse --abbrev-ref HEAD)
STATUS=success
EOF

echo ""
echo "=========================================="
echo "✓ Deployment complete (ID: $DEPLOY_ID)"
echo "=========================================="
echo ""
echo "System is running. Check status with:"
echo "  systemctl status openclaw-cluster.target"
echo "  curl http://localhost:9999/admin/status"
echo ""
```

### healthcheck.sh — Verify Running State

```bash
#!/bin/bash
set -e

echo "Performing health checks..."

# Check systemd services
for service in openclaw.service worker-code.service; do
  if systemctl is-active --quiet "$service"; then
    echo "  ✓ $service is running"
  else
    echo "  ✗ $service is not running"
    exit 1
  fi
done

# Check Docker containers
for container in graphiti falkordb; do
  if docker ps --filter "name=$container" --filter "status=running" | grep -q "$container"; then
    echo "  ✓ $container container is running"
  else
    echo "  ✗ $container container is not running"
    exit 1
  fi
done

# Check admin API
if curl -s http://localhost:9999/admin/health > /dev/null; then
  echo "  ✓ Admin API is responding"
else
  echo "  ✗ Admin API is not responding"
  exit 1
fi

# Check Graphiti
if curl -s http://localhost:8000/health > /dev/null; then
  echo "  ✓ Graphiti is healthy"
else
  echo "  ✗ Graphiti is not responding"
  exit 1
fi

echo "✓ All health checks passed"
```

## Runtime: Hot Configuration Reload

The system exposes an admin API (localhost-only) for reconfiguring without downtime. This is how you make runtime changes.

### Admin API Endpoints

All endpoints are authenticated with `Authorization: Bearer ${ADMIN_API_TOKEN}` header.

```bash
# Get current declared config
curl http://localhost:9999/admin/config

# Get actual running state
curl http://localhost:9999/admin/status

# Reload tools (add/remove capabilities)
curl -X POST http://localhost:9999/admin/reload/tools \
  -H "Content-Type: application/json" \
  -d @config/tools.yaml

# Reload workers (add/update worker definitions)
curl -X POST http://localhost:9999/admin/reload/workers \
  -H "Content-Type: application/json" \
  -d @config/workers.yaml

# Enable/disable a tool
curl -X PATCH http://localhost:9999/admin/tools/research_deep \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Enable/disable a worker
curl -X PATCH http://localhost:9999/admin/workers/research \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Get detailed worker status
curl http://localhost:9999/admin/workers/status

# Get system metrics
curl http://localhost:9999/admin/metrics
```

### Runtime Change Example

```bash
# 1. Edit config file
vi config/workers.yaml
# Change: research.enabled from false to true

# 2. Validate the change
bash scripts/validate.sh

# 3. Apply at runtime (no restart of OpenClaw)
curl -X POST http://localhost:9999/admin/reload/workers \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -d @config/workers.yaml

# 4. Monitor the change
curl http://localhost:9999/admin/workers/status | jq '.research'

# 5. Commit to git (so deployment is reproducible)
git add config/workers.yaml
git commit -m "Enable research worker"
git push
```

## Configuration Validation

The system validates config files at every stage.

### YAML Schema Validation

```yaml
# config/schema.json
{
  "type": "object",
  "required": ["version", "tools"],
  "properties": {
    "version": {
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+$"
    },
    "tools": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "enabled"],
        "properties": {
          "name": { "type": "string" },
          "enabled": { "type": "boolean" },
          "timeout_ms": { "type": "integer", "minimum": 1000 },
          "worker_dependency": { "type": "string" }
        }
      }
    },
    "workers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "enabled", "script"],
        "properties": {
          "name": { "type": "string" },
          "enabled": { "type": "boolean" },
          "script": { "type": "string" },
          "socket": { "type": "string" }
        }
      }
    }
  }
}
```

### Consistency Checks

Before deployment, the system checks:
- All referenced worker scripts exist
- All tool worker dependencies have matching workers defined
- No circular dependencies between tools/workers
- No undefined environment variables
- Docker image tags are valid

## Git Workflow for Deployments

Since everything is declarative and version-controlled, deployments are just git operations.

```bash
# Workflow: Adding a new capability

# 1. Create feature branch
git checkout -b feature/add-research-worker

# 2. Add worker config and script
cp workers/template.js workers/research.js
# ... implement the research worker ...
echo "  - name: research" >> config/workers.yaml
echo "    enabled: true" >> config/workers.yaml
# ... add remaining config ...

# 3. Validate locally
bash scripts/validate.sh

# 4. Commit
git add workers/research.js config/workers.yaml
git commit -m "Add research worker for deep investigation"

# 5. Push to remote
git push origin feature/add-research-worker

# 6. On production server, pull and deploy
cd /opt/openclaw && git pull origin main
bash scripts/deploy.sh

# 7. Verify
curl http://localhost:9999/admin/workers/status | jq '.research'
```

## Rollback

Since git is the source of truth, rollback is simple:

```bash
# See deployment history
git log --oneline config/

# Rollback to previous deployment
git revert HEAD
# or
git reset --hard HEAD~1
git push origin main

# Re-deploy
bash scripts/deploy.sh
```

## Why This Approach

**Single source of truth**: All system behavior is described in version-controlled YAML. No surprise state; no undocumented configuration.

**Pre-deployment validation**: Errors are caught before any service starts, not discovered mid-deployment.

**Zero-downtime updates**: Most runtime changes (tools, workers, models) apply without restarting OpenClaw. Full system restarts are predictable git operations.

**Auditability**: Every change has a git commit message and timestamp. You can see exactly what changed and why.

**Reproducibility**: New environments are created by running the same deploy script against the same config files. Prod and staging are bit-for-bit identical except for secrets.

**Operations as code**: There is no "how do I...?" tribal knowledge. The answer is always in the config files or deployment scripts.

## Recommended Solution Summary

- **Vultr Ubuntu VM** with public IP, firewalled to your source IP only
- **Caddy** reverse proxy for TLS and routing
- **OpenClaw** on host under systemd (not Docker)
- **Graphiti + FalkorDB** in Docker on private network
- **Discord** as the primary interaction surface
- **OVH AI Endpoints** for all inference with role-specific model assignment
- **Declarative YAML configuration** as single source of truth
- **Git-based deployments** with validation and zero-downtime reloads
- **Admin API** for runtime changes without restarting
- **Systemd for orchestration**, not Kubernetes

This keeps the system small, observable, and predictable while remaining flexible enough to add workers and tools without operational friction.