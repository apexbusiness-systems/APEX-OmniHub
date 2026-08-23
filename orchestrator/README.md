---
version: 1.1.0
last_audited: 2026-06-21
status: verified
---

> **Current-state note (2026-07-04):** Current repo scan at `d22ddcf` reports ~130 tracked orchestrator files (excluding `__pycache__`). Runtime health on Render/Temporal was not live-verified by the documentation sync.


# APEX Orchestrator

Production-grade AI Agent Orchestration Platform with Temporal.io, Event Sourcing, and Saga Patterns.

> **Production runtime note (2026-06-21).** The canonical, anti-drift source for the *live* orchestrator deployment (services, env vars, Temporal/Redis/Supabase wiring, deploy, smoke test, incident playbook) is **`memory/omni-recall/docs/APEX_AGENT_OPERATIONS.md`** + `memory/omni-recall/docs/operations/APEX_AGENT_RUNBOOK.md`. This README is the developer setup/architecture guide. Two facts to keep in mind against the docs below:
> - **Semantic caching was activated in the production deploy on 2026-07-04** (`SEMANTIC_CACHE_ENABLED=true`, `SEMANTIC_CACHE_MODE=lite` on the 512 MB Render Starter worker; confirmed via Render API, worker redeployed and stable). The real hit-rate is not yet captured here — `semantic_cache_lookups_total` is served on the worker's private `:9090` metrics port, which has no external network path from this environment; the "70% reduction" figure remains a projection until that metric is actually scraped (see `ORCHESTRATOR_CERTIFICATION.md` C3).
> - APEX Agent was verified **LIVE / demo-ready end-to-end on 2026-06-19**; Temporal runs on **Temporal Cloud** (ns `apex-omnihub-temporal.i7ero`, ca-central-1, API-key auth), not a self-hosted cluster.
> Repository orchestrator Python file count at last audit: **103** (`find orchestrator -name '*.py'`, 2026-06-21). The dated pytest counts further below are labelled point-in-time notes; the live test tally is tracked in CI, not here.

## 🎯 Features

- **Event Sourcing**: Complete audit trail with deterministic replay
- **Saga Pattern**: Compensation-based distributed transactions
- **Semantic Caching**: 70% reduction in LLM calls via plan template matching
- **Multi-Region**: Distributed locking for Active-Active deployments
- **Type-Safe**: Pydantic models matching TypeScript EventEnvelope contracts
- **Vendor-Agnostic**: LiteLLM + Instructor for any LLM provider

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ TypeScript Edge Functions (Supabase)                         │
│   - APEX Agent                                               │
│   - Event Publishers (sim/contracts)                         │
└─────────────────┬────────────────────────────────────────────┘
                  │ EventEnvelope (JSON/HTTP)
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ Python Temporal.io Orchestrator                              │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ Workflow (Event Sourcing + Saga)                       │   │
│ │ - Semantic Cache → Plan Generation → Execution         │   │
│ │ - Automatic Compensation on Failure                    │   │
│ └────────────────────────────────────────────────────────┘   │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ Activities (Tool Execution)                            │   │
│ │ - Supabase Integration                                 │   │
│ │ - LLM Calls (instructor + litellm)                     │   │
│ │ - Distributed Locking                                  │   │
│ └────────────────────────────────────────────────────────┘   │
└───────┬──────────────────────────┬───────────────────────────┘
        │                          │
        ▼                          ▼
┌───────────────┐      ┌──────────────────────┐
│ Redis Stack   │      │ Supabase PostgreSQL  │
│ -Vector Search│      │ - workflow_instances │
│ - Dist. Locks │      │ - agent_checkpoints  │
└───────────────┘      └──────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Python 3.11+
- Docker & Docker Compose (for local Temporal + Redis)
- Supabase account
- OpenAI or Anthropic API key

### 1. Install Dependencies

```bash
cd orchestrator
pip install -e ".[dev]"
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Supabase and LLM credentials
```

### 3. Start Infrastructure

```bash
# Start Temporal + Redis using Docker Compose
docker-compose up -d

# Wait for services to be ready
docker-compose ps
```

### 4. Run Tests

```bash
# Run all tests
pytest

# With coverage
pytest --cov=. --cov-report=html

# Run specific test
pytest tests/test_models.py -v
```

### 5. Start Worker

