#!/usr/bin/env node

const { program } = require('commander');
const { connectDB, disconnectDB } = require('./db');
const Job = require('./models/job');
const Config = require('./models/config');

// --- NEW MODULES FOR PHASE 5 ---
const cluster = require('cluster');
const os = require('os');
const fs = require('fs');
const path = require('path');

// --- NEW: PID file for worker management ---
const PID_FILE = path.join(__dirname, 'queuectl.pid');

// --- Program-Wide Setup ---
program
  .version('1.0.0')
  .description('A CLI-based background job queue system');

// --- REMOVED GLOBAL HOOKS ---
// The program.hook for connect/disconnect has been removed.
// Connections are now managed by each command.

// --- `enqueue` Command (Modified) ---
program
  .command('enqueue <jobJson>')
  .description('Add a new job to the queue')
  .action(async (jobJson) => {
    await connectDB(); // <-- Connect here
    try {
      const jobData = JSON.parse(jobJson);

      if (!jobData.id || !jobData.command) {
        console.error('Error: Job data must include a unique "id" and a "command".');
        return;
      }
      
      const job = new Job(jobData);
      await job.save();

      console.log(`✅ Job enqueued successfully: ${job.id}`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.error('Error: Invalid JSON provided.');
      } else if (err.code === 11000) {
        console.error(`Error: A job with ID "${JSON.parse(jobJson).id}" already exists.`);
      } else {
        console.error('Error enqueuing job:', err.message);
      }
    }
    await disconnectDB(); // <-- Disconnect here
  });

// --- `list` Command (Modified) ---
program
  .command('list')
  .description('List jobs by their state')
  .option('--state <state>', 'Filter by job state', 'pending')
  .action(async (options) => {
    await connectDB(); // <-- Connect here
    try {
      const { state } = options;
      const validStates = ['pending', 'processing', 'completed', 'failed', 'dead'];
      
      if (!validStates.includes(state)) {
        console.error(`Error: Invalid state "${state}". Must be one of: ${validStates.join(', ')}`);
        return;
      }

      const jobs = await Job.find({ state }).sort({ created_at: 1 });

      if (jobs.length === 0) {
        console.log(`No jobs found with state: ${state}`);
        return;
      }

      const output = jobs.map(job => ({
        id: job.id,
        command: job.command,
        state: job.state,
        attempts: job.attempts,
        run_at: job.run_at.toISOString(),
      }));

      console.log(`Jobs with state: ${state}`);
      console.table(output);
    } catch (err) {
      console.error('Error listing jobs:', err.message);
    }
    await disconnectDB(); // <-- Disconnect here
  });

// --- `config` Command Suite (Modified) ---
const configCmd = program.command('config')
  .description('Manage system configuration (retry, backoff, etc.)');

configCmd
  .command('set <key> <value>')
  .description('Set a new configuration value')
  .action(async (key, value) => {
    await connectDB(); // <-- Connect here
    try {
      let parsedValue;
      try {
        parsedValue = JSON.parse(value);
      } catch (e) {
        parsedValue = value;
      }

      const config = await Config.updateOne(
        { key }, 
        { value: parsedValue }, 
        { upsert: true }
      );

      if (config.upsertedCount > 0) {
        console.log(`✅ Config created: ${key} = ${parsedValue}`);
      } else {
        console.log(`✅ Config updated: ${key} = ${parsedValue}`);
      }
    } catch (err) {
      console.error('Error setting config:', err.message);
    }
    await disconnectDB(); // <-- Disconnect here
  });

configCmd
  .command('get <key>')
  .description('Get a configuration value')
  .action(async (key) => {
    await connectDB(); // <-- Connect here
    try {
      const config = await Config.findOne({ key });
      if (!config) {
        console.log(`Config not found: ${key}`);
        return;
      }
      console.log(`${config.key} = ${JSON.stringify(config.value)}`);
    } catch (err) {
      console.error('Error getting config:', err.message);
    }
    await disconnectDB(); // <-- Disconnect here
  });

// --- `dlq` Command Suite (Modified) ---
const dlqCmd = program.command('dlq')
  .description('Manage the Dead Letter Queue (DLQ)');

