# ReachInbox Email Scheduler

A production-grade email scheduling service: an Express + TypeScript API that
persists campaigns to Postgres and hands each recipient to BullMQ as a
**delayed job on Redis**, a separate worker process that drains that queue
through pooled Ethereal SMTP transports under per-sender hourly rate limits,
and a Next.js 16 dashboard authenticated with Google OAuth. Postgres is the
single source of truth for *what* to send and *when*; Redis owns only the
timing, and any drift between the two is repaired by a one-shot reconciliation
pass at worker boot. There is no cron, no polling loop and no scheduler table
anywhere in the codebase — the delay **is** the schedule.

---

## Quick start

Copy-pasteable, in order. **PowerShell users: use `;` between commands, not
`&&`** — `&&` is a parser error in Windows PowerShell 5.1.

```bash
# 0. clone and enter
cd reachinbox-scheduler

# 1. infrastructure (Postgres 16 + Redis 7, both with volumes)
docker compose up -d
docker compose ps                  # wait until BOTH say "healthy"
```

> **The Redis host port is `6380`, not 6379.** Port 6379 was already claimed on
> the development machine, so `docker-compose.yml` publishes `6380:6379`. The
> container still listens on 6379 internally; only the host binding moved, and
> `backend/.env.example` sets `REDIS_PORT=6380` to match. If 6379 is free on
> your machine you can move both back.

```bash
# 2. backend
cd backend
npm install
cp .env.example .env               # PowerShell: copy .env.example .env
#    -> now fill in JWT_SECRET, GOOGLE_CLIENT_ID/SECRET and SMTP_ACCOUNTS
#       (see the two setup sections below)

npm run prisma:generate
npx prisma migrate deploy          # or: npm run prisma:migrate  (dev, interactive)
npm run db:seed                    # creates Sender rows from SMTP_ACCOUNTS

# 3. API — leave this running
npm run dev                        # http://localhost:4000
```

```bash
# 4. WORKER — a SEPARATE PROCESS in its OWN TERMINAL.
#    This is not optional and it is not started by `npm run dev`.
#    The API only writes rows and enqueues delayed jobs; nothing is ever
#    sent until this process is running. If emails sit in Scheduled forever,
#    this is the thing that isn't running.
cd backend
npm run worker
```

```bash
# 5. frontend — a third terminal
cd frontend
npm install
cp .env.local.example .env.local   # PowerShell: copy .env.local.example .env.local
#    -> fill in NEXTAUTH_SECRET and the SAME Google client id/secret
npm run dev                        # http://localhost:3000
```

Health check:

```bash
curl http://localhost:4000/health
# {"ok":true,"ts":"2026-08-27T04:17:55.055Z"}
```

Then open <http://localhost:3000>, sign in with Google, and compose.

### Terminal layout

| Terminal | Directory | Command | Purpose |
| --- | --- | --- | --- |
| 1 | `backend/` | `npm run dev` | API on :4000 |
| 2 | `backend/` | `npm run worker` | **the sender** — drains the queue |
| 3 | `frontend/` | `npm run dev` | dashboard on :3000 |
| 4 | anywhere | `docker compose logs -f` / `psql` / `curl` | poking at it |

---

## Ethereal setup

