const { connectDB, disconnectDB } = require('./db');
const Job = require('./models/job');
const Config = require('./models/config');
const { exec } = require('child_process');
const util = require('util');

// Promisify child_process.exec to use async/await
const execPromise = util.promisify(exec);
// Helper function to pause execution
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Global object to hold our fetched config
const systemConfig = {
  max_retries: 3,    // Default
  backoff_base: 2,   // Default (delay = 2 ^ attempts)
  job_timeout: 30000, // Default 30-second timeout (in ms)
};

/**
 * Fetches config from the DB to override defaults on startup.
 */
async function loadConfig() {
  try {
    const maxRetries = await Config.findOne({ key: 'max_retries' });
    const backoffBase = await Config.findOne({ key: 'backoff_base' });
    const jobTimeout = await Config.findOne({ key: 'job_timeout' });

    if (maxRetries) {
      systemConfig.max_retries = parseInt(maxRetries.value, 10);
    }
    if (backoffBase) {
      systemConfig.backoff_base = parseInt(backoffBase.value, 10);
    }
    if (jobTimeout) {
      systemConfig.job_timeout = parseInt(jobTimeout.value, 10);
    }
    console.log('[Worker] Config loaded:', systemConfig);
  } catch (err) {
    console.error('[Worker] Error loading config, using defaults.', err.message);
  }
}

/**
 * Atomically finds and locks the next available job.
 * This now sorts by priority.
 */
async function fetchAndLockJob() {
  const job = await Job.findOneAndUpdate(
    // Find a job that is 'pending' AND 'ready' to be run
    { state: 'pending', run_at: { $lte: new Date() } },
    
    // Atomically update it so no other worker can grab it
    { $set: { 
        state: 'processing', 
        updated_at: new Date() 
      } 
    },
    
    // Options
    {
      // --- UPDATED SORT LOGIC ---
      // 1. Sort by priority (descending, higher numbers first)
      // 2. Tie-breaker is created_at (ascending, FIFO)
      sort: { 
        priority: -1,
        created_at: 1
      },
      // --- END OF UPDATE ---
      
      returnNewDocument: true   // Return the *updated* doc
    }
  );
  return job; // This will be the job, or 'null' if none are found
}

/**
 * Executes the job's command with timeout and retry/DLQ logic.
 * @param {import('mongoose').Document} job - The job to execute
 */
// In worker.js

/**
 * Executes the job's command with timeout, priority, and logging.
 * @param {import('mongoose').Document} job - The job to execute
 */
async function executeJob(job) {
  let jobOutput = '';
  let jobError = '';

  try {
    const timeout = job.timeout || systemConfig.job_timeout;
    console.log(`[Worker] Executing job ${job.id}: ${job.command} (priority: ${job.priority}, timeout: ${timeout}ms)`);
    
    const { stdout, stderr } = await execPromise(job.command, { timeout });

    // Capture output
    jobOutput = stdout.trim();
    jobError = stderr.trim(); // stderr can contain warnings

    if (jobError) {
      console.warn(`[Worker] Job ${job.id} stderr: ${jobError}`);
    }

    console.log(`[Worker] Job ${job.id} completed. Output: ${jobOutput}`);
    
    // --- FIX 1: SAVE LOGS ON SUCCESS ---
    await Job.updateOne(
      { _id: job._id }, // Use job._id, not job.id
      { $set: { 
          state: 'completed',
          output: jobOutput, // Add this
          error: jobError    // Add this
        } 
      }
    );

  } catch (error) {
    console.error(`[Worker] Job ${job.id} FAILED. Handling retry/DLQ...`);

    // Capture error output
    jobError = error.message;
    if (error.stderr) {
      jobError += `\n--- STDERR ---\n${error.stderr.trim()}`;
    }
    if (error.stdout) {
      jobOutput = error.stdout.trim();
    }
    
    if (error.killed && error.signal === 'SIGTERM') {
      const timeoutMsg = `Job TIMED OUT (exceeded ${job.timeout || systemConfig.job_timeout}ms).`;
      console.error(`[Worker] Reason: ${timeoutMsg}`);
      jobError = `${timeoutMsg}\n${jobError}`;
    } else {
      console.error(`[Worker] Reason: ${error.message}`);
    }

    // Retry/DLQ logic
    const newAttempts = job.attempts + 1;
    const maxRetries = job.max_retries || systemConfig.max_retries;

    if (newAttempts >= maxRetries) {
      // --- FIX 2: SAVE LOGS ON DLQ ---
      console.warn(`[Worker] Job ${job.id} has reached max retries. Moving to DLQ.`);
      await Job.updateOne(
        { _id: job._id },
        {
          $set: { 
            state: 'dead', 
            attempts: newAttempts,
            output: jobOutput, // Add this
            error: jobError    // Add this
          }
        }
      );
    } else {
      // --- FIX 3: SAVE LOGS ON RETRY ---
      const delaySeconds = Math.pow(systemConfig.backoff_base, newAttempts);
      const newRunAt = new Date(Date.now() + delaySeconds * 1000);
      console.warn(`[Worker] Job ${job.id} retrying (attempt ${newAttempts}/${maxRetries}). Next run at: ${newRunAt.toISOString()}`);
      
      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            state: 'pending',
            attempts: newAttempts,
            run_at: newRunAt,
            output: jobOutput, // Add this
            error: jobError    // Add this
          }
        }
      );
    }
  }
}

/**
 * The main worker function.
 * This is exported and called by the master process (in queuectl.js).
 */
// Top-level module functions and logic...
async function startWorker() {
  console.log(`[Worker ${process.pid}] Starting... Connecting to DB...`);
  await connectDB();
  await loadConfig();
  console.log(`[Worker ${process.pid}] Connected. Polling for jobs...`);

  let running = true;

  // Graceful shutdown handler
  process.on('SIGTERM', async () => {
    console.log(`[Worker ${process.pid}] Received SIGTERM. Shutting down gracefully...`);
    running = false;
  });

  // The main loop
  while (running) {
    const job = await fetchAndLockJob();

    if (job) {
      await executeJob(job);
    } else {
      // No jobs found, sleep for a bit to avoid
      // spamming the database.
      await sleep(2000); // Poll every 2 seconds
    }
  }
  
  // Loop has ended, disconnect and exit
  console.log(`[Worker ${process.pid}] Work loop stopped. Disconnecting...`);
  await disconnectDB();
  console.log(`[Worker ${process.pid}] Exited.`);
}

// Export the startWorker function to be used by cluster
module.exports = { startWorker };
if (require.main === module) {
  startWorker();
}