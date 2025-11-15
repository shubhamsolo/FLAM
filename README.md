🚀 queuectl - Background Job Queue System
queuectl is a production-grade, CLI-based background job queue system built in Node.js with MongoDB. It manages job enqueuing, concurrent processing, and complex failure handling (including retries, exponential backoff, and a Dead Letter Queue).

This project was built as a solution for a backend developer internship assignment.

[➡️ Watch the Demo Video] (IMPORTANT: Paste your Google Drive/YouTube/Loom link here!)

✨ Features
Core Features
Job Enqueuing: Add jobs to a persistent queue from the CLI.


Persistent Storage: Uses MongoDB to ensure jobs are not lost on restart.


Concurrent Workers: Runs multiple worker processes in parallel using Node.js's cluster module.

Atomic Locking: Guarantees no-duplicate job execution, even with many workers, using atomic findOneAndUpdate operations.


Exponential Backoff: Automatically retries failed jobs with an increasing delay.


Dead Letter Queue (DLQ): Moves jobs to a "dead" state after all retries are exhausted.


Graceful Shutdown: Workers can be stopped gracefully, allowing them to finish their current job before exiting.

CLI Management: Full system control from a clean, commander.js-based CLI.

🌟 Bonus Features Implemented
Minimal Web Dashboard: A live-updating web dashboard (built with Express.js) to monitor job stats and manage the DLQ.

Job Timeout Handling: Configurable global and per-job timeouts prevent workers from hanging on stuck jobs.

Job Priority Queues: Jobs with a higher priority number are executed first.

Job Output Logging: Saves stdout and stderr for every job, viewable from the CLI.

Metrics & Stats: The status command and dashboard provide real-time job counts by state.

Scheduled Jobs: The run_at field (used for backoff) naturally supports scheduling jobs to run in the future.

🛠️ Setup Instructions
Clone Repository:

Bash

git clone <your-github-repo-url>
cd queuectl-mongo
Install Dependencies:

Bash

npm install
(This installs mongoose, commander, express, and ejs).

Run MongoDB: This project requires a running MongoDB instance on the default port. The app will connect to mongodb://localhost:27017/queuectl.

Make CLI Executable:

Bash

chmod +x queuectl.js
💻 Usage Examples
1. Managing Workers
Workers are the background processes that run jobs.

Bash

# Start 4 worker processes
./queuectl.js worker start --count 4

# Stop all workers gracefully (they will finish their current job)
./queuefile.js worker stop
2. Enqueueing Jobs
Add new jobs to the queue.

Bash

# Enqueue a simple job
./queuectl.js enqueue '{"id":"job1", "command":"echo hello"}'

# 🌟 BONUS: Enqueue a HIGH PRIORITY job
./queuectl.js enqueue '{"id":"vip-job", "command":"echo FIRST", "priority": 10}'

# 🌟 BONUS: Enqueue a job with a 5-second timeout
./queuectl.js enqueue '{"id":"job-with-timeout", "command":"sleep 10", "timeout": 5000}'
3. Monitoring the System
Check the health and status of your queues.

Bash

# Get a live summary of all jobs and worker status
./queuectl.js status

# 🌟 BONUS: Start the web dashboard on port 3000
./queuectl.js dashboard
# Now open http://localhost:3000 in your browser!
4. Listing Jobs & Logs
Inspect jobs in different states.

Bash

# List all pending jobs
./queuectl.js list

# List all completed jobs
./queuectl.js list --state completed

# 🌟 BONUS: View the saved output for a specific job
./queuectl.js log job1
5. Dead Letter Queue (DLQ)
Manage jobs that have permanently failed.

Bash

# List all jobs in the DLQ
./queuectl.js dlq list

# Manually retry a failed job
./queuectl.js dlq retry job-with-timeout
6. Configuration
Manage global system settings.

Bash

# Set the global max retries to 5
./queuectl.js config set max_retries 5

# 🌟 BONUS: Set a global 60-second job timeout (in ms)
./queuectl.js config set job_timeout 60000
🏛️ Architecture Overview
CLI (queuectl.js): A unified commander.js application. It serves as both the user-facing CLI and the master process for spawning workers using the cluster module.

Persistence (db.js, models/): We use MongoDB with mongoose. The key design choice was to use findOneAndUpdate as an atomic "find-and-lock" operation. This is the core mechanism that prevents duplicate job execution, a critical "Robustness" requirement.

Worker (worker.js): This file contains the "engine" logic. It's a module imported by the master cluster process. Each worker runs an independent loop, polls the DB for the highest-priority job, executes it, and handles all failure/retry/logging logic.

Web Dashboard (views/dashboard.ejs): An Express.js server that runs on a separate command (./queuectl.js dashboard). It provides a simple REST API (/api/stats) that the EJS frontend polls to provide a live, auto-refreshing view of the system.

Process Management: The worker start command creates a queuectl.pid file to store the master process ID. The worker stop command reads this PID and sends a graceful SIGTERM signal, ensuring an orderly shutdown.

🤔 Assumptions & Trade-offs

MongoDB vs. SQLite/JSON: The spec allowed for JSON or SQLite. I chose MongoDB as it is "best for this usecase". Its native findOneAndUpdate operation is the industry-standard, robust solution for implementing an atomic queue. This choice directly solves the "race conditions or duplicate job execution" problem mentioned as a disqualifier.

PID File: Using a PID file for process management is simple and effective for this assignment. The trade-off is that if the master process crashes, a stale queuectl.pid file might remain, requiring manual deletion. A more complex production system might use a service manager.

child_process.exec: For simplicity, the worker uses exec to run commands. This is powerful, but in a multi-tenant production system, it would be a security risk. A better implementation would use spawn and "sandbox" the execution.

🧪 Testing Instructions
You can validate all core functionality and bonus features using the provided test script and a manual plan.

1. Automated Test Script
A test.sh script is included to test the main scenarios from the spec . It will automatically clear the DB, start/stop workers, and verify job states.

Bash

# 1. Make sure workers are stopped!
./queuectl.js worker stop

# 2. Make the script executable
chmod +x test.sh

# 3. Run the test script
./test.sh
2. Manual Bonus Feature Testing
To best see the bonus features in action, follow this plan:

Test Priority:

In one terminal, start a worker: ./queuectl.js worker start --count 1

In a second terminal, enqueue a long job: ./queuectl.js enqueue '{"id":"long", "command":"sleep 10"}'

While it's running, enqueue two more:

./queuectl.js enqueue '{"id":"normal", "command":"echo normal"}'

./queuectl.js enqueue '{"id":"vip", "command":"echo vip", "priority": 10}'

Observe: The worker will run vip before normal.

Test Timeout:

Set a short global timeout: ./queuectl.js config set job_timeout 2000

Restart your worker to load the new config.

Enqueue a job that will time out: ./queuectl.js enqueue '{"id":"timeout", "command":"sleep 3"}'

Observe: The worker log will show "Job TIMED OUT" and the job will be retried (and eventually go to DLQ).

Test Dashboard:

In one terminal, start the dashboard: ./queuectl.js dashboard

Open http://localhost:3000 in your browser.

Use a second terminal to enqueue jobs and dlq list. Watch the dashboard update in real-time. Click the "Retry" button on a DLQ job.
