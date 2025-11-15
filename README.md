# QueueCTL (MongoDB) 🚀

Production-grade, CLI-driven background job queue for Node.js with MongoDB. It handles enqueuing, concurrent workers, atomic locking, retries with exponential backoff, a Dead Letter Queue, and a minimal web dashboard.


[Demo Link](https://drive.google.com/file/d/1QHb7Lgk-SSF6MiFSMLFJdVgoX37b6KP_/view?usp=drive_link)

## ✨ Features
- Job enqueuing, persistent storage in MongoDB
- Atomic find-and-lock with `findOneAndUpdate`
- Concurrent workers via `cluster`
- Exponential backoff retries, DLQ on max retries
- Graceful shutdown, saved stdout/stderr logs
- Minimal web dashboard with live stats

## 🛠️ Quick Start
Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)

Install

```bash
npm install
```

Configure MongoDB
- The connection string is configured in `db.js`. Set it to your local or Atlas URI.
- If you prefer environment variables, you can adjust `db.js` to read `MONGO_URI`.

Run Commands (Windows PowerShell examples)
- Use `node` to run the CLI: `node queuefile.js <command>`

## 💻 CLI Cheatsheet
Workers

```powershell
# Start 4 worker processes
node queuefile.js worker start --count 4

# Stop all workers gracefully
node queuefile.js worker stop
```

Enqueue

```powershell
# Simple job
node queuefile.js enqueue '{"id":"job1","command":"echo hello"}'

# High priority job
node queuefile.js enqueue '{"id":"vip","command":"echo FIRST","priority":10}'

# Job with 5s timeout
node queuefile.js enqueue '{"id":"timeout","command":"sleep 10","timeout":5000}'
```

Status & Dashboard

```powershell
# Job and worker summary
node queuefile.js status

# Start dashboard on port 3000
node queuefile.js dashboard
# Open http://localhost:3000
```

List & Logs

```powershell
# List pending jobs
node queuefile.js list --state pending

# List completed jobs
node queuefile.js list --state completed

# View saved logs for a job
node queuefile.js log job1
```

Dead Letter Queue (DLQ)

```powershell
# List DLQ jobs
node queuefile.js dlq list

# Retry a DLQ job
node queuefile.js dlq retry timeout
```

Configuration

```powershell
# Set global max retries to 5
node queuefile.js config set max_retries 5

# Set global job timeout to 60s (ms)
node queuefile.js config set job_timeout 60000
```

## 🧩 Architecture
- CLI `queuefile.js`: Commander-based app and master process that forks workers via `cluster`.
- Worker `mainfile.js`: Polls for the highest-priority ready job, executes it, handles retries/DLQ, and logs output.
- Persistence `db.js`, `models/`: MongoDB + Mongoose with atomic locking.
- Dashboard `views/dashboard.ejs`: Express + EJS. `GET /api/stats` returns counts and DLQ list; `POST /api/dlq/retry/:jobId` retries.
- Process management: `queuectl.pid` tracks the master process for graceful `SIGTERM` shutdown.

## 🔍 Design Highlights
- Priority-first scheduling with FIFO tie-breaker
- Exponential backoff using `run_at`
- Saved logs for success, retry, and DLQ states

## 🧪 Try The Features
Priority demo

```powershell
node queuefile.js worker start --count 1
node queuefile.js enqueue '{"id":"long","command":"sleep 10"}'
node queuefile.js enqueue '{"id":"normal","command":"echo normal"}'
node queuefile.js enqueue '{"id":"vip","command":"echo vip","priority":10}'
```

Timeout & DLQ demo

```powershell
node queuefile.js config set job_timeout 2000
node queuefile.js worker stop
node queuefile.js worker start --count 1
node queuefile.js enqueue '{"id":"timeout","command":"sleep 3"}'
```

Dashboard

```powershell
node queuefile.js dashboard
# Open http://localhost:3000 and watch live stats
```

## ⚠️ Notes & Trade‑offs
- PID file can become stale after crashes; remove `queuectl.pid` if worker stop fails.
- `child_process.exec` is simple but not sandboxed. Use `spawn` and job isolation for multi-tenant production.

## 🙌 Credits
Built for a backend developer internship assignment.