dlqCmd
  .command('list')
  .description('List all jobs in the DLQ')
  .action(async () => {
    await connectDB(); // <-- Connect here
    try {
      const jobs = await Job.find({ state: 'dead' }).sort({ updated_at: -1 });

      if (jobs.length === 0) {
        console.log('Dead Letter Queue is empty.');
        return;
      }

      const output = jobs.map(job => ({
        id: job.id,
        command: job.command,
        state: job.state,
        attempts: job.attempts,
        failed_at: job.updated_at.toISOString(),
      }));

      console.log('Jobs in the Dead Letter Queue:');
      console.table(output);
    } catch (err) {
      console.error('Error listing DLQ jobs:', err.message);
    }
    await disconnectDB(); // <-- Disconnect here
  });

dlqCmd
  .command('retry <jobId>')
  .description('Retry a specific job from the DLQ by its ID')
  .action(async (jobId) => {
    await connectDB(); // <-- Connect here
    try {
      const job = await Job.findOneAndUpdate(
        { id: jobId, state: 'dead' },
        {
          $set: {
            state: 'pending',
            attempts: 0,
            run_at: new Date(),
          }
        }
      );

      if (!job) {
        console.error(`Error: Job "${jobId}" not found in the DLQ.`);
        return;
      }

      console.log(`✅ Job ${jobId} has been moved from DLQ to 'pending' queue.`);
    } catch (err) {
      console.error('Error retrying DLQ job:', err.message);
    }
    await disconnectDB(); // <-- Disconnect here
  });

// --- NEW: `worker` Command Suite ---
const workerCmd = program.command('worker')
  .description('Manage worker processes');

workerCmd
  .command('start')
  .description('Start one or more worker processes')
  .option('--count <num>', 'Number of workers (default: # of CPU cores)', os.cpus().length)
  .action((options) => {
    // This command does NOT connect/disconnect the DB itself.
    // It either starts the master process or *becomes* the worker.

    if (cluster.isMaster) {
      // --- MASTER Process ---
      console.log(`[Master ${process.pid}] Starting...`);

      if (fs.existsSync(PID_FILE)) {
        console.error('Error: Workers already running. (PID file exists).');
        console.log('If this is a mistake, delete queuectl.pid and try again.');
        return;
      }
      
      fs.writeFileSync(PID_FILE, process.pid.toString());
      console.log(`[Master ${process.pid}] PID file created: ${PID_FILE}`);

      const workerCount = parseInt(options.count, 10);
      console.log(`[Master ${process.pid}] Forking ${workerCount} worker(s)...`);

      for (let i = 0; i < workerCount; i++) {
        cluster.fork();
      }

      cluster.on('exit', function (worker, _code, signal) {
          console.warn(`[Master ${process.pid}] Worker ${worker.process.pid} died. Forking new one...`);
          cluster.fork();
        });

      // Handle graceful shutdown for the MASTER
      process.on('SIGTERM', () => {
        console.log(`[Master ${process.pid}] Received SIGTERM. Shutting down all workers...`);
        for (const id in cluster.workers) {
          cluster.workers[id].kill('SIGTERM');
        }
        
        fs.unlinkSync(PID_FILE);
        console.log(`[Master ${process.pid}] PID file removed. Exiting.`);
        process.exit(0);
      });

    } else {
      // --- WORKER Process ---
      // This is the child process. It imports and runs the worker logic.
      const { startWorker } = require('./worker.js');
      startWorker();
    }
  });

workerCmd
  .command('stop')
  .description('Stop all running worker processes gracefully')
  .action(() => {
    // This command is a simple CLI tool, so it doesn't need to connect/disconnect
    if (!fs.existsSync(PID_FILE)) {
      console.log('Workers are not running (No PID file found).');
      return;
    }

    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
      console.log(`Sending SIGTERM to master process (PID: ${pid})...`);
      
      // Send the 'SIGTERM' signal to the MASTER process
      process.kill(pid, 'SIGTERM');
      
      console.log('Stop signal sent. Workers will shut down gracefully.');
    } catch (err) {
      console.error('Error stopping workers:', err.message);
      if (err.code === 'ESRCH') {
        console.log('Process not found. It may have already stopped.');
        fs.unlinkSync(PID_FILE); // Clean up stale PID file
        console.log('Removed stale PID file.');
      } else {
        console.log('You may need to manually remove queuectl.pid');
      }
    }
  });

