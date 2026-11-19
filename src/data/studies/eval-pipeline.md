## 1. Problem

Design an asynchronous evaluation platform that accepts a dataset URL (for example, Math500, containing questions and expected answers), generates model answers, grades them using a Python grading library, and aggregates evaluation metrics.

The platform has exactly three internal services:

1. **IngestionService**: fetches, validates, normalizes, and stores immutable dataset snapshots.
2. **ExecutionService**: schedules question-level work, calls an external LLM API, grades answers, and records results.
3. **AggregationService**: consumes execution events and produces progress and final evaluation reports.

External dependencies are not internal services:

- Dataset source URL
- Azure Blob Storage
- External LLM API (answer generation)
- Python grading library, loaded and executed by ExecutionService workers

Each internal service owns its API, database, queue, and workers. Services communicate with one another only through APIs. No service reads another service's database or queue.

A report is a measurement, not just a number. Every accuracy the platform reports carries an error bar, names the grader version it was measured under, and links to evidence of how well that grader agrees with humans. Section 7 describes how.

## 2. High-level architecture

```mermaid
flowchart TB
    CLIENT[Evaluation Client]

    subgraph ING["IngestionService"]
        IAPI[Ingestion REST API]
        IQ[(Ingestion Queue)]
        IW[Ingestion Workers]
        IMETA[(Ingestion Metadata DB)]
        IAPI --> IQ --> IW
        IW --> IMETA
    end

    subgraph EXE["ExecutionService"]
        EAPI[Execution REST API]
        EQ[(Execution Queue)]
        EW[Execution Workers]
        EDB[(Execution Metadata and Results DB)]
        OUTBOX[(Transactional Outbox)]
        EAPI --> EQ --> EW
        EW --> EDB
        EDB --> OUTBOX
    end

    subgraph AGG["AggregationService"]
        AAPI[Aggregation REST API]
        AQ[(Aggregation Queue)]
        AW[Aggregation Workers]
        ADB[(Aggregation DB / Inbox)]
        AAPI --> ADB
        ADB --> AQ --> AW --> ADB
    end

    SOURCE[External Dataset URL]
    BLOB[(Azure Blob Storage)]
    LLM[External LLM API<br/>Answer generation]
    GRADER[Python grading library<br/>dependency in ExecutionService]

    CLIENT -->|1. Submit dataset URL| IAPI
    IW -->|Fetch dataset| SOURCE
    IW -->|Write immutable snapshot| BLOB

    CLIENT -->|2. Submit dataset reference + grader UUID + model config| EAPI
    EW -->|Read dataset snapshot| BLOB
    EW -->|Generate answer| LLM
    EW -->|Grade answer vs expected answer| GRADER

    OUTBOX -->|3. Retryable event API calls| AAPI
    CLIENT -->|4. Query status and report| AAPI
```

**Important boundaries**

- The external LLM API is called directly by ExecutionService workers. It is not an internal service.
- Azure Blob Storage is shared managed infrastructure, not a fourth microservice. IngestionService writes snapshots; ExecutionService reads them using its own identity and authorization.
- The Python grading library runs inside the ExecutionService worker process/container. It is not a network service.
- IngestionService does not receive model parameters or the grader UUID. Those are execution concerns.
- The client first obtains a ready dataset reference from IngestionService, then submits that reference to ExecutionService. This keeps the three service boundaries independent.

## 3. End-to-end flow

```mermaid
sequenceDiagram
    autonumber
    participant C as Evaluation Client
    participant I as IngestionService API
    participant IQ as Ingestion Queue
    participant IW as Ingestion Worker
    participant S as Dataset Source URL
    participant B as Azure Blob Storage
    participant E as ExecutionService API
    participant EQ as Execution Queue
    participant W as Execution Worker
    participant L as External LLM API
    participant G as Python Grading Library
    participant A as AggregationService API

    C->>I: POST /v1/ingestions (dataset_url, parser config)
    I->>IQ: Enqueue ingestion job
    I-->>C: 202 Accepted (ingestion_id)
    IQ->>IW: Deliver ingestion job
    IW->>S: Fetch dataset
    S-->>IW: Dataset bytes / records
    IW->>IW: Validate, normalize, hash
    IW->>B: Conditional write immutable snapshot + manifest
    B-->>IW: Blob reference
    IW->>I: Persist READY metadata
    C->>I: GET /v1/ingestions/{id}
    I-->>C: READY + dataset_id + blob/manifest reference

    C->>E: POST /v1/executions (dataset ref, grader_uuid, model config)
    E->>EQ: Enqueue execution
    E-->>C: 202 Accepted (execution_id)
    EQ->>W: Deliver question batch
    W->>B: Read dataset chunk
    B-->>W: Questions + expected answers
    loop For each question
        W->>L: Generate answer
        L-->>W: Generated answer
        W->>G: Grade generated vs expected answer
        G-->>W: Grade result
        W->>W: Persist answer, grade, task state + outbox event
        W->>A: POST evaluation event (retry from outbox)
        A-->>W: Accepted / duplicate
    end
    C->>A: GET /v1/evaluations/{id}/report
    A-->>C: Progress / final metrics
```

## 4. Service responsibilities

### 4.1 IngestionService

**Responsibilities**

- Accept dataset URL and dataset parsing/schema configuration.
- Validate URL and defend against SSRF:
  - Allow only approved schemes (normally HTTPS).
  - Block loopback, private, link-local, and cloud metadata IP ranges.
  - Revalidate every redirect target and DNS resolution.
  - Enforce download size, timeout, redirect, and content-type limits.
- Fetch and stream dataset content.
- Parse records and validate required question and expected-answer fields.
- Normalize records into a versioned canonical schema.
- Compute raw-content and normalized-content hashes.
- Persist an immutable snapshot and manifest in Azure Blob Storage.
- Deduplicate equivalent normalized dataset content.
- Persist ingestion metadata and expose status.
- Accept human-labeled calibration sets (section 7.3) through the same path, under a separate schema version.

**Canonical record example**

```json
{
  "record_id": "math500-000001",
  "question": "What is 2 + 2?",
  "expected_answer": "4",
  "cluster_id": "algebra-template-17"
}
```