[Ethereal](https://ethereal.email) is a fake SMTP service by the Nodemailer
author. It accepts real SMTP conversations and captures the message instead of
delivering it, so nothing ever reaches a real inbox — which is exactly what you
want when a bug might send a thousand emails.

1. Go to <https://ethereal.email/create>.
2. Press **Create Ethereal Account**. You get a username, a password, and the
   host/port (`smtp.ethereal.email`, `587`).
3. Repeat once or twice more. **Two or three accounts is the interesting
   configuration** — the scheduler round-robins across active senders, and a
   single account never exercises that path.
4. Put them into `backend/.env` as `SMTP_ACCOUNTS`, **a JSON array on ONE
   line** (the env parser reads it with `JSON.parse`, so a newline inside the
   value will break it):

```dotenv
SMTP_ACCOUNTS=[{"user":"x@ethereal.email","pass":"y","host":"smtp.ethereal.email","port":587,"fromName":"Oliver Brown"},{"user":"z@ethereal.email","pass":"w","host":"smtp.ethereal.email","port":587,"fromName":"Amelia Shaw"}]
```

Every field is required and validated element-by-element at boot
(`smtpAccountSchema` in `src/config/env.ts`); a malformed entry names itself in
the startup error rather than failing on the 500th email.

5. `npm run db:seed` after any change. Seeding is idempotent and keyed on the
   account address, and it **deactivates** any Sender row no longer present in
   `SMTP_ACCOUNTS` rather than deleting it (past `EmailJob` rows must keep
   pointing at the account that actually sent them).

> **Ethereal credentials expire.** Accounts are disposable and are reaped after
> a period of inactivity. If the worker refuses to start with
> `No SMTP sender verified`, or you see `EAUTH` / `535` in the logs, the
> accounts are dead: create new ones, replace `SMTP_ACCOUNTS`, and re-run
> `npm run db:seed`. This is expected and is the single most likely reason a
> fresh checkout won't send.

Every successful send stores a `previewUrl`
(`https://ethereal.email/message/…`) on the row, and the dashboard's Sent list
links straight to it.

---

## Google OAuth setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and
   create (or pick) a project.
2. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - Fill in app name, support email, developer email.
   - **Audience → Test users → Add users: add your own Google address.** While
     the app is in `Testing`, Google rejects sign-in from any account not on
     that list with `access_denied`. This is the most common setup failure.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorised JavaScript origins:**
     ```
     http://localhost:3000
     ```
   - **Authorised redirect URIs:** (exact, including the path — NextAuth builds
     this itself and Google matches it character for character)
     ```
     http://localhost:3000/api/auth/callback/google
     ```
4. Copy the client ID and client secret into **both** env files.

> ### The critical detail: `GOOGLE_CLIENT_ID` must be IDENTICAL in
> ### `backend/.env` and `frontend/.env.local`.
>
> The frontend does not forward a session — it forwards Google's **ID token**
> to `POST /api/auth/google`, and the backend verifies that token with
> `OAuth2Client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID })`.
> An ID token's `aud` claim is the client id it was minted for. If the two
> files hold different client ids, Google issues a perfectly valid token that
> the backend rejects as having the wrong audience, and login fails with a
> `401` that looks like a credentials problem but isn't. Same id, both files.
> The *secret* only needs to be correct on the frontend (NextAuth performs the
> code exchange); the backend takes the secret for completeness but verifies
> with the id.

`frontend/.env.local` also needs `NEXTAUTH_SECRET` — any random string will do
locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Environment variable reference

### `backend/.env`

| Variable | Default | What it does |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production`. |
| `PORT` | `4000` | API listen port. |
| `DATABASE_URL` | *required* | Postgres connection string. Matches `docker-compose.yml`. |
| `REDIS_HOST` | `localhost` | Redis host for BullMQ and the rate limiter. |
| `REDIS_PORT` | `6380` | Value shipped in `.env.example`, matching `docker-compose.yml`'s `6380:6379` host binding. The zod schema falls back to `6379` if unset, so do not leave it blank. |
| `REDIS_PASSWORD` | *(empty)* | Optional; unset for the local container. |
| `JWT_SECRET` | *required* | Signs the API's own session JWT (7-day TTL). |
| `GOOGLE_CLIENT_ID` | *required* | ID-token **audience**. Must equal the frontend's. |
| `GOOGLE_CLIENT_SECRET` | *required* | Present for completeness; verification uses the id. |
| `FRONTEND_URL` | `http://localhost:3000` | The single allowed CORS origin. |
| `WORKER_CONCURRENCY` | `5` | Jobs the worker may hold in flight at once. |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | Floor on the gap between send **starts**, queue-wide. |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `100` | Hourly cap per SMTP account (a `Sender.hourlyLimit` overrides it). |
| `MAX_EMAILS_PER_HOUR_GLOBAL` | `500` | Hourly cap across all senders. |
| `RATE_LIMIT_STRATEGY` | `per_sender` | `per_sender` \| `global` \| `both`. `both` is all-or-nothing. |
| `SMTP_ACCOUNTS` | *required* | JSON array of `{user,pass,host,port,fromName}`, one line. |
| `MAX_JOB_ATTEMPTS` | `3` | BullMQ retry attempts, exponential from 5s. |
| `STUCK_JOB_THRESHOLD_MS` | `120000` | How stale `lockedAt` must be before reconciliation reclaims a `PROCESSING` row. **Must exceed the worker's 60s lock duration.** |
| `RECONCILE_ON_BOOT` | `true` | Escape hatch to skip the boot repair pass. Leave it on. |

Config is parsed once through zod in `src/config/env.ts`, which fails at
startup listing every bad or missing variable. Nothing in the codebase reads
`process.env` directly.

### `frontend/.env.local`

| Variable | Default | What it does |
| --- | --- | --- |
| `NEXTAUTH_URL` | `http://localhost:3000` | Base URL NextAuth builds callbacks from. |
| `NEXTAUTH_SECRET` | *required* | Encrypts the NextAuth session cookie. |
| `GOOGLE_CLIENT_ID` | *required* | **Must be byte-identical to the backend's.** |
| `GOOGLE_CLIENT_SECRET` | *required* | Used by NextAuth for the code exchange. |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Backend base URL used by the browser client. |

---

## Architecture

```
┌───────────────────────┐
│  Next.js 16 dashboard │  Google OAuth (NextAuth) -> Google ID token
│  :3000                │  exchanged at POST /api/auth/google for an API JWT
└───────────┬───────────┘
            │  HTTPS/JSON, Bearer <api jwt>
            ▼
┌───────────────────────────────────────────────────────────────┐
│  Express + TypeScript API  :4000                              │
│  zod validation · server-side HTML sanitisation · ownership   │
│  enforced in every WHERE clause                               │
└───────────┬───────────────────────────────┬───────────────────┘
            │ 1. write, in ONE transaction  │ 2. AFTER commit
            ▼                               ▼
┌────────────────────────────┐   ┌──────────────────────────────┐
│  POSTGRES                  │   │  REDIS  (BullMQ)             │
│  ── SOURCE OF TRUTH ──     │   │  ── TIMING ONLY ──           │
│  Campaign                  │   │  one DELAYED job per email,  │
│  EmailJob (status,         │◀─ │  jobId = idempotencyKey,     │
│    scheduledAt, attempts,  │   │  payload = 3 ids, no content │
│    idempotencyKey, …)      │   │  + hourly counters (Lua)     │
│  Sender · RateLimitWindow  │   │  + the min-spacing limiter   │
└────────────┬───────────────┘   └──────────────┬───────────────┘
             │                                  │  job becomes due
             │  reconcileOnBoot()               ▼
             │  (one-shot, at worker  ┌──────────────────────────┐
             └───────────────────────▶│  WORKER  (own process)   │
                repairs any drift     │  concurrency 5           │
                                      │  1) re-read row from PG  │
                                      │  2) hourly limit (Lua)   │
                                      │  3) conditional claim    │
                                      │  4) send                 │
                                      └────────────┬─────────────┘
                                                   │ pooled SMTP
                                                   ▼
                                      ┌──────────────────────────┐
                                      │  ETHEREAL SMTP           │
                                      │  -> previewUrl back to   │
                                      │     the EmailJob row     │
                                      └──────────────────────────┘
```

### How scheduling works

Every recipient becomes one `EmailJob` row with an authoritative
`scheduledAt`, and one BullMQ job added with
`delay = scheduledAt - Date.now()`. Redis wakes the worker at the right
moment; nothing polls, nothing sweeps a table looking for due rows, and there
is **no cron, no repeatable job and no interval timer in the codebase**. The
only periodic-looking thing in the system is `reconcileOnBoot()`, and it runs
exactly once per worker start, before the worker consumes anything.

**The job payload is deliberately thin** — three ids
(`emailJobId`, `campaignId`, `idempotencyKey`) and a deferral counter. No
subject, no body, no recipient address:

- A job may sit in Redis for hours. Reading content from the payload would
  send whatever was true when it was enqueued; reading it from Postgres at
  process time sends what is true *now*, so an edited or cancelled campaign
  actually takes effect.
- Redis stays small, and the payload is safe to log.
- Postgres remains the only place a body lives, so sanitisation has exactly one
  boundary to guard.

**Enqueue happens after the transaction commits, never inside it.** This is an
asymmetry, and it is the deliberate direction:

| Failure | Result | Recoverable? |
| --- | --- | --- |
| Enqueue inside the tx, tx rolls back | Redis holds jobs pointing at rows that don't exist | The worker can't fix it — it can only log and drop |
| Enqueue after commit, process dies between | Postgres holds `SCHEDULED` rows with no queue entry | **Yes** — boot reconciliation scans for exactly this and re-adds them |

Prefer the failure the system can repair over the one it cannot. Rows without
jobs are benign and self-healing; jobs without rows are garbage that only ever
gets logged and discarded.

### Persistence across restarts

Postgres is durable. Redis is *mostly* durable. The two can drift in exactly
three ways, and `reconcileOnBoot()` in
`backend/src/services/reconciliation.service.ts` handles all three before the
worker consumes its first job:

| Drift case | Cause | Repair |
| --- | --- | --- |
| **1. Stuck `PROCESSING`** | The process died between claiming a row and writing the result. The row says `PROCESSING` forever; no job is active. | Rows whose `lockedAt` is staler than `STUCK_JOB_THRESHOLD_MS` (120s, deliberately > the worker's 60s lock duration) go back to `SCHEDULED` and are re-queued. `attempts` is **not** reset — a row that crashed mid-send genuinely consumed an attempt, and pretending otherwise lets a poison message loop forever. |
| **2. Missing jobs** | Redis was flushed, the AOF was lost, or the container was recreated. Rows say `SCHEDULED` but no BullMQ job exists, so those emails would never send. | Every claimable row is checked against its candidate job ids (base key + each `-dN` deferral child). Missing ⇒ re-added **with its original `scheduledAt`**, so a restart changes nothing about when an email goes out. |
| **3. Past due** | The whole system was down when a job should have fired. | Re-added with `delay: 0` plus a `sequence × 50ms` stagger, so the backlog fires immediately but in order rather than as one stampede. |

A fourth case is handled quietly along the way: a BullMQ job that finished
(`completed`/`failed`) while its row still says `SCHEDULED` is an **orphan**.
The id is removed before re-adding, because `add()` would otherwise dedupe
against the dead entry, silently create nothing, and lose the email.

The scan is cursor-paged at 500 rows. The headline scenario is 1000+ emails
queued at once, and a recovering system can hold far more than that in
`SCHEDULED`; an unbounded `findMany()` would pull the entire backlog into
memory at the exact moment the process is least able to absorb a spike.

#### The honest AOF finding

Redis runs with `--appendonly yes --appendfsync everysec`. Testing the restart
scenario produced a result worth stating plainly rather than dressing up:

- **A graceful `docker compose restart redis` needs no repair at all.** Redis
  replays its append-only file on boot and the delayed jobs come back intact.
  Reconciliation runs, scans, finds every row already represented by a live
  job, and reports `skipped-already-queued` across the board. That is a real
  result, not a weak one — AOF is doing its job — but it means the restart demo
  proves durability, not reconciliation.
- **Reconciliation only earns its keep when Redis genuinely loses state**: a
  deleted volume, a container recreated without one, or a `FLUSHALL`. That is
  the case worth demonstrating. Wiping the `reachinbox:*` keyspace and
  restarting the worker, reconciliation **re-queued 6 of 6 emails, each with
  its original send time preserved**, and all six subsequently sent on
  schedule.

So: AOF covers the common restart, reconciliation covers the uncommon disaster,
and the system needs both. Claiming reconciliation saves you from an ordinary
worker restart would be overselling it — an ordinary worker restart never lost
anything in the first place, because the jobs live in Redis, not in the worker.

### Rate limiting

Two independent mechanisms, because one cannot express the other:

**BullMQ's built-in limiter** (`{ max: 1, duration: MIN_DELAY_BETWEEN_EMAILS_MS }`)
is a single queue-wide bucket whose state lives in Redis, so it holds across
multiple worker processes. It is exactly right for "at least 2 seconds between
emails" and useless for "N per hour per sender" — there is one bucket, not one
per sender, and no way to key it per job.

**The hourly cap** is therefore a separate Redis check run inside the
processor, driven by a **Lua script**:

```lua
local n = #KEYS
for i = 1, n do                                    -- CHECK every scope
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  if current >= tonumber(ARGV[i]) then
    return {0, i}                                  -- blocked; nothing incremented
  end
end
for i = 1, n do                                    -- only then INCREMENT all
  local value = redis.call('INCR', KEYS[i])
  if value == 1 then redis.call('EXPIRE', KEYS[i], tonumber(ARGV[n + 1])) end
end
return {1, 0}
```

- **Why atomicity matters.** Check-then-increment across a network is a
  read-modify-write race: two workers both read 99/100 and both send, taking
  the sender to 101. A Lua script executes as one indivisible step inside
  Redis, so the check and the increments cannot interleave no matter how many
  workers are running. **Verified: 50 concurrent `tryConsume` calls against a
  limit of 10 admitted exactly 10 and rejected 40.** Without the script that
  test admits somewhere between 10 and 50 depending on timing.
- **Why check-all-then-increment-all.** Under `RATE_LIMIT_STRATEGY=both` the
  script verifies *every* scope before touching *any*. A naive implementation
  that incremented the sender scope before discovering the global scope was
  exhausted would silently burn that sender's quota for an email that never
  went out — over a busy hour that leaks a large fraction of per-sender
  capacity. The behaviour is all-or-nothing by construction, not by convention.
- **Hour-window keys.** Counters are keyed
  `reachinbox:ratelimit:<scope>:<YYYY-MM-DDTHH>` (UTC) with a 2-hour TTL — one
  full window plus margin, so keys self-expire and no sweeper is needed. The
  window "resets" simply by the next hour's key not existing yet.
- **The Postgres mirror.** `RateLimitWindow` records the same counts durably.
  Redis stays the hot path and the sole authority for admission decisions; the
  mirror is the record that survives a Redis flush and can be inspected after
  the fact. It is written fire-and-forget and its failure is logged at `warn` —
  a slow mirror write must never delay or fail an email.
- **Being rate limited is not an error.** A blocked job is not failed, not
  dropped and not retried by BullMQ. It is re-enqueued with
  `delay = (time until the hour rolls over) + sequence × 50ms`, its row stays
  `SCHEDULED` with `scheduledAt` moved forward, and `attempts` is untouched —
  so waiting through ten windows can never exhaust a job's retry budget.

**The consume-before-send trade-off.** The slot is reserved *before* the SMTP
conversation starts. If the process is killed mid-send, that slot stays
consumed and we very slightly **under**-send for the hour. Incrementing after a
successful send instead would let N concurrent workers all pass the check and
blow straight through a provider's cap — which gets an account suspended.
Under-sending is recoverable; exceeding a provider limit is not. A `refund()`
path exists for the one case where we can *prove* SMTP was never contacted
(the claim guard rejected the row after admission), and is never used for a
failed send, because the provider saw that attempt and counted it.

### Concurrency & delay — the subtlest point in the build

The configuration is `WORKER_CONCURRENCY=5` **with** `limiter: { max: 1,
duration: 2000 }`. Those look contradictory. They are not, and the distinction
is worth getting exactly right:

> **The limiter caps job STARTS. Concurrency caps jobs IN FLIGHT.**

BullMQ starts at most one job per 2000ms, queue-wide. Once started, a job runs
to completion on its own; a slow 8-second SMTP handshake does **not** stop the
next job starting 2 seconds later. With concurrency 5, up to five sends can
therefore overlap.

This produces two different timelines, and reading the wrong one makes the
system look broken:

| Column | What it measures | What it looks like |
| --- | --- | --- |
| `lockedAt` | when the worker **claimed** the job — i.e. when the send *started* | evenly spaced, ~2000ms apart |
| `sentAt` | when SMTP **accepted** the message | interleaved and out of order, because five sends overlap and finish whenever the network says so |

**Measured across 12 consecutive jobs, the `lockedAt` gaps were 1999–2024ms** —
a 2000ms floor with single-digit-millisecond scheduling jitter. A re-measurement
after the changes in this pass gave **1992–2025ms across 12 consecutive jobs**:
a spread of 33ms around the floor.

The `sentAt` column from that same run tells a different and much noisier
story — **gaps of 1756–2232ms, a spread of 476ms**, because each figure carries
that individual SMTP conversation's latency (the sends themselves took
1835–2133ms). And that is the *mild* case. Because up to five sends run
concurrently, any send that takes longer than the spacing lets the next one
finish first, and then `sentAt` stops being ordered at all. Nothing is wrong
when that happens; completion order simply is not send order.

So: **when demonstrating or asserting the delay guarantee, measure `lockedAt`
gaps, not `sentAt` gaps.** `lockedAt` is the schedule. `sentAt` is the
completion timeline of up to five parallel conversations, and reading it as the
schedule makes a correct system look broken.

Corollary worth stating plainly: **raising concurrency does not raise
throughput.** Throughput is pinned at `1 / MIN_DELAY_BETWEEN_EMAILS_MS` by the
limiter. Concurrency only buys tolerance for slow individual sends. To send
faster, lower the minimum delay.

### Idempotency

Every email carries `idempotencyKey = sha256(campaignId : recipientEmail :
sequence)` — deterministic, hex (BullMQ reserves `:` in custom job ids), and
`@unique` in Postgres. Two layers use it:

**Layer 1 — BullMQ `jobId` dedupe.** The job id *is* the idempotency key, and
BullMQ treats a custom id as unique: adding it twice returns the existing job
rather than creating a second one. A retried API call, a double-submitted form,
or a reconciliation pass that re-adds everything on boot is a no-op.

**Layer 2 — the conditional claim.** Layer 1 covers "the same job added twice".
It does *not* cover "two workers racing on the same job" — a stalled-lock
redelivery, or simply two worker processes. So before sending, the processor
runs one conditional `updateMany`:

```ts
const claim = await prisma.emailJob.updateMany({
  where: { id: emailJobId, status: { in: ['SCHEDULED', 'QUEUED'] } },
  data:  { status: 'PROCESSING', lockedAt: new Date(), attempts: { increment: 1 } },
});
if (claim.count === 0) return;   // someone else has it, or it's already terminal
```

Postgres serialises concurrent updates to a single row, so of N racers exactly
one sees `count === 1`; every other one sees `count === 0` because the status
no longer matches the `WHERE`. A `SELECT` followed by an `UPDATE` would be the
classic read-modify-write race — putting the test and the write in **one
statement** is precisely what closes it. **Verified: 4 processors racing the
same job, exactly 1 claimed and sent; the other 3 returned without sending and
refunded their rate-limit slots.**

**Deferral child ids (`-dN`).** When the hourly limiter defers a job, it cannot
re-add under `idempotencyKey` — that job is *active right now*, so the add
would collide with the very job it is inside, create nothing, and silently lose
the email. Each deferral therefore mints `${idempotencyKey}-d${n}` from a
monotonic counter carried in the payload.

**Why the counter and not the target hour window.** An id derived from the hour
it is deferred *into* can collide with itself: if a delayed job fires a moment
**before** its target window opens (ordinary timer skew at an hour boundary),
it recomputes the very window it is already named after, the re-add dedupes
against itself, nothing is queued — and that email is gone. A strictly
increasing counter can never equal its parent's id regardless of clock
behaviour, while staying deterministic, so two concurrent processors deferring
the same job still compute the same child id and collapse into one entry.
Reconciliation reconstructs the full candidate id list by reading the `-dN`
suffix off `bullJobId`.

### Behaviour under load — 1000 emails scheduled for the same instant

With `MAX_EMAILS_PER_HOUR_PER_SENDER=100` and one sender:

All 1000 jobs become due at once and the worker starts draining, spaced by the
BullMQ limiter at one start per 2 seconds.

- **Hour 0** — the first 100 jobs call `tryConsume`, each finds the counter
  below 100, increments, and sends. Job 101 finds the counter at 100. It is
  **not** failed and **not** dropped: it is re-enqueued with a delay of
  `(time until the hour rolls over) + sequence × 50ms`, its row stays
  `SCHEDULED`, and `scheduledAt` moves forward. Jobs 101–1000 all take that
  path. **100 sent, 900 deferred.**
- **Hour 1** — the counter key has expired, so the first 100 of the deferred
  set consume the fresh window and send. **800 deferred.**
- **Hours 2–9** — 100 per hour, until the last 100 go out in hour 9. Total
  drain ≈ 10 hours.

Properties that hold throughout:

- **Nothing is dropped.** A rate-limited job is always re-enqueued.
- **Nothing is duplicated.** Deterministic `-dN` child ids (layer 1) plus the
  conditional claim (layer 2).
- **Nothing is marked `FAILED`.** `attempts` is never incremented by a rate
  limit, so hitting the cap can never exhaust a job's retries.
- **Order is approximately preserved.** The `sequence × 50ms` stagger brings a
  spill group back in ascending sequence order. This is approximate, not FIFO:
  jobs 50ms apart can still be reordered by worker scheduling, and beyond
  `MAX_JITTER_MS` (300s) the offsets clamp, so very large campaigns lose the
  property in their tail. Strict ordering would need one sequential consumer
  per campaign, costing all the parallelism.

With two active senders the round-robin halves each sender's share, so the same
1000 emails drain in ≈5 hours — and the per-sender counters stay independent.

---

## Features implemented

### Backend

- [x] **Node.js + TypeScript backend** — Express 5, `strict` TypeScript, ESM.
- [x] **API to schedule emails** — `POST /api/campaigns` takes recipients,
      subject, HTML body, start time, spacing and an hourly cap.
- [x] **Recipients, subject, body, scheduled time** — persisted per recipient
      as an `EmailJob` row with its own authoritative `scheduledAt`.
- [x] **Emails stored in a database** — Postgres via Prisma; `Campaign`,
      `EmailJob`, `Sender`, `User`, `RateLimitWindow`.
- [x] **Queue for scheduled sending** — BullMQ on Redis, one **delayed job**
      per email. No cron, no polling.
- [x] **Emails sent at the scheduled time** — worker process drains the queue;
      `scheduledAt` is honoured to within the limiter's spacing.
- [x] **Configurable delay between consecutive emails** — per campaign
      (`delayBetweenMs`), with a queue-wide floor of
      `MIN_DELAY_BETWEEN_EMAILS_MS` enforced by the BullMQ limiter.
- [x] **Rate limiting (max N emails per hour)** — atomic Lua script in Redis,
      per-sender and/or global, mirrored durably to Postgres.
- [x] **Handles server restart without losing scheduled emails** — AOF for the
      ordinary case, `reconcileOnBoot()` for genuine Redis loss, past-due
      replay, and stuck-row reclamation.
- [x] **Idempotency / no duplicate sends** — deterministic
      `sha256(campaignId:recipientEmail:sequence)` as both the DB unique key
      and the BullMQ job id, plus a conditional-claim guard in the processor.
- [x] **Retries with backoff** — 3 attempts, exponential from 5s, with
      retryable-vs-permanent SMTP error classification (`EAUTH`/5xx are
      terminal, `ETIMEDOUT`/4xx retry).
- [x] **Multiple sender accounts** — deterministic round-robin across active
      `Sender` rows, resolved once at schedule time and persisted, so retries
      always use the same account.
- [x] **SMTP via Ethereal** — pooled transports, verified at worker boot;
      the worker refuses to start if no sender authenticates.
- [x] **Auth** — Google ID-token verification, own JWT for the API, ownership
      enforced in the `WHERE` clause of every query.
- [x] **Cancel a campaign** — `DELETE /api/campaigns/:id` cancels non-terminal
      rows and removes their queue entries.
- [x] **Recipient list upload** — `POST /api/uploads/recipients` parses CSV
      (with or without a header row) or a bare address list, stateless.
- [x] **Server-side HTML sanitisation** — allowlist tokeniser on the API
      boundary, so a hand-written `curl` request cannot store a `<script>`.
- [x] **Graceful shutdown** — `worker.close()` drains in-flight sends rather
      than stranding rows in `PROCESSING`.

### Frontend

- [x] **Next.js dashboard** — App Router, Next.js 16, Tailwind v4.
- [x] **Google OAuth login** — NextAuth v5; the ID token is exchanged for the
      API's JWT.
- [x] **Form to create a scheduled email** — `/compose`: recipients, subject,
      rich-text body, delay between emails, hourly limit, send-later time.
- [x] **List of scheduled emails** — `/scheduled`, soonest first, showing
      status and the exact scheduled time.
- [x] **List of sent emails** — `/sent`, most recent first, with the Ethereal
      **preview link** for every delivered message.
- [x] **Status of each email** — `SCHEDULED` / `QUEUED` / `PROCESSING` /
      `SENT` / `FAILED` / `CANCELLED` as colour-coded badges; failures show
      `lastError`.
- [x] **Sidebar counts** — live Scheduled / Sent badges from
      `GET /api/emails/stats`.
- [x] **Search and pagination** — server-side, over recipient address and
      subject.
- [x] **Recipient chip input** — paste or type; invalid addresses are flagged
      inline before submit.
- [x] **CSV / TXT upload** — with a "N detected · N invalid · N duplicates
      removed" summary.
- [x] **Rich text editor** — bold/italic/underline/lists/links, sanitised
      before submit (and again on the server).
- [x] **Live rate-limit display** — the compose form reads
      `GET /api/system/limits` and shows the floor the worker will enforce.
- [x] **Error surfacing** — backend validation errors are mapped back onto the
      exact form field that caused them.

---

## API reference

Base URL `http://localhost:4000`. Everything except `/health` requires
`Authorization: Bearer <jwt>`. Errors use one envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { "recipients.0.email": ["must be a valid email address"] } } }
```

Codes: `VALIDATION_ERROR` (400), `BAD_REQUEST` (400), `UNAUTHORIZED` (401),
`FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429),
`INTERNAL_ERROR` (500).

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/health` | — | — | `{ ok: true, ts }` |
| `POST` | `/api/auth/google` | — | `{ idToken }` | `{ token, user }` — verifies the Google ID token's audience, upserts the `User`, returns a 7-day API JWT |
| `GET` | `/api/auth/me` | JWT | — | `{ user }` — re-read from the DB, so a deleted user gets a 401 rather than stale claims |
| `POST` | `/api/campaigns` | JWT | `{ subject, bodyHtml, startTime, delayBetweenMs, hourlyLimit, recipients: [{ email, name? }] }` | `201 { campaign, duplicatesDropped, enqueued }` |
| `GET` | `/api/campaigns` | JWT | `?page&limit` | `{ data: CampaignDTO[], page, limit, total, totalPages }` |
| `GET` | `/api/campaigns/:id` | JWT | — | `CampaignDTO` with per-status `counts` |
| `DELETE` | `/api/campaigns/:id` | JWT | — | `{ campaignId, status: "CANCELLED", jobsCancelled, queueEntriesRemoved, alreadyTerminal }` |
| `GET` | `/api/emails/scheduled` | JWT | `?page&limit&search&campaignId&status` | Paginated `EmailJobDTO[]` — `SCHEDULED`/`QUEUED`/`PROCESSING`, soonest first |
| `GET` | `/api/emails/sent` | JWT | same | Paginated `EmailJobDTO[]` — `SENT`/`FAILED`, most recent first, with `previewUrl` |
| `GET` | `/api/emails/stats` | JWT | — | `{ byStatus, scheduled, sent, total, campaigns }` |
| `POST` | `/api/uploads/recipients` | JWT | `multipart/form-data`, field `file` (`.csv`/`.txt`, ≤5 MB) | `{ mode, total, valid, invalid, duplicates, invalidSamples, recipients }` — **nothing is persisted** |
| `GET` | `/api/system/limits` | JWT | — | Configured caps plus live Redis counters per active sender and when the window rolls over. Read-only; polling it cannot consume quota |

**`POST /api/campaigns` notes**

- There is deliberately **no `senderId`** field — the backend round-robins and
  persists the choice per job.
- `startTime` may be at most 60 seconds in the past (clock-skew grace);
  anything older is a 400.
- `recipients` is capped at **5000** per request and deduplicated
  case-insensitively; `duplicatesDropped` reports what was removed.
- `recipients[].name` accepts a string, an explicit `null`, or the key omitted;
  `null` is normalised to `undefined` at the schema boundary.
- `bodyHtml` is sanitised server-side against an allowlist. A body that
  sanitises to nothing (e.g. only a `<script>`) is rejected with a 400 rather
  than scheduling blank emails.

`EmailJobDTO` returns `bodyPreview` — the first ~160 characters as plain text —
rather than the full body, so a 25-row page does not ship 25 full HTML
documents to render 25 one-line previews.

---

## Assumptions, shortcuts & trade-offs

Stated plainly, because every one of these is a real limitation.

1. **Sender assignment is server-side round-robin, so the Figma's "From"
   dropdown is display-only.** `POST /api/campaigns` has no `senderId` field at
   all; the backend picks deterministically by sequence and persists the choice
   per job so retries reuse the same account. The compose form renders the
   first active sender with a chevron and a tooltip explaining it, rather than
   a working-looking `<select>` that silently changed nothing — a control that
   lies is worse than a control that is visibly inert.
2. **The email/password fields on the login screen are decorative.** Only
   Google OAuth is wired. There is no password column, no credentials
   provider, and no local-account flow anywhere in the codebase.
3. **There is no attachment endpoint, so the paperclip is disabled.** The API
   takes recipients and an HTML body; there is no storage layer for binaries.
   The button is rendered `disabled` with a tooltip saying so rather than
   removed, to keep the Figma's layout honest about what exists.
4. **The rich-text editor uses `document.execCommand`, not TipTap or Lexical.**
   `execCommand` is formally deprecated and produces slightly different markup
   per browser. It is also zero dependencies and about eighty lines. For
   bold/italic/underline/lists/links on a demo composer that is the right
   trade; anything richer (tables, images, collaborative editing) should switch
   to a real editor framework rather than grow this one.
5. **Delivery is at-least-once, not exactly-once.** A row stuck in
   `PROCESSING` may already have been delivered — the crash could have landed
   between SMTP accepting and Postgres committing — so reclaiming it can send
   that one email a second time. The window is narrow (a few hundred ms), every
   reclaim is logged at `WARN`, and the `Message-ID` is deterministic
   (`<idempotencyKey@reachinbox.local>`) so a real provider such as SES or
   Postmark dedupes the retry server-side. **Ethereal does not dedupe, so in
   this demo a duplicate would actually arrive.** The alternative — leaving the
   row `PROCESSING` forever — loses the email outright, and a possible
   duplicate beats a certain loss.
6. **SMTP credentials live in environment variables and in a plaintext
   `Sender.smtpPass` column.** They are throwaway Ethereal test credentials
   that can only reach Ethereal's own catch-all. A real system would keep them
   in a secrets manager (Vault, AWS Secrets Manager, Doppler) and hand the
   worker a short-lived reference rather than the password itself.
7. **One request may carry at most 5000 recipients.** This is a request-size
   guard, not a product limit — at ~100 bytes each that is roughly half a
   megabyte of JSON. A real system would not raise the number, it would change
   shape: accept an uploaded file reference, stream and chunk it server-side,
   and report progress asynchronously, so one HTTP request never holds an
   entire list in memory. The upload endpoint's stateless round-trip (parse →
   return → post back) has the same ceiling for the same reason.
8. **Ethereal credentials expire.** Accounts are disposable and get reaped.
   When they do, the worker refuses to start with `No SMTP sender verified` —
   which is the intended loud failure, but it does mean a checkout that sat for
   a few weeks needs fresh accounts and a re-seed before it will send anything.
9. **The ONB wordmark in the sidebar is redrawn geometry, not the original
   typeface.** It is hand-built SVG paths matched to the Figma by eye. It reads
   correctly at the sizes used and ships no font file, but it is not the real
   mark and should be replaced with the actual asset before anything
   customer-facing.
10. **Ordering within a rate-limit spill group is approximate, not FIFO.** The
    `sequence × 50ms` stagger restores ascending order for a normal batch, but
    jobs 50ms apart can still be reordered by worker scheduling, and past
    `MAX_JITTER_MS` the offsets clamp. Strict per-campaign ordering would need
    a single sequential consumer, costing all the parallelism.
11. **`RATE_LIMIT_STRATEGY` defaults to `per_sender`.** The global cap exists
    and is tested, but is off by default because a single global bucket makes
    the per-sender round-robin pointless at demo scale.
12. **No automated test suite.** Verification was done with the scripted probes
    listed below (`npm run test:enqueue`, `npm run demo:restart`,
    `npm run smoke:smtp`, direct `curl` + `psql`) rather than Jest/Vitest.
    Those probes are reproducible and checked into `backend/scripts/`, but they
    are not a regression suite and will not fail a CI build.

---

## Verification evidence

Every claim above was executed, not asserted. These are the proofs and what
each one produced.

| # | Claim | How it was proved | Result |
| --- | --- | --- | --- |
| 1 | Emails actually send end-to-end | 3-recipient campaign posted to `POST /api/campaigns` with the worker running | 3/3 `SENT`, campaign `COMPLETED`, 1 attempt each, Ethereal `previewUrl` on every row |
| 2 | Minimum spacing is enforced | `lockedAt` gaps across 12 consecutive jobs | **1999–2024 ms** against a 2000 ms floor |
| 3 | …and still is, after these changes | same query re-run across the 12 most recent sends | **1992–2025 ms** (33 ms spread). The same rows' `sentAt` gaps span **1756–2232 ms** (476 ms spread) — which is why the guarantee is asserted on `lockedAt`, not `sentAt` |
| 4 | The hourly cap is atomic | 50 concurrent `tryConsume` calls against a limit of 10 | **exactly 10 admitted, 40 rejected** |
| 5 | Duplicate sends are impossible | 4 processors racing the same job | **exactly 1 claimed and sent**; the other 3 returned without sending and refunded their rate-limit slots |
| 6 | A graceful Redis restart loses nothing | `docker compose restart redis`, then boot the worker | AOF replayed; reconciliation reported every row `skipped-already-queued` — **no repair needed**, and the honest finding is that this demo proves durability, not reconciliation |
| 7 | Redis *loss* is recoverable | wipe the `reachinbox:*` keyspace, restart the worker | **6/6 re-queued with their original send times preserved**; all six subsequently sent |
| 8 | `recipients[].name` accepts all three shapes | three `curl` posts — `"name": null`, key omitted, `"name": "Ada Lovelace"` | **201 / 201 / 201**; Postgres shows `NULL`, `NULL`, `Ada Lovelace`. The pre-fix schema returned 400 on the first of those |
| 9 | Server-side sanitisation cannot be bypassed | hand-written JSON via `curl`, no browser involved, carrying `<script>`, `onclick=`, `javascript:`, an entity-encoded `java&#115;cript:`, `<iframe>`, `<style>` and `<img onerror>` | stored `Campaign.bodyHtml` **and** `EmailJob.bodyHtml` contain none of them; the legitimate `<a href="https://…">` survived and gained `rel="noopener noreferrer"` |
| 10 | A body that sanitises to nothing is rejected | `curl` with `bodyHtml: "<script>alert(1)</script>"` | **400 BAD_REQUEST**, rather than a campaign of blank emails |
| 11 | The sanitiser survives evasion, and is idempotent | 19-case probe: nested-tag smuggling (`<scr<script>ipt>`), quote breakout, `<script>if (a<b)`, uppercase tags, unclosed tags, void drop-tags, bare `<` in text | no case leaked live markup; `sanitize(sanitize(x)) === sanitize(x)` for all 19 |
| 12 | Nothing regressed | `backend: tsc`, `backend: build`, `frontend: tsc --noEmit`, `frontend: eslint`, `frontend: next build` | all clean; 7 routes built |