// --- NEW: `status` Command ---
program
  .command('status')
  .description('Show summary of all job states & active workers')
  .action(async () => {
    await connectDB(); // <-- Connect here
    try {
      // 1. Get Job Status
      const stats = await Job.aggregate([
        { $group: { _id: '$state', count: { $sum: 1 } } }
      ]);
      console.log('--- Job Status ---');
      if (stats.length === 0) {
        console.log('No jobs in queue.');
      } else {
        const statsObj = stats.reduce((acc, s) => {
          acc[s._id] = s.count;
          return acc;
        }, {});
        console.table(statsObj);
      }

      // 2. Get Worker Status
      console.log('\n--- Worker Status ---');
      if (fs.existsSync(PID_FILE)) {
        const pid = fs.readFileSync(PID_FILE, 'utf8');
        console.log(`✅ Workers are ACTIVE (Master PID: ${pid})`);
      } else {
        console.log('Workers are INACTIVE.');
      }
    } catch (err) {
      console.error('Error fetching status:', err.message);
    }
    await disconnectDB(); // <-- Disconnect here
  });

// ... (All your other commands: enqueue, list, config, dlq, worker, status) ...

// --- NEW: `dashboard` Command (Bonus Feature) ---
program
  .command('dashboard')
  .description('Start a minimal web dashboard for monitoring')
  .option('--port <port>', 'Port to run the dashboard on', '3000')
  .action(async (options) => {
    // This command starts a long-running server, so it
    // connects to the DB once and stays connected.
    
    // 1. Import Express
    const express = require('express');
    const app = express();
    const port = parseInt(options.port, 10);

    // 2. Set up EJS templating
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views')); // Tell Express where our 'views' directory is

    // 3. Connect to the DB
    await connectDB();
    console.log(`[Dashboard] Connected to MongoDB.`);

    // 4. Define Routes

    // Main page
    app.get('/', (req, res) => {
      // Just render the EJS file
      res.render('dashboard');
    });

    // API endpoint to get stats
    app.get('/api/stats', async (req, res) => {
      try {
        // Get job counts
        const stats = await Job.aggregate([
          { $group: { _id: '$state', count: { $sum: 1 } } }
        ]);
        const counts = stats.reduce((acc, s) => {
          acc[s._id] = s.count;
          return acc;
        }, {});
        
        // Get DLQ jobs
        const dlqJobs = await Job.find({ state: 'dead' })
          .sort({ updated_at: -1 })
          .limit(50);

        res.json({ counts, dlqJobs });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // API endpoint to retry a DLQ job
    app.post('/api/dlq/retry/:jobId', async (req, res) => {
      try {
        const { jobId } = req.params;
        const job = await Job.findOneAndUpdate(
          { id: jobId, state: 'dead' },
          { $set: { state: 'pending', attempts: 0, run_at: new Date() } }
        );
        
        if (!job) {
          return res.status(404).json({ error: 'Job not found in DLQ' });
        }
        res.json({ success: true, message: `Job ${jobId} retried.` });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // 5. Start the server
    app.listen(port, () => {
      console.log(`[Dashboard] Server starting...`);
      console.log(`✅ Dashboard running on http://localhost:${port}`);
    });
    
    // Handle graceful shutdown (Ctrl+C)
    process.on('SIGINT', async () => {
      console.log('\n[Dashboard] Shutting down... Disconnecting from DB...');
      await disconnectDB();
      process.exit(0);
    });
  });
  
  // ... (all existing commands: enqueue, list, config, dlq, worker, status, dashboard) ...

// --- NEW: `log` Command (Bonus Feature) ---
program
  .command('log <jobId>')
  .description('View the saved output and error logs for a specific job')
  .action(async (jobId) => {
    await connectDB();
    try {
      const job = await Job.findOne({ id: jobId });

      if (!job) {
        console.error(`Error: Job "${jobId}" not found.`);
        await disconnectDB();
        return;
      }

      console.log(`--- 🪵 Logs for Job: ${job.id} [${job.state}] ---`);
      
      console.log('\n--- STDOUT ---');
      if (job.output) {
        console.log(job.output);
      } else {
        console.log('(No standard output recorded)');
      }
      
      console.log('\n--- STDERR / ERROR ---');
      if (job.error) {
        console.log(job.error);
      } else {
        console.log('(No error output recorded)');
      }

      console.log('-------------------------------------------');

    } catch (err) {
      console.error('Error fetching logs:', err.message);
    }
    await disconnectDB();
  });


// --- Final Step ---
program.parse(process.argv);