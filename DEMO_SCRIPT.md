# 5-Minute Demo Script

A minute-by-minute shooting plan. Everything below is meant to be read while
recording: **the left column is what you do, the right is what you say.**

The spec asks the video to show four things. This script covers them in this
order, with the strongest version of each:

1. Creating scheduled emails from the frontend
2. The dashboard showing Scheduled and Sent
3. **The restart scenario** — and the headline version is the **Redis wipe**,
   not a plain worker restart (see the note in *Segment 4*, it matters)
4. Bonus: rate limiting and the delay under load

---

## Before you hit record

### Window and terminal layout

Set this up once and do not rearrange it on camera — a rearranged desktop
mid-take costs you ten seconds and the viewer's place.

```
┌───────────────────────────────────────────┬─────────────────────────────────┐
│                                           │  T1  backend/  npm run dev      │
│                                           │      (API, :4000)               │
│           BROWSER                         ├─────────────────────────────────┤
│           localhost:3000                  │  T2  backend/  npm run worker   │
│           ~65% of the frame               │      ★ THE HERO PANE ★          │
│                                           │      keep this visible almost   │
│                                           │      the whole video            │
│                                           ├─────────────────────────────────┤
│                                           │  T3  backend/  (free)           │
│                                           │      scripts, curl, docker exec │
└───────────────────────────────────────────┴─────────────────────────────────┘
```

Frontend terminal (`npm run dev` in `frontend/`) is **off-screen** — it prints
nothing interesting and steals a pane.

Font size: bump the terminals to ~16pt. Log lines with a `previewUrl` are long;
if they wrap into three lines the pane becomes unreadable on a phone.

### Pre-flight checklist

```bash
# infra healthy
docker compose ps                    # both "healthy"

# fresh, working SMTP creds — do this the DAY OF, Ethereal accounts expire
cd backend
npm run smoke:smtp                   # must print a preview URL, not EAUTH
npm run db:seed                      # after any SMTP_ACCOUNTS change
```

Then, **in this order**:

1. **Seed the restart scenario now, before recording**, so segment 4 has data
   that is already ticking:

   ```bash
   cd backend
   npm run demo:restart
   ```

   This schedules 6 emails in two waves — 3 due in ~90s, 3 due in ~150s. You
   will re-run it on camera, but running it once first means you have seen the
   output and know how long the waves take.

2. **Log in to the dashboard in the browser and leave the session live.** Do
   not film the Google consent screen. It is slow, it shows your personal
   account, and OAuth setup is a README topic, not a video topic. Start on
   `/scheduled`, already authenticated.

3. **Clear the Scheduled list of clutter** so the rows you create on camera are
   the only ones there — or accept the clutter and say "these are from earlier
   runs" once. Do not silently show 40 stale rows.

4. Have `psql` ready in T3 as a shell alias so you are not typing the container
   name on camera:

   ```bash
   alias q='docker exec reachinbox-postgres psql -U scheduler -d email_scheduler'
   ```

5. Start the screen recorder, take a breath, and start on the browser at
   `/scheduled`.

---

## Segment 1 — 0:00 → 0:30 · What this is

**Window: browser, `/scheduled`. Terminals visible on the right.**

| Do | Say |
| --- | --- |
| Cursor rests on the sidebar (Scheduled / Sent). Then a slow sweep right across the three terminal panes. | "This is an email scheduling service. Next.js dashboard on the left, and on the right three processes: the Express API, the queue **worker** — that's a separate process, it's the thing that actually sends — and a spare shell." |
| Point at T2's boot banner (`BOOT RECONCILIATION`). | "Scheduling is BullMQ delayed jobs on Redis. There is no cron anywhere in this codebase — the delay *is* the schedule. Postgres is the source of truth; Redis only holds the timing." |

**Do not** explain the architecture further here. You have four things to show
and 4½ minutes left.

---

## Segment 2 — 0:30 → 1:30 · Create a scheduled email from the frontend