`cluster_id` is optional. Set it when several questions share a passage, template, or source problem, so error bars can account for it (section 7.1).

**Calibration record example** (schema version `calibration-1`)

```json
{
  "record_id": "cal-000042",
  "question": "Simplify 2/4.",
  "expected_answer": "1/2",
  "candidate_answer": "0.5",
  "candidate_model_family": "family-b",
  "human_labels": [1, 1, 1]
}
```

Each calibration item carries at least three independent human verdicts on a stored model answer.

**Ingestion request**

```http
POST /v1/ingestions
Idempotency-Key: ingest-request-123
```

```json
{
  "dataset_url": "https://example.com/math500.json",
  "dataset_config": {
    "format": "json",
    "question_field": "question",
    "answer_field": "expected_answer"
  }
}
```

Do not put `model_config` or `grader_uuid` in this request. Ingestion is model- and grader-independent.

**Suggested APIs**

| API | Purpose |
|---|---|
| `POST /v1/ingestions` | Submit an ingestion job; return `202` and an ingestion ID |
| `GET /v1/ingestions/{ingestion_id}` | Read status and dataset reference |
| `GET /v1/ingestions/{ingestion_id}/manifest` | Read manifest metadata |
| `POST /v1/ingestions/{ingestion_id}/cancel` | Request cancellation |

**Ready response example**

```json
{
  "ingestion_id": "ing-123",
  "status": "READY",
  "dataset": {
    "dataset_id": "ds-abc",
    "content_hash": "sha256:abc123",
    "blob_uri": "https://account.blob.core.windows.net/datasets/sha256/abc123/data.jsonl",
    "manifest_uri": "https://account.blob.core.windows.net/datasets/sha256/abc123/manifest.json",
    "record_count": 500,
    "schema_version": "1"
  },
  "dataset_ref": "eyJhbGciOiJFZERTQSJ9.eyJkYXRhc2V0X2lkIjoiZHMtYWJjIn0.c2lnbmF0dXJl"
}
```

`dataset_ref` is the only thing a client passes to ExecutionService (section 4.2). The blob URI is a private resource reference, not a public URL or bearer credential. ExecutionService reads it with its own managed identity and scoped permissions. If a delegated SAS is required, issue a short-lived, read-only token through a separate controlled mechanism.

**Dataset deduplication**

- Hash normalized content, including the canonical schema/normalization version in the identity.
- Use the content hash as a content identity, not the source URL. The same URL can serve different bytes over time.
- Store raw hash separately for provenance.
- Use a unique metadata constraint on `(tenant_scope, normalized_content_hash, schema_version)` where tenant isolation is required.
- Use conditional blob creation such as `If-None-Match: *` to avoid overwriting an existing immutable object.
- Handle concurrent uploads by allowing one writer to create the blob and having the others resolve the already-created content-addressed object.
- Keep logical dataset IDs and authorization metadata separate from physical blob paths.

### 4.2 ExecutionService

**Responsibilities**

- Accept a ready dataset reference, platform-issued `grader_uuid`, model configuration, execution configuration, and idempotency key.
- Authorize access to the dataset reference and verify its immutable content hash/manifest.
- Resolve `grader_uuid` through a trusted grader registry.
- Pin grader implementation/version and relevant configuration for reproducibility.
- Require that the pinned grader version has a validation report (section 7.3), and copy its ID into the execution.
- Create question-level or batch-level tasks and enqueue work.
- Read dataset chunks directly from Blob Storage; do not proxy dataset bytes through IngestionService.
- Call the external LLM API for answer generation.
- Run the Python grading library inside the worker environment.
- Persist generated answers, generation attempts, grading results, and task states.
- Run grade-only executions over stored answers (calibration sets and re-grades) without new generation calls. A deterministic grader makes no model calls; an LLM judge still makes grading calls.
- Accept human labels for audited or escalated tasks (sections 7.4 and 7.5).
- Publish progress/completion events to AggregationService through its API.

**Execution request**

```http
POST /v1/executions
Idempotency-Key: execution-request-123
```

```json
{
  "dataset_ref": "eyJhbGciOiJFZERTQSJ9.eyJkYXRhc2V0X2lkIjoiZHMtYWJjIn0.c2lnbmF0dXJl",
  "grader_uuid": "platform-issued-grader-uuid",
  "model_config": {
    "model": "model-name",
    "model_family": "family-a",
    "temperature": 0,
    "max_tokens": 2048
  },
  "execution_config": {
    "batch_size": 50,
    "max_concurrency": 20,
    "samples_per_question": 1,
    "human_audit_fraction": 0.05,
    "seed": 1234
  }
}
```

- `samples_per_question` ($K$): answers generated per question. $K > 1$ needs a temperature above 0 and lowers the within-question part of the variance (section 7.1).
- `human_audit_fraction`: share of tasks sampled at random for human labeling, used for the bias-corrected estimate (section 7.4). A value of $0$ disables it.
- `model_family` lets the platform flag a grader from the same family as the evaluated model (section 7.3).

**Dataset reference.** ExecutionService never accepts a raw blob URI, because a URI cannot prove that the dataset belongs to the caller's tenant or that IngestionService produced it. IngestionService issues `dataset_ref` when a snapshot becomes `READY`: a token signed with IngestionService's key that carries `dataset_id`, tenant scope, content hash, schema version, and the blob object identity (path and version). ExecutionService verifies the signature with IngestionService's public key, checks that the tenant matches the caller, reads the object by that identity, and checks the content hash before creating tasks. A reference does not expire on its own, because the snapshot is immutable, but revoking a dataset adds its ID to a deny list that ExecutionService checks. The alternative is to pass only `dataset_id` and have ExecutionService resolve it through an IngestionService API. That adds a synchronous dependency on every create; the signed reference avoids it.

**Suggested APIs**

