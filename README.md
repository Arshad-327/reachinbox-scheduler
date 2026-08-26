# reachinbox-scheduler

Production-grade email scheduler service. Monorepo: an Express + BullMQ backend
and a Next.js frontend, with Postgres and Redis in Docker.

> **Status: scaffolding.** Infrastructure, config and entrypoints are in place
> and verified to boot. No scheduling/sending business logic yet.

## Layout

```
reachinbox-scheduler/
├── backend/            Express API + BullMQ worker (TypeScript, strict)
│   ├── prisma/         schema.prisma (datasource only for now)
│   └── src/
│       ├── config/     env.ts — zod-validated, typed config
│       ├── lib/        logger.ts, redis.ts, prisma.ts
│       ├── routes/     (empty)
│       ├── services/   (empty)
│       ├── queue/      (empty)
│       ├── middleware/ (empty)
│       ├── types/      (empty)
│       ├── index.ts    API entrypoint
│       └── worker.ts   queue worker entrypoint
├── frontend/           Next.js App Router + Tailwind + ESLint
└── docker-compose.yml  postgres:16-alpine, redis:7-alpine
```

## Prerequisites

- Node >= 20
- Docker Desktop (running)

## Setup

```bash
# 1. infrastructure
docker compose up -d
docker compose ps            # wait until both services are healthy

# 2. backend
cd backend
cp .env.example .env         # then fill in JWT_SECRET, Google + SMTP creds
npm install
npm run prisma:generate
npm run dev                  # http://localhost:4000
npm run worker               # separate terminal

# 3. frontend
cd ../frontend
cp .env.local.example .env.local
npm install
npm run dev                  # http://localhost:3000
```

Health check: `curl http://localhost:4000/health` → `{"ok":true,"ts":"..."}`

## Configuration

All backend config goes through `src/config/env.ts`, which validates
`process.env` with zod at startup and fails loudly listing every bad or missing
variable. Import `env` from there — never read `process.env` directly.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `4000` | API port |
| `DATABASE_URL` | — | required, Postgres connection string |
| `REDIS_HOST` | `localhost` | |
| `REDIS_PORT` | `6379` | **6380 on this dev machine** — see note below |
| `REDIS_PASSWORD` | — | optional |
| `JWT_SECRET` | — | required, 32-byte hex recommended |
| `GOOGLE_CLIENT_ID` | — | required |
| `GOOGLE_CLIENT_SECRET` | — | required |
| `FRONTEND_URL` | `http://localhost:3000` | CORS origin |
| `WORKER_CONCURRENCY` | `5` | BullMQ worker concurrency |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | throttle between sends |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `100` | |
| `MAX_EMAILS_PER_HOUR_GLOBAL` | `500` | |
| `RATE_LIMIT_STRATEGY` | `per_sender` | `per_sender` \| `global` \| `both` |
| `SMTP_ACCOUNTS` | — | required, JSON array of sender accounts |
| `MAX_JOB_ATTEMPTS` | `3` | BullMQ retry attempts |

`SMTP_ACCOUNTS` is a JSON string, validated element by element:

```json
[{"user":"x@ethereal.email","pass":"y","host":"smtp.ethereal.email","port":587,"fromName":"Oliver Brown"}]
```

## Infrastructure notes

**Redis host port is remapped to 6380.** Port 6379 was already claimed by an
unrelated container on the dev machine, so `docker-compose.yml` publishes
`6380:6379`. The container still listens on 6379 internally; only the host-side
binding moved, and `backend/.env` sets `REDIS_PORT=6380` to match. On a machine
where 6379 is free you can drop both back to 6379.

To confirm the app itself connects on whatever port is configured:

```bash
cd backend && npx tsx scripts/redis-smoke.ts   # PING/SET/GET/DEL round-trip
```

**Redis runs with AOF persistence** (`--appendonly yes --appendfsync everysec`).
This is not optional: BullMQ stores delayed jobs in Redis, so without an
append-only file every email scheduled for a future send time would vanish on a
container restart.

Redis connections are created via `createRedisConnection()` in `src/lib/redis.ts`
with `maxRetriesPerRequest: null`, which BullMQ requires — its blocking commands
outlive ioredis' default retry budget. BullMQ also wants a dedicated connection
per Queue/Worker/QueueEvents, which is why that module exports a factory rather
than a shared client.

## Scripts (backend)

| Script | Does |
| --- | --- |
| `npm run dev` | API with hot reload |
| `npm run worker` | queue worker with hot reload |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | run built API |
| `npm run start:worker` | run built worker |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run prisma:generate` | regenerate Prisma client |