**Window: browser. Full attention on it — the terminals are background.**

| Do | Say |
| --- | --- |
| Click **Compose**. | "Compose." |
| Cursor pauses on the greyed **From** field for one beat. | "From is display-only on purpose — the backend round-robins across the SMTP accounts itself and persists the choice, so a dropdown here would be a lie." |
| Type three addresses into **To**, pressing Enter after each: `demo.one@ethereal.email`, `demo.two@ethereal.email`, `demo.three@ethereal.email`. | "Recipients as chips. Invalid ones get flagged before you can submit." |
| *(Optional, only if you're ahead of time)* Click the upload icon and pick a small CSV. | "Or upload a list — it reports how many were detected, invalid, and de-duplicated." |
| Subject: `Q3 launch — scheduled demo`. Type a body, hit **B** for bold on a word. | "Subject, rich-text body." |
| Set **Delay between 2 emails** to `2` seconds. Point at the hint line under it. | "Two seconds between sends. The worker enforces a floor regardless of what I put here." |
| Set the hourly limit field to `100`. | "And a hundred an hour cap." |
| Click the **clock** icon → pick a time **~60 seconds from now** → confirm. | "Send later — sixty seconds out, so we can watch it sit in the queue first." |
| Click **Send Later**. | "And schedule it." |

You land on `/scheduled` automatically.

---

## Segment 3 — 1:30 → 2:15 · Dashboard: Scheduled → Sent

**Window: browser, then a glance at T2.**

| Do | Say |
| --- | --- |
| Cursor on the three new rows. Point at the **Scheduled** badge and the exact times — note they're 2s apart. | "Three rows, status Scheduled, and look at the times — 2 seconds apart, one per recipient. That spacing was decided at schedule time and written to the database." |
| Point at the sidebar count. | "Sidebar count updates with it." |
| Wait for the send window. **Move the cursor to T2** as the first log line lands. | "…and there goes the worker." |
| Let `email job sent` scroll past three times in T2. | "Sent, sent, sent. Each one re-reads its row from Postgres before sending — the Redis payload is just three ids, no content." |
| Back to browser. Click **Sent** in the sidebar. Hit the refresh control. | "Sent view." |
| Point at the newest row's **preview link**, click it. Ethereal opens in a new tab showing the real message. | "Every delivered message stores its Ethereal preview URL, so you can open the actual email that went out." |
| Close the tab, return to the dashboard. | — |

> If a send is slow, **do not sit in silence.** Fill with: "while that goes out
> — sender assignment is deterministic, so a retry always uses the same account
> as the first attempt."

---

## Segment 4 — 2:15 → 3:35 · Restart survival *(the important one)*

> ### Why the Redis wipe is the headline, and a plain worker restart is not
>
> Redis runs with AOF persistence. A plain worker restart — or even
> `docker compose restart redis` — **loses nothing to begin with**: the delayed
> jobs live in Redis, not in the worker, and AOF replays them on boot. Filming
> that proves durability, which is real but unremarkable, and reconciliation
> would just report "nothing to repair", which looks like nothing happened.
>
> The scenario that actually exercises the recovery path is **Redis losing
> state**: a wiped volume, a recreated container, a `FLUSHALL`. Then the
> database has rows with no queue entries, and reconciliation is the only thing
> standing between that and silently un-sent email. Film that one.

**Window: T3 for commands, T2 for the payoff, browser at the end.**

| Do | Say |
| --- | --- |
| **T3:** `npm run demo:restart` — table of 6 scheduled emails prints. | "Six emails scheduled — three due in ninety seconds, three in two and a half minutes. Nothing has fired yet." |
| **Browser:** switch to `/scheduled`, point at the six rows. | "There they are in the dashboard, with their send times." |
| **T2:** `Ctrl+C`. Let the drain message print. | "Now I kill the worker. It drains in-flight sends first rather than stranding a row mid-send." |
| **T3:** wipe the queue — the destructive step, say it clearly: | "And now the hard case. I'm going to **delete every one of this app's keys out of Redis** — simulating a lost volume or a recreated container. Every delayed job is gone." |

```bash
docker exec reachinbox-redis redis-cli EVAL \
  "local k=redis.call('keys','reachinbox:*') for i=1,#k do redis.call('del',k[i]) end return #k" 0
```

| Do | Say |
| --- | --- |
| Point at the returned count. | "That's how many keys just disappeared." |
| **T3:** prove the queue is empty: `docker exec reachinbox-redis redis-cli KEYS 'reachinbox:*'` → `(empty array)`. | "Queue is empty. If nothing repaired this, those six emails would never send — the rows would sit in the database forever." |
| **Browser:** point at `/scheduled` — still six rows. | "But the database still has all six. Postgres is the source of truth." |
| **T2:** `npm run worker`. | "Restart the worker." |
| **Freeze on the `BOOT RECONCILIATION` table.** This is the money shot — hold it for a full 4–5 seconds. Cursor on the `re-queued (missing from Redis)` row: **6**. | "One-shot reconciliation at boot — not a cron, it runs once, before the worker consumes anything. Six rows scanned, **six re-queued**. And look at the detail table: each one keeps its **original scheduled time**. Recovery didn't reschedule anything, it rebuilt exactly what was lost." |
| Wait for wave one to fire in T2. | "…and there's wave one, going out on its original schedule." |
| **Browser:** `/sent`, refresh, point at the rows. | "Six of six, all sent, no duplicates. Same idempotency key means the job id, and the database claim, both reject a second attempt." |

If you are short on time, you can stop after wave one fires and say "wave two
follows at its own time" — you do not have to sit through 150 seconds on
camera.

---

## Segment 5 — 3:35 → 4:40 · Bonus: rate limiting and the delay under load

**Window: T3 to launch, T2 to watch, then T3 for the measurement.**

| Do | Say |
| --- | --- |
| **T3:** launch a burst: | "Bonus round — throughput under load." |

```bash
cd backend
npm run test:enqueue -- --count 12 --delay-seconds 5
```

| Do | Say |
| --- | --- |
| **T2:** watch the sends tick out. Point at the timestamps as they arrive. | "Twelve emails, all due at once. They're not going out at once — the worker starts at most one job every two seconds, queue-wide, and that limiter's state lives in Redis so it holds across multiple worker processes, not just this one." |

> ### ⚠️ MEASURE `lockedAt`, NOT `sentAt`
>
> This is the single easiest way to make your own system look broken on camera.
>
> Worker concurrency is **5**, and the limiter caps job **starts**, not
> overlap. So five sends run in parallel, and `sentAt` — when SMTP *accepted*
> the message — comes back interleaved and out of order. A viewer looking at
> `sentAt` sees gaps of 300ms and concludes the 2-second rule is broken.
>
> `lockedAt` is when the worker **claimed** the job — the send **start**. That
> is the timeline the guarantee is about, and it is evenly spaced.
>
> **Say this out loud in the video.** It is the subtlest point in the build and
> explaining it well is worth more than any other thirty seconds of footage.

| Do | Say |
| --- | --- |
| **T3:** run the measurement (paste it, don't type it): | "Let me prove the spacing — and this is the part that's easy to get wrong." |

```bash
docker exec reachinbox-postgres psql -U scheduler -d email_scheduler -c "
SELECT sequence,
       to_char(\"lockedAt\", 'HH24:MI:SS.MS') AS started,
       EXTRACT(MILLISECONDS FROM (\"lockedAt\" - LAG(\"lockedAt\") OVER (ORDER BY \"lockedAt\")))::int AS gap_ms,
       to_char(\"sentAt\",   'HH24:MI:SS.MS') AS completed
FROM \"EmailJob\"
WHERE status = 'SENT'
ORDER BY \"lockedAt\" DESC
LIMIT 12;"
```

| Do | Say |
| --- | --- |
| Cursor down the **`gap_ms`** column. | "Every gap between send **starts** — right around two thousand milliseconds. Across twelve consecutive jobs mine came out 1992 to 2025, against a 2000ms floor. That's a 33-millisecond spread." |
| Cursor across to the **`completed`** column and trace the same rows. | "Now the completion column. Those gaps span 1756 to 2232 — a spread fourteen times wider, because each one carries that individual SMTP conversation's latency. And that's the mild case: five sends run in parallel, so any send slower than the spacing lets the next one finish first and the order breaks entirely. Start times are the schedule; completion times are the network. Measure the wrong column and you'd think this was broken." |
| **T3:** show the live counters: | — |

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/system/limits | jq '.senders[] | {email, hourlyLimit, scopes}'
```

*(Mint `$TOKEN` with `npm run dev:token` before recording and export it — do
not run the token script on camera.)*

| Do | Say |
| --- | --- |
| Point at `count` / `remaining` per sender. | "And the hourly cap is separate from that spacing — a per-sender counter in Redis, checked and incremented by one atomic Lua script so two workers can't both read 99 of 100 and both send. Fifty concurrent attempts against a limit of ten admit exactly ten." |
| One sentence, no demo needed: | "When a job hits the cap it isn't failed or dropped — it's re-queued into the next hour window with its row still showing Scheduled. A thousand emails against a hundred-an-hour cap drain over about ten hours, and nothing is lost." |

---

## Segment 6 — 4:40 → 5:00 · Close

**Window: browser on `/sent`.**

| Do | Say |
| --- | --- |
| Slow cursor over the Sent list. | "So: scheduled from the UI, sent by a separate worker at the right time, spacing and hourly limits enforced, and it survives Redis losing its entire state without losing or duplicating a single email." |
| Beat. | "Full architecture write-up, the trade-offs I made, and the verification runs behind every one of those claims are in the README." |

Stop recording.

---

## Timing summary

| Segment | Window | Ends at |
| --- | --- | --- |
| 1 · What this is | 0:30 | 0:30 |
| 2 · Create from the frontend | 1:00 | 1:30 |
| 3 · Scheduled → Sent | 0:45 | 2:15 |
| 4 · Restart survival *(Redis wipe)* | 1:20 | 3:35 |
| 5 · Rate limiting + delay under load | 1:05 | 4:40 |
| 6 · Close | 0:20 | 5:00 |

Segment 4 is the one the spec cares most about. If you overrun, **cut from
segment 2** (skip the CSV upload, type fewer recipients) and **from segment 5**
(drop the `/api/system/limits` call and just say the numbers) — never from 4.

---

## If something goes wrong on camera

| Symptom | Cause | Say / do |
| --- | --- | --- |
| Worker exits with `No SMTP sender verified` | Ethereal accounts expired | Stop. Not recoverable on camera. Create new accounts, update `SMTP_ACCOUNTS`, `npm run db:seed`, re-shoot. |
| Emails stay `SCHEDULED` forever | Worker isn't running | "That's the worker — it's a separate process." Start it in T2. Honest, and it makes the point. |
| Reconciliation reports `skipped-already-queued` instead of `re-queued` | The Redis wipe didn't take | Check you ran the `EVAL` against `reachinbox-redis` and that `KEYS 'reachinbox:*'` was empty **before** starting the worker. |
| `gap_ms` shows a gap much larger than 2000 | You caught an hour-window deferral, or the worker was idle between batches | Re-run the query filtering to one campaign: add `AND "campaignId" = '<id>'`. |
| Login screen appears mid-take | Session expired | Cut. Log in off-camera and restart the segment. |
| Duplicate email appears after a hard kill | Genuine at-least-once behaviour | Don't hide it: "That's the at-least-once trade-off — a crash between SMTP accepting and the database committing. The Message-ID is deterministic so a real provider dedupes it; Ethereal doesn't. It's in the README." |