| API | Purpose |
|---|---|
| `POST /v1/executions` | Create an execution and return `202` |
| `GET /v1/executions/{execution_id}` | Read execution status |
| `GET /v1/executions/{execution_id}/tasks` | Inspect task-level progress |
| `GET /v1/executions/{execution_id}/results` | Read generated answers and grading results |
| `POST /v1/executions/{execution_id}/cancel` | Request cancellation |
| `POST /v1/executions/{execution_id}/retry` | Retry eligible failed work under explicit policy |
| `POST /v1/executions/{execution_id}/human-labels` | Submit human verdicts for audited or escalated tasks, keyed by `generation_id` |

**Worker task lifecycle**

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> GENERATING
    PENDING --> ANSWER_PERSISTED: grade-only mode (stored answer)
    GENERATING --> ANSWER_PERSISTED: LLM response stored
    GENERATING --> RETRY_WAIT: transient provider error
    GENERATING --> FAILED: permanent error / retry limit
    RETRY_WAIT --> GENERATING
    ANSWER_PERSISTED --> GRADING
    GRADING --> GRADED: confidence at or above threshold
    GRADING --> ESCALATED: confidence below threshold
    ESCALATED --> GRADED: stronger grader or human verdict
    GRADING --> GRADE_RETRY_WAIT: transient grader/runtime error
    GRADE_RETRY_WAIT --> GRADING
    GRADING --> FAILED: permanent grading error
    GRADED --> [*]
    FAILED --> [*]
```

Persist the generated answer before grading. If grading fails transiently, retry grading against the stored answer instead of calling the evaluated model again. Persist generation attempts separately because model calls may be nondeterministic. `ESCALATED` is not terminal: the task stays open until a stronger grader or a human returns a verdict (section 7.5).

**Grader UUID safety**

- A UUID is an identifier, not executable code.
- Resolve it against a platform-controlled registry.
- Registry metadata should identify an approved package/artifact, immutable version, entry point, resource profile, and configuration schema.
- Registry metadata also records the grader's model family (for LLM judges), its latest validation report, and its calibrated confidence threshold.
- Do not accept arbitrary import paths, package URLs, Python snippets, or shell commands from the execution request.
- Run untrusted or third-party grader code in a sandbox with CPU/memory/time limits, restricted filesystem, and restricted network access.

### 4.3 AggregationService

**Responsibilities**

- Receive progress and terminal task events from ExecutionService over an API.
- Deduplicate events using a stable `event_id`.
- Persist accepted events in an inbox and enqueue aggregation work.
- Maintain counters and metrics per evaluation/execution.
- Maintain per-question scores and per-cluster sums so every report has an error bar (section 7.1).
- Compute paired comparisons between evaluations (section 7.2) and grader validation reports (section 7.3).
- Expose progress, final report, and status APIs.
- Finalize only when all expected tasks are terminal, or when cancellation/failure policy says the run is terminal.

**Suggested APIs**

| API | Purpose |
|---|---|
| `POST /v1/evaluations/{evaluation_id}/events` | Accept progress/task events |
| `GET /v1/evaluations/{evaluation_id}` | Read status |
| `GET /v1/evaluations/{evaluation_id}/metrics` | Read current counters |
| `GET /v1/evaluations/{evaluation_id}/report` | Read final report |
| `POST /v1/evaluations/{evaluation_id}/finalize` | Request or perform finalization |
| `POST /v1/comparisons` | Paired comparison of two evaluations with matching pins |
| `GET /v1/grader-validations/{validation_id}` | Read a grader validation report |

**Event example**

```json
{
  "event_id": "evt-123",
  "evaluation_id": "eval-123",
  "execution_id": "exec-123",
  "event_type": "TASK_GRADED",
  "task_id": "task-001",
  "record_id": "math500-000001",
  "cluster_id": "algebra-template-17",
  "sample_idx": 0,
  "generation_id": "gen-001",
  "grader_version": "grader-v4",
  "is_correct": true,
  "grader_confidence": 0.98,
  "verdict_source": "grader"
}
```

`verdict_source` is `grader`, `escalated_grader`, or `human`. Prefer task-level events as the source of truth. AggregationService can derive counts from deduplicated terminal task events, rather than blindly adding worker-supplied cumulative counters that may be repeated or arrive out of order.

**Report example**

```json
{
  "evaluation_id": "eval-123",
  "status": "COMPLETED",
  "total_questions": 500,
  "graded_questions": 500,
  "correct_answers": 425,
  "failed_questions": 0,
  "cancelled_questions": 0,
  "accuracy": 0.85,
  "accuracy_se": 0.016,
  "accuracy_ci95": [0.819, 0.881],
  "se_method": "iid",
  "samples_per_question": 1,
  "coverage": 1.0,
  "escalated_questions": 10,
  "grader": {
    "grader_uuid": "platform-issued-grader-uuid",
    "grader_version": "grader-v4",
    "validation_id": "gval-7",
    "sensitivity": 0.97,
    "specificity": 0.92,
    "kappa_vs_humans": 0.86,
    "same_family_as_model": false
  },
  "corrected_accuracy": {
    "method": "sensitivity_specificity",
    "estimate": 0.865,
    "ci95": [0.822, 0.906]
  }
}
```

Definitions:

- $\text{accuracy} = \dfrac{\text{correct\_answers}}{\text{graded\_questions}}$. This is accuracy under the pinned grader version.
- `accuracy_se` and `accuracy_ci95` follow section 7.1; `se_method` is `iid` or `clustered`.
- `corrected_accuracy` is the estimate of accuracy as humans would judge it (section 7.4). Its interval is wider because it also carries the uncertainty of the calibration set.
- $\text{coverage} = \dfrac{\text{graded\_questions}}{\text{total\_questions}}$
- Failed or unprocessed tasks are not silently counted as incorrect answers. Report coverage and failures separately.
- Escalated tasks count as graded only after they get a final verdict.
- Terminal accounting should satisfy $\text{graded} + \text{failed} + \text{cancelled} = \text{total}$ once the execution is fully terminal.

## 5. Reliability and idempotency

Do not conflate request idempotency, content deduplication, task idempotency, and event deduplication. They solve different failure modes.

### 5.1 API request idempotency

For ingestion and execution creation:

- Scope key by tenant: `(tenant_id, idempotency_key)`.
- Persist the semantic request hash, created resource ID, and original response/status.
- Same key + same request hash: return the original resource/result.
- Same key + different request hash: return `409 Conflict`.
- Ensure resource creation and queue publication cannot be separated by a crash. Use a transactional outbox or a database/queue transaction where supported.

### 5.2 Content deduplication

- Key on normalized dataset content hash plus normalization/schema version and tenant scope as appropriate.
- Different ingestion requests can resolve to the same immutable physical blob where policy permits.
- URL is provenance, not content identity.
- Conditional blob writes and a unique metadata constraint handle concurrent ingestion races.

### 5.3 Task-level idempotency

- Stable task identity: `(execution_id, record_id, sample_idx)`. With one sample per question, `sample_idx` is always 0.
- Use durable task state and conditional state transitions/leases so duplicate queue deliveries do not create duplicate committed results.
- Persist LLM generation attempts independently.
- Once an answer is persisted, retries should resume at grading.
- A grading result identity can be `(generation_id, grader_version, grader_config_hash)`.
- A human label identity is `(generation_id, labeler_id)`. A repeated submission from the same labeler replaces, never adds.

**Exactly-once caveat:** Do not promise exactly-once LLM invocation. A provider may have completed a request even if the worker times out before receiving or persisting the response. Use provider idempotency keys if supported, record attempt IDs, and make result commits idempotent. The practical goal is effectively-once business state, not exactly-once external side effects.

### 5.4 Event delivery

Use a transactional outbox in ExecutionService:

1. Persist task result/state and an outbox event in the same database transaction.
2. An outbox publisher calls AggregationService's event API.
3. Retry transient failures with backoff until accepted.
4. AggregationService stores the event in a deduplicating inbox keyed by `event_id`.
5. Inbox insertion and aggregation state changes must be transactionally coordinated.

This gives at-least-once delivery with idempotent processing; it is not exactly-once network delivery.

```mermaid
sequenceDiagram
    participant W as Execution Worker
    participant DB as Execution DB
    participant O as Outbox Publisher
    participant A as Aggregation API
    participant AD as Aggregation DB / Inbox

    W->>DB: Transaction: save task result + outbox event
    DB-->>W: Commit
    O->>DB: Read unpublished outbox event
    O->>A: POST event (event_id)
    A->>AD: Insert inbox row if event_id is new
    AD-->>A: Inserted or already exists
    A-->>O: 202 Accepted / duplicate acknowledged
    O->>DB: Mark outbox event published