```bash
# Start orchestrator worker
python main.py worker
```

### 6. Submit Test Workflow

```bash
# In another terminal
python main.py submit "Book flight to Paris tomorrow and send confirmation to john@example.com"
```

## 📦 Project Structure

```
orchestrator/
├── models/                  # Pydantic models (Universal Schema)
│   ├── __init__.py
│   └── events.py           # EventEnvelope, AgentEvents
├── infrastructure/          # Infrastructure services
│   ├── __init__.py
│   └── cache.py            # Semantic cache with Redis VSS
├── workflows/               # Temporal workflows
│   ├── __init__.py
│   └── agent_saga.py       # AgentWorkflow with Event Sourcing + Saga
├── activities/              # Temporal activities
│   ├── __init__.py
│   ├── tools.py            # Tool execution, idempotency guard, Supabase integration
│   ├── iron_law_verify.py  # Deductive path verification (subprocess → Node.js)
│   ├── universal_intents.py # USO system activities (health_check, echo, list)
│   └── omnitrace_activities.py # Omnitrace workflow activities
├── core/                    # Core registry and intent routing
│   ├── intent_registry.py  # IntentRegistry singleton
│   └── intents.py          # Bridge mappings (14 tool + 3 USO intents)
├── policies/                # MAN Mode risk policy engine
├── security/                # SSRF guard, prompt sanitizer, request signing
├── tests/                   # Comprehensive test suite (390 tests collected)
│   ├── conftest.py         # Pytest fixtures
│   ├── test_models.py      # Model validation tests (16)
│   ├── test_cache.py       # Semantic cache tests
│   ├── test_man_mode.py    # MAN Mode policies (38)
│   ├── test_tools.py       # Tool activities (25)
│   ├── test_tools_extended.py  # Extended tools coverage (22) — added 2026-03-16
│   ├── test_iron_law_verify.py # Iron Law verification (7) — added 2026-03-16
│   ├── test_universal_intents.py # USO activities (11) — added 2026-03-16
│   ├── test_core_intents.py    # Intent registry bridge (4) — added 2026-03-16
│   └── ...                 # 20+ additional test files
├── config.py                # Configuration management
├── main.py                  # Entry point
├── pyproject.toml           # Dependencies, ruff/black/mypy config
├── Dockerfile               # Production Docker image
├── docker-compose.yml       # Local development stack
└── README.md                # This file
```

## 🧪 Testing

**Current status (2026-03-16)**: 366 tests passing, 390 collected, 20 skipped (require external services).

### Unit Tests

```bash
# Run all unit tests (no external services required)
pytest tests/ -v

# Run specific suites
pytest tests/test_models.py tests/test_tools.py tests/test_man_mode.py -v

# Run with coverage
pytest tests/ --cov=. --cov-report=term-missing
```

### Integration Tests

```bash
# Requires Redis running
docker-compose up -d redis
pytest tests/test_cache.py -v
```

### End-to-End Tests

```bash
# Requires full stack (Temporal + Redis + Supabase)
docker-compose up -d
pytest tests/ -v
```

## 🔧 Integration with APEX-OmniHub

### 1. Database Schema

Add workflow tables to Supabase:

```sql
-- Migration: 20240XXX_orchestrator_schema.sql
CREATE TABLE workflow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id text NOT NULL UNIQUE,
  status text NOT NULL, -- running, completed, failed
  input jsonb NOT NULL,
  result jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_workflow_instances_status ON workflow_instances(status);
CREATE INDEX idx_workflow_instances_created ON workflow_instances(created_at DESC);
```

### 2. TypeScript Client

Call orchestrator from edge functions:

```typescript
// supabase/functions/trigger-workflow/index.ts
import { EventEnvelope } from '../_shared/types';

async function triggerOrchestrator(goal: string, userId: string) {
  const envelope: EventEnvelope = {
    eventId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    idempotencyKey: `${userId}-workflow-${Date.now()}`,
    tenantId: userId,
    eventType: 'orchestrator:agent.goal_received',
    payload: { goal, user_id: userId },
    timestamp: new Date().toISOString(),
    source: 'omnihub',
    trace: {
      traceId: crypto.randomUUID(),
      spanId: crypto.randomUUID(),
    },
    schemaVersion: '1.0.0',
  };

  // POST to orchestrator HTTP endpoint (via Temporal client or webhook)
  const response = await fetch('http://orchestrator:8000/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  return await response.json();
}
```