Reproducible probes, all in `backend/scripts/`:

```bash
npm run smoke:smtp                              # SMTP pool, error classification, round-robin
npm run test:enqueue -- --count 12 --delay-seconds 5
npm run test:enqueue -- --count 1 --bad-sender  # permanent-failure path
npm run demo:restart                            # 6 emails in two waves, for the restart demo
npx tsx scripts/redis-smoke.ts                  # PING/SET/GET/DEL against the configured port
npm run dev:token                               # mint a JWT for curl
```

---

## Repository layout

```
reachinbox-scheduler/
├── docker-compose.yml            postgres:16-alpine, redis:7-alpine (AOF, host :6380)
├── DEMO_SCRIPT.md                minute-by-minute plan for the 5-minute video
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma         User · Sender · Campaign · EmailJob · RateLimitWindow
│   │   └── seed.ts               Sender rows from SMTP_ACCOUNTS (idempotent)
│   ├── scripts/                  dev-token, smoke-smtp, enqueue-test, restart-demo, redis-smoke
│   └── src/
│       ├── config/env.ts         zod-validated config; nothing reads process.env directly
│       ├── lib/                  prisma, redis, logger, errors, shutdown, sanitize-html
│       ├── middleware/           requestId, requestLogger, auth, validate, errorHandler
│       ├── queue/                email.queue (add/remove/dedupe) · email.worker (the processor)
│       ├── routes/               auth · campaigns · emails · uploads · system
│       ├── services/             campaign · emailJob · email · smtp · sender
│       │                         · rateLimit (Lua) · reconciliation (boot repair) · auth
│       ├── index.ts              API entrypoint
│       └── worker.ts             worker entrypoint — verify SMTP, reconcile, then consume
└── frontend/
    └── src/
        ├── app/                  (dashboard)/{scheduled,sent,compose} · login · api/auth
        ├── components/           compose/ · email/ · layout/ · ui/
        ├── hooks/                useEmails · useStats · useSystemLimits
        ├── lib/                  api-client · auth · sanitize-html · format · cn
        └── proxy.ts              route protection (Next 16's renamed middleware)
```