```

### 5.5 Retry semantics by failure point

Every step commits its result before it reports success, and every retry reads the committed state before acting. So a retry after a partial failure finishes the work instead of repeating it.

| Failure point | What the retry does | Cost |
|---|---|---|
| A model call times out, but the provider finished it | Retries with a new `attempt_id`. The answer commit is conditional on the task having no committed answer, so a late response is discarded. | A second billed call, never a second answer. Provider idempotency keys remove it where supported. |
| Generation commits its answer, then the worker dies before the orchestrator records completion | Reads the task first, finds the committed answer for `(execution_id, record_id, sample_idx)`, and returns that `generation_id` without calling the model. | One database read. |
| Grading commits its verdict, then the worker dies | Inserts the verdict only if absent, keyed by `(generation_id, grader_version, grader_config_hash)`, and returns the stored one. | Nothing; grading never reruns generation. |
| The event is re-sent after AggregationService accepted it | The inbox already holds that `event_id`, so the duplicate is acknowledged and dropped. | One extra request. |

When a workflow engine such as Temporal orchestrates the steps, it is the source of truth for orchestration (which step each question is on, timers, retries). The Execution DB stays the source of truth for the domain (answers, attempts, verdicts, outbox). The engine's history holds only IDs, and if the two disagree after a crash, the DB wins.

### 5.6 Execution fingerprint is not an idempotency key

A reproducibility fingerprint can be computed as:

$$
F = H(\text{dataset\_snapshot\_hash},\ \text{model\_config},\ \text{model\_version},\ \text{grader\_uuid},\ \text{grader\_version},\ \text{execution\_config})
$$

It identifies equivalent execution configuration. Do not automatically deduplicate executions by this fingerprint: users may intentionally run the same configuration multiple times as separate experiments. Use the API idempotency key to identify a retried create request. Repeated runs that share $F$ are useful: their spread is the measured run-to-run noise (section 7.6).

## 6. Queueing, backpressure, and scaling

Each service owns its durable queue. A queue absorbs bursts and decouples request latency from processing time; it does not fix sustained overload.

### Queue technology

For task-oriented work, Azure Service Bus or AWS SQS-style queues are a good default: durable delivery, visibility timeout/leases, delayed retries, dead-letter queues, and competing consumers. Kafka is appropriate if ordered event streams, replay, and high-throughput stream processing are core requirements, but it is not necessary merely to distribute background tasks.

### Admission control

- Enforce maximum outstanding jobs/tasks globally, per tenant, and per evaluation.
- Bound both message count and estimated bytes/resource cost.
- Return `429 Too Many Requests` for tenant quota limits; return `503 Service Unavailable` with `Retry-After` for service-wide overload.
- Do not return accepted until the job and its enqueue intent are durably recorded.
- Use fair scheduling or per-tenant queues/weights so a large evaluation cannot starve smaller tenants.

### Worker scaling

Scale on a combination of:

- Queue depth
- Oldest message age
- Queue wait time and end-to-end task latency
- Worker CPU and memory
- External LLM provider rate limits and available concurrency
- Grader CPU/memory consumption

Do not scale solely on queue depth. More workers can overload the LLM provider or saturate grader CPU.

### Provider quota limiter

Every model call is admitted by a limiter inside ExecutionService. It is keyed on the provider's quota, not on the model or the queue: `(provider, account or project, model or deployment)`. Models or deployments that share one quota share one key. Each key holds three budgets:

- **Requests per minute:** a token bucket, charged one per call.
- **Tokens per minute:** a token bucket, charged the prompt size plus `max_tokens` before the call and refunded to actual usage after it.
- **Calls in flight:** a semaphore with leases, so a crashed worker's slot frees itself.

Within a key, tenants get weighted fair shares, so one large evaluation cannot take the whole quota. On a `429`, the limiter honors `Retry-After` and halves that key's in-flight cap, then raises it slowly as calls succeed. A rate limit in the orchestrator (for example a Temporal task-queue limit) can stay as a coarse backstop, but it counts dispatches per second, not tokens or calls in flight, so it cannot replace this limiter.

Throughput is then bounded by the quota, not the worker count. With $C$ calls in flight and $W$ seconds per call, at most $C / W$ calls per second complete. For example, $C = 100$ and $W = 5$ allow 20 calls per second: 144 evaluations of 500 questions per hour, and about 69 hours for 10,000 of them, before retries.

Setting `samples_per_question` to $K$ multiplies generation and grading load by $K$. Admission control must count $K$ when it estimates the cost of an execution.

### Retry policy

- Retry transient network errors, provider 429s, and selected 5xx errors with exponential backoff and jitter.
- Respect provider `Retry-After`.
- Do not retry permanent invalid-request/authentication errors indefinitely.
- Renew queue visibility/leases for long-running work.
- Send poison messages to a dead-letter queue after a bounded number of attempts.
- Make cancellation cooperative and check it between generation/grading stages.

### Capacity example

If arrivals are 1,000 tasks/minute and sustainable processing capacity is 200 tasks/minute, backlog grows by 800 tasks/minute. After five minutes, roughly 4,000 tasks are waiting. The system must apply admission control, increase safe capacity, or reject/defer work; a queue alone cannot make the system stable.

Little's Law: $L = \lambda W$. At $\lambda = 100$ tasks/second and a mean in-system time of $W = 5$ seconds, average in-flight work is $L \approx 500$ tasks. This estimates concurrency, not the provider's allowed throughput.

## 7. Statistical validity and grader alignment

Sections 1 to 6 make the numbers correct under failure: retries and duplicates do not change them. This section makes the numbers meaningful. It answers three questions for every report:

1. How much would this number move if we drew a different set of questions? (7.1, 7.2, 7.6)
2. How well does the grader agree with humans, and where does it not? (7.3)
3. What is the accuracy as humans would judge it, not only as the grader judges it? (7.4, 7.5)

Section 7.7 tests these rules on a public judge with real human labels.

No new service is needed. Calibration sets are datasets (IngestionService). Validation and re-grading are grade-only executions (ExecutionService). All statistics are aggregations (AggregationService).

```mermaid
flowchart LR
    subgraph ING["IngestionService"]
        CALSET[Calibration set<br/>answers + 3 or more human labels]
    end
    subgraph EXE["ExecutionService"]
        GO[Grade-only execution<br/>no generation calls]
        REG[(Grader registry<br/>version, family,<br/>threshold, validation_id)]
        RUN[Evaluation execution]
        AUD[Human audit sample<br/>and escalation queue]
    end
    subgraph AGG["AggregationService"]
        VAL[Grader validation report<br/>sensitivity, specificity, kappa,<br/>HH vs HM per stratum]
        REP[Evaluation report<br/>accuracy, SE, CI,<br/>corrected accuracy]
        CMP[Paired comparison<br/>diff, paired SE, CI]
    end

    CALSET --> GO --> VAL
    VAL -->|validation_id + threshold| REG
    REG -->|pinned grader| RUN
    RUN -->|low confidence or audit sample| AUD
    AUD -->|human verdicts| RUN
    RUN --> REP
    VAL -->|sensitivity, specificity| REP
    REP --> CMP