### 3. Environment Variables

Add to `.env`:

```bash
# Orchestrator endpoint
ORCHESTRATOR_URL=http://orchestrator:8000

# Temporal connection
TEMPORAL_HOST=temporal.example.com:7233
TEMPORAL_NAMESPACE=apex-production
```

## 📊 Monitoring & Observability

### Temporal Web UI

Access at http://localhost:8233 to view:
- Running workflows
- Event history
- Retry attempts
- Execution metrics

### Redis Insight

Access at http://localhost:8001 to view:
- Cached plans
- Vector similarity matches
- Distributed locks

### Logs

```bash
# View orchestrator logs
docker-compose logs -f orchestrator

# View all services
docker-compose logs -f
```

## 🛡️ Production Deployment

### 1. Deploy Temporal

Use [Temporal Cloud](https://temporal.io/cloud) or self-hosted Kubernetes:

```bash
# Helm chart for Kubernetes
helm install temporal \
  --set server.replicaCount=3 \
  temporal/temporal
```

### 2. Deploy Orchestrator

```bash
# Build production image
docker build -t apex-orchestrator:latest .

# Deploy to Kubernetes
kubectl apply -f k8s/orchestrator-deployment.yaml
```

### 3. Configure Upstash Redis

Use managed Redis with Active-Active for multi-region:

```bash
# Set Redis URL to Upstash endpoint
REDIS_URL=rediss://:password@endpoint.upstash.io:6379
```

## 🔍 Troubleshooting

### Tests Failing

```bash
# Check Redis connection
redis-cli ping

# Check Temporal connection
docker-compose ps

# Run tests with verbose logging
pytest -v -s --log-cli-level=DEBUG
```

### Worker Not Starting

```bash
# Check environment variables
python -c "from config import settings; print(settings.model_dump())"

# Check Temporal connectivity
python -c "import asyncio; from temporalio.client import Client; asyncio.run(Client.connect('localhost:7233'))"
```

## 📚 Key Concepts

### Event Sourcing

Workflow state is reconstructed by replaying events:

```python
events = [
    GoalReceived(goal="Book flight"),
    PlanGenerated(steps=[...]),
    ToolCallRequested(tool="search_flights"),
    ToolResultReceived(result={...}),
    WorkflowCompleted(final_result={...}),
]

# Replay to reconstruct state
for event in events:
    apply_event(event)
```

### Saga Pattern

Compensation-based rollback:

```python
# Forward operations register compensations
saga.execute_with_compensation(
    activity="book_flight",
    compensation_activity="cancel_flight",
)

# On failure, compensations execute in reverse
if error:
    await saga.rollback()  # Calls cancel_flight
```

### Semantic Caching

Plan template matching with vector search:

```
Goal: "Book flight to Paris tomorrow"
  ↓
Template: "Book flight to {LOCATION} {DATE}"
  ↓
Embedding: [0.23, -0.45, 0.12, ...]
  ↓
Redis VSS: Find similar templates (cosine similarity)
  ↓
Cache Hit: Inject parameters → Execute
```

### Idempotency Guard

Activities with irreversible side effects (`send_email`, `call_webhook`) use a shared `_idempotency_guard()` helper to prevent duplicate execution on Temporal replay:

```python
# Key format: {workflow_id}:{step_id}:{tool_name}
idempotency_key = f"{workflow_id}:{step_id}:send_email"
cached = await _idempotency_guard(db, idempotency_key, "send_email", workflow_id)
if cached is not None:
    return cached  # Already executed — return stored result

# ... perform side effect ...
# Record completion in idempotency_ledger table
```

The guard checks the `idempotency_ledger` table, inserts a `pending` record, and returns any previously stored `completed` result. Database errors are swallowed so ledger unavailability never blocks the actual work.

## 🤝 Contributing

1. Create feature branch: `git checkout -b feature/my-feature`
2. Write tests: `pytest tests/`
3. Run linters: `ruff check . && black .`
4. Submit PR

## 📄 License

Proprietary - APEX Business Systems

## 🆘 Support

- GitHub Issues: https://github.com/apexbusiness-systems/APEX-OmniHub/issues
- Documentation: https://docs.apex.systems/orchestrator