```

### 7.1 Error bars on every report

Treat the questions as a sample from a larger population of possible questions (Miller, *Adding Error Bars to Evals*, 2024). For binary verdicts $x_i \in \{0, 1\}$ over $n$ questions:

$$
\hat{\mu} = \frac{1}{n}\sum_{i=1}^{n} x_i,
\qquad
\mathrm{SE}(\hat{\mu}) = \sqrt{\frac{\hat{\mu}\,(1 - \hat{\mu})}{n}},
\qquad
\mathrm{CI}_{95} = \hat{\mu} \pm 1.96\,\mathrm{SE}
$$

For small $n$, or for $\hat{\mu}$ near 0 or 1, use a Wilson interval instead.

State what the interval covers. The observed accuracy is an exact score for this benchmark. The interval describes how much it would move if the questions had been drawn again from the same population, and, with $K > 1$, if the model had been sampled again. It does not cover grader error; section 7.4 handles that. When questions are clustered, use the clustered form below, not the binomial one.

At 425 of 500 correct, $\hat{\mu} = 0.85$, $\mathrm{SE} \approx 0.016$, and the 95% interval is $[0.819,\ 0.881]$. Two runs that differ by one point on a 500-question dataset are usually not distinguishable.

**Several samples per question.** With $K$ samples per question, the question score is the mean of its $K$ verdicts, and the standard error uses the spread of question scores:

$$
s_i = \frac{1}{K}\sum_{k=1}^{K} x_{i,k},
\qquad
\hat{\mu} = \frac{1}{n}\sum_{i=1}^{n} s_i,
\qquad
\mathrm{SE}(\hat{\mu}) = \frac{\operatorname{sd}(s_1, \dots, s_n)}{\sqrt{n}}
$$

More samples remove the noise from the model's own sampling. They do not remove the variance that comes from which questions were drawn, so larger $K$ has diminishing returns.

**Clustered questions.** When questions share a passage or template (`cluster_id`), their outcomes are correlated, and the iid standard error is too small. Use the clustered standard error:

$$
\mathrm{SE}_{\text{cluster}}^{2} = \frac{1}{n^{2}} \sum_{c=1}^{C} \left( S_c - n_c\,\hat{\mu} \right)^{2},
\qquad
S_c = \sum_{i \in c} s_i
$$

where $C$ is the number of clusters and $n_c$ is the size of cluster $c$.

**Cost in AggregationService.** Error bars stay $O(1)$ per event. Keep the running sums $\sum_i s_i$, $\sum_i s_i^2$, and $n$ per evaluation, plus $(S_c, n_c)$ per cluster. Per-question state exists only while the $K$ samples of a question are arriving. Finalization is $O(C)$.

### 7.2 Comparing two runs: paired differences

`POST /v1/comparisons` takes two evaluation IDs and returns the difference with its own error bar.

- **Pins must match.** Both evaluations must share the dataset content hash and the grader UUID and version. Otherwise return `422`: a difference would mix a grader change with a model change.
- **Pair by question.** Two models tend to get the same questions right and wrong, so the paired standard error is usually smaller than the one from two independent reports (Miller 2024). Also report the per-question correlation between $A$ and $B$.

  $$
  d_i = s_i^{(A)} - s_i^{(B)},
  \qquad
  \bar{d} = \frac{1}{n}\sum_{i=1}^{n} d_i,
  \qquad
  \mathrm{SE}(\bar{d}) = \frac{\operatorname{sd}(d_1, \dots, d_n)}{\sqrt{n}}
  $$

- **Plan the size.** To detect a difference $\delta$ at 5% significance with 80% power:

  $$
  n \approx \frac{\left(z_{0.975} + z_{0.80}\right)^{2}\,\operatorname{Var}(d)}{\delta^{2}} = \frac{(1.96 + 0.84)^{2}\,\operatorname{Var}(d)}{\delta^{2}}
  $$

  With $\operatorname{Var}(d) = 0.05$, detecting $\delta = 0.02$ needs about 980 questions. Math500 ($n = 500$) resolves about $\delta \approx 0.028$. Read $\operatorname{Var}(d)$ from a past comparison of similar models.

AggregationService already stores per-question outcomes (`TaskOutcome`), so a comparison is a join on `record_id`, with no new data.

### 7.3 Validating the grader against humans

A verdict means "correct under the selected grader version". That grader can be a rule-based answer checker or an LLM judge, and both make errors. For example, a rule-based checker can mark "0.5" wrong when the reference is "1/2". A grader version can be pinned by an execution only after it has a validation report.

**How a validation runs.**

1. Ingest a calibration set (section 4.1): stored model answers, each with at least three independent human labels. The answers should come from the same kinds of models the grader will judge. The best source is the human audit samples from real executions (7.4).
2. ExecutionService runs the grader in grade-only mode on those stored answers. No generation calls are made; a deterministic grader makes no model calls at all, while an LLM judge makes one grading call per answer.
3. AggregationService produces a `GraderValidationReport` keyed by `(grader_uuid, grader_version, grader_config_hash, calibration_snapshot_hash)`.
4. The registry records the report ID and the calibrated confidence threshold. A new grader version needs a new report.

**What the report contains.** Here $Z$ is the human-majority verdict and $\hat{Z}$ is the grader's verdict.

| Metric | Why it is there | Source |
|---|---|---|
| Sensitivity $q_1 = P(\hat{Z} = 1 \mid Z = 1)$ | Input to the bias correction in 7.4 | Lee et al. 2025 |
| Specificity $q_0 = P(\hat{Z} = 0 \mid Z = 0)$ | Same | Lee et al. 2025 |
| Cohen's $\kappa$ against the human majority | Percent agreement counts chance matches as skill. Judges with high percent agreement can still score models very differently. | Thakur et al. 2024 |
| Human-human (HH) vs human-machine (HM) agreement, per human-agreement stratum | One aggregate correlation hides where the grader differs from humans. A grader can look as good as humans only because the humans disagree with each other. | Elangovan et al. 2025 |
| Error overlap between the grader and each evaluated model family | Judges score models that make the same mistakes as themselves higher, and stronger models make more similar mistakes. | Goel et al. 2025; Kim et al. 2025 |

**Stratifying binary labels.** For each item, human agreement $a$ is the fraction of humans who match the majority label. Use two strata: unanimous ($a = 1$) and split ($a < 1$). In each stratum, HH is the mean agreement over pairs of humans, and HM is the mean agreement between the grader and each human, so both compare one rater with one rater. Also report the grader against the human majority, and a random labeler with the grader's pass rate as a floor. Report all of them with the stratum size. The acceptance test is HM against HH in the **unanimous** stratum. There the humans are sure, so a disagreement is a real grader error. A grader that only matches HH in the split stratum is not validated.

**Same-family judges.** The registry stores the judge's model family. If it matches `model_family` in the execution request, the execution is allowed, but the report sets `same_family_as_model: true` and the comparison API refuses to rank models where only one of them shares the judge's family.

### 7.4 Correcting accuracy for grader error

Raw `accuracy` is accuracy under the grader. The report adds `corrected_accuracy`, an estimate of accuracy as humans would judge it, by one of two methods.

**Method A: sensitivity and specificity** (Lee et al., *How to Correctly Report LLM-as-a-Judge Evaluations*, 2025). Let $\hat{p}$ be the raw accuracy under the grader, and take $\hat{q}_0$ and $\hat{q}_1$ from the validation report:

$$
\hat{\theta} = \operatorname{clip}_{[0,1]}\!\left( \frac{\hat{p} + \hat{q}_0 - 1}{\hat{q}_0 + \hat{q}_1 - 1} \right)
$$

The paper gives a closed-form confidence interval that combines the uncertainty of the test set and of the calibration set. It assumes independent items. When items are clustered (several answers per source document, as in most datasets), report a **document-level cluster bootstrap** of $\hat{\theta}$ instead: resample whole documents in both the calibration set and the test set, and recompute $\hat{q}_0$, $\hat{q}_1$ and $\hat{\theta}$ each time. Section 7.7 shows why: on SummEval the closed form covered the true value 69% to 84% of the time, and the cluster bootstrap 93% to 95%. With $\hat{p} = 0.85$, $\hat{q}_1 = 0.97$ (from $m_1 = 300$ positive items) and $\hat{q}_0 = 0.92$ (from $m_0 = 100$ negative items), $\hat{\theta} \approx 0.865$ with a 95% interval of $[0.822,\ 0.906]$, about a third wider than the raw interval (closed form). That extra width is the honest cost of not having human labels on this run. The method assumes $q_0$ and $q_1$ carry over from the calibration answers to this model's answers. If $\hat{q}_0 + \hat{q}_1 - 1 < 0.2$, the correction is unstable: report `corrected_accuracy: null` with the reason. (The 0.2 cut-off is a design choice, not a value from the paper.)

**Method B: prediction-powered inference (PPI) on a human audit sample** (Angelopoulos et al. 2023; Boyeau et al., *AutoEval Done Right*, ICML 2025). With `human_audit_fraction` above 0, a random subset of $n$ of this execution's $N$ answers goes to human labelers. With grader verdicts $\hat{Z}_i$ on all $N$ answers and human verdicts $Z_j$ on the audited $n$:

$$
\hat{\theta}_{\text{PPI}} = \frac{1}{N}\sum_{i=1}^{N} \hat{Z}_i + \frac{1}{n}\sum_{j=1}^{n} \left( Z_j - \hat{Z}_j \right)
$$

$$
\operatorname{Var}\!\left(\hat{\theta}_{\text{PPI}}\right) \approx \frac{\operatorname{Var}(\hat{Z})}{N} + \frac{\operatorname{Var}(Z - \hat{Z})}{n}
$$

It needs no carry-over assumption, because the humans label this model's answers. Method B takes precedence over Method A when the audit has enough labels.

**Budget limit.** Dorner, Nastl and Hardt (*Limits to Scalable Evaluation at the Frontier*, ICLR 2025) show that when the grader is no more accurate than the evaluated model, no debiasing method cuts the needed human labels by more than half. For frontier models, plan the audit budget as at least half the cost of a full human evaluation, not a small fraction.

### 7.5 Selective grading: trust or escalate

Following Jung, Brahman and Choi (*Trust or Escalate*, ICLR 2025), the grader returns a verdict $\hat{Z}$ and a confidence $c$. On the calibration set, choose the threshold $\lambda$ so that, with probability at least $1 - \delta$,

$$
P\left( \hat{Z} = Z \;\middle|\; c \ge \lambda \right) \ge 1 - \alpha
$$

The paper does this with fixed sequence testing.

- $c \ge \lambda$: the verdict stands (`GRADED`).
- $c < \lambda$: the task moves to `ESCALATED`. It is re-graded by a stronger grader version with its own threshold, then by a human if still uncertain.
- The report shows `escalated_questions` and the guarantee $(\alpha, \delta)$ for the verdicts that were not escalated.

For an LLM judge, confidence can be the agreement rate over several sampled judge verdicts, but only after it is calibrated against human labels. Section 7.7 found that sampling agreement barely tracks human agreement. For a rule-based grader, confidence is 1 except when it cannot parse the answer, which escalates. Escalation trades latency and human cost for a stated agreement level. The `ESCALATED` share is a cost signal: if it grows, the grader needs work.

### 7.6 Run-to-run noise and dataset choice

Executions with the same fingerprint $F$ (section 5.6) measure **noise**: how much the score moves when nothing changes but sampling. Executions of different models or checkpoints on the same dataset measure **signal**: how far apart the dataset spreads models. Heineman et al. (*Signal and Noise*, AI2, NeurIPS 2025) show that datasets with a higher signal-to-noise ratio give more reliable decisions from small experiments. AggregationService can report this ratio per dataset content hash, to pick which datasets drive go/no-go decisions.

### 7.7 Evidence: a public judge against expert labels

To test sections 7.3 to 7.5 on real data, I measured GPT-4 as a judge (G-Eval, 20 sampled scores per item) against the three SummEval expert annotators: 1,600 summaries of 100 news articles from 16 systems, on four dimensions. Each score is turned into a 0/1 verdict to match this platform: pass means a score of 4 or 5 on a 1-to-5 scale (3 on fluency's 1-to-3 scale), and the judge passes an item when more than half of its samples pass. The script is `scripts/study-eval-alignment/analyze.py` in the site repository. It pins its inputs by commit and SHA-256, and every interval is a document-level cluster bootstrap.

**Alignment is three properties, not one number.**

| Property | Question | Measure |
|---|---|---|
| Calibration | Does the judge pass items as often as humans do? | pass rate, sensitivity $q_1$, specificity $q_0$ |
| Discrimination | Does the judge rank clearly good items above clearly bad ones? | AUC on items where all experts agree |
| Rater equivalence | Could the judge replace one expert? | judge-expert vs expert-expert agreement and $\kappa$, per agreement stratum |

**What the data shows.**

- **Calibration fails.** The judge is much harsher than the experts. Its pass rate is 13% vs 49% for coherence, 63% vs 90% for consistency, 69% vs 91% for fluency, and 32% vs 69% for relevance. Specificity is high (0.82 to 0.97); sensitivity is low (0.23 to 0.75). For coherence, $\hat{q}_0 + \hat{q}_1 - 1 = 0.20$, right at the cut-off in 7.4.
- **Discrimination mostly holds.** On items where all three experts agree, the judge's AUC is 0.83 to 0.94. With its threshold refit on half of the documents and tested on the other half, agreement on those items rises to 0.77 to 0.95, and judge-expert $\kappa$ rises from 0.16–0.31 to 0.33–0.54. Expert-expert $\kappa$ is 0.33 to 0.89.
- **Human uncertainty hides the gap.** On items where the experts split 2 to 1, two experts agree only $1/3$ of the time by construction, so the judge looks better than the humans (0.42 to 0.51 agreement). A random labeler with the judge's pass rate scores 0.42 to 0.48 there, and the judge's $\kappa$ on those items is 0.00 to 0.03. The judge's "advantage" on uncertain items is arithmetic, not skill. The share of split items ranges from 3% (consistency) to 49% (relevance), so pooled agreement is not comparable across dimensions.
- **System rankings survive; item verdicts do not.** Kendall $\tau$ between judge and expert system rankings is 0.58 to 0.88, while item-level $\kappa$ is 0.16 to 0.31. A judge can be fit to rank systems and unfit to grade single items.
- **The correction works, but the closed-form interval does not.** Correcting the pass rate with $q_0$ and $q_1$ from half of the documents cut the error from 0.21–0.38 to 0.04–0.12. The closed-form 95% interval covered the truth only 69% to 84% of the time. A document-level cluster bootstrap covered it 93% to 95%, at 1.3 to 1.7 times the width.
- **Sampling agreement is weak confidence.** Keeping only verdicts where all 20 judge samples agree raised agreement by at most 0.08, at 45% to 72% coverage, and barely changed the share of split items among the kept verdicts. It cannot stand in for the calibrated confidence that 7.5 needs.

**What changes in the design.** Validation reports must include the stratified table and a discrimination measure, not only a pooled agreement (7.3). Corrected accuracy uses the cluster bootstrap interval (7.4). Judge confidence used for escalation must be calibrated against humans before it gates anything (7.5).

## 8. Data model sketch

| Service | Core records |
|---|---|
| IngestionService | `Ingestion`, `DatasetSnapshot`, `DatasetManifest`, `IdempotencyRecord` (calibration sets are snapshots with schema `calibration-1`) |
| ExecutionService | `Execution`, `Task` (with `sample_idx`), `GenerationAttempt`, `GradingResult` (with `confidence`, `verdict_source`), `HumanLabel`, `GraderRegistryEntry` (with `model_family`, `validation_id`, `confidence_threshold`), `OutboxEvent`, `IdempotencyRecord` |
| AggregationService | `Evaluation`, `EventInbox`, `TaskOutcome`, `QuestionScore`, `ClusterSums`, `AggregateCounters`, `Report`, `GraderValidationReport`, `Comparison` |

Keep ownership strict: each service is the only writer/reader of its own database. Other services obtain information through documented APIs or immutable external blob references with explicit authorization.

## 9. Key trade-offs and decisions

1. **Why async APIs?** Dataset downloads, model calls, and grading can take minutes. Return `202 Accepted` and expose durable status APIs rather than holding client connections open.
2. **Why snapshot datasets?** A URL can change. An immutable content-addressed snapshot ensures an evaluation is reproducible.
3. **Why let ExecutionService read Blob Storage directly?** It avoids routing large dataset payloads through IngestionService and keeps ingestion out of the hot execution path.
4. **Why not put model configuration in ingestion?** Dataset ingestion is reusable and independent of a particular model or grader.
5. **Why resolve a grader UUID?** The platform controls the mapping from identifier to approved, versioned grader code; callers cannot supply arbitrary executable code.
6. **Why not call AggregationService directly and assume success?** Network failures can occur after a task result is committed. The outbox/inbox pattern supports retryable delivery and deduplication.
7. **Why not claim exactly-once?** External LLM calls have ambiguous outcomes after timeouts. Persist attempts and idempotently commit internal state instead.
8. **Why report accuracy and coverage separately?** Failed or unprocessed questions should not silently distort the accuracy denominator.
9. **Why an error bar on every report?** On 500 questions at 85%, $\mathrm{SE} \approx 0.016$. Without it, readers treat noise as progress.
10. **Why compare only runs with matching pins, and pair by question?** A different grader version confounds the comparison. Pairing removes the shared question difficulty and shrinks the SE.
11. **Why validate graders with kappa and agreement strata, not one correlation?** Percent agreement and aggregate correlation look good when labels are skewed or humans are unsure. The unanimous stratum is where grader errors are unambiguous.
12. **Why report a corrected accuracy next to the raw one?** Raw accuracy measures the grader as much as the model. The corrected value, with its wider interval, is the claim about the model.
13. **Why escalate instead of forcing a verdict?** A forced low-confidence verdict hides grader error inside the average. Escalation turns it into a visible cost with a stated agreement guarantee.

## 10. Scope boundaries

- Only three internal services: IngestionService, ExecutionService, AggregationService.
- LLM generation endpoint is an external provider API, called by ExecutionService workers.
- Blob Storage is external managed storage, not a microservice.
- The Python grader is a library/runtime dependency inside ExecutionService workers, not a microservice.
- Each internal service owns its own database and queue.
- Service-to-service communication is through APIs only; no cross-service database or queue access.
- The client can orchestrate the two initial calls: ingest dataset, wait for `READY`, then create execution. Add a separate workflow/orchestration service only if the problem explicitly requires server-side orchestration; it is outside this three-service design.
- Human labeling is an external workflow. The platform defines what gets labeled (calibration sets, audit samples, escalations) and accepts the labels through APIs. It does not run the labeling tool.

## 11. References

- Miller, E. (2024). Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations. arXiv:2411.00640.
- Elangovan, A., et al. (2025). Beyond Correlation: The Impact of Human Uncertainty in Measuring the Effectiveness of Automatic Evaluation and LLM-as-a-Judge. ICLR 2025. arXiv:2410.03775.
- Thakur, A. S., et al. (2024). Judging the Judges: Evaluating Alignment and Vulnerabilities in LLMs-as-Judges. arXiv:2406.12624.
- Jung, J., Brahman, F., Choi, Y. (2025). Trust or Escalate: LLM Judges with Provable Guarantees for Human Agreement. ICLR 2025. arXiv:2407.18370.
- Lee, C., Zeng, T., Jeong, J., Sohn, J., Lee, K. (2025). How to Correctly Report LLM-as-a-Judge Evaluations. arXiv:2511.21140.
- Boyeau, P., et al. (2025). AutoEval Done Right: Using Synthetic Data for Model Evaluation. ICML 2025. arXiv:2403.07008.
- Dorner, F. E., Nastl, V. Y., Hardt, M. (2025). Limits to Scalable Evaluation at the Frontier: LLM as Judge Won't Beat Twice the Data. ICLR 2025. arXiv:2410.13341.
- Goel, S., et al. (2025). Great Models Think Alike and this Undermines AI Oversight. ICML 2025. arXiv:2502.04313.
- Kim, E., Garg, A., Peng, K., Garg, N. (2025). Correlated Errors in Large Language Models. ICML 2025. arXiv:2506.07962.
- Heineman, D., et al. (2025). Signal and Noise: A Framework for Reducing Uncertainty in Language Model Evaluation. NeurIPS 2025. arXiv:2508.13144.
- Fabbri, A. R., et al. (2021). SummEval: Re-evaluating Summarization Evaluation. TACL 9. arXiv:2007.12626.
- Liu, Y., et al. (2023). G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment. EMNLP 2023. arXiv:2303.16634.
