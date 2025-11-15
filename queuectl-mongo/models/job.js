const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema(
  {
    // This is the user-provided unique job ID [cite: 20]
    id: {
      type: String,
      required: true,
      unique: true,
      index: true, // Index for faster lookups by ID
    },
    
    // The shell command to execute [cite: 21]
    command: {
      type: String,
      required: true,
    },
    
    // The current state of the job [cite: 22, 29]
    state: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'dead'],
      default: 'pending',
      index: true, // Workers will query on this field
    },
    
    // Number of times this job has been attempted [cite: 23]
    attempts: {
      type: Number,
      default: 0,
    },
    
    // Max number of retries for this specific job [cite: 24]
    max_retries: {
      type: Number,
      default: 3, // Default from the spec example
    },

    // When the job should be run. Used for exponential backoff.
    // Workers will only grab jobs where run_at <= now
    run_at: {
      type: Date,
      default: Date.now,
      index: true, // Workers will query and sort on this
    },

    timeout: {
      type: Number,
      default: 60000, // Default 60 seconds
    },

    // Persisted logs and priority for worker sorting
    output: { type: String, default: '' },
    error:  { type: String, default: '' },
    priority: { type: Number, default: 0, index: true },
  },
  {
    // Mongoose's timestamps option automatically handles
    // 'created_at' and 'updated_at' fields 
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    // We set versionKey to false because we don't need the __v field
    versionKey: false,
  }
);

// Create and export the Mongoose model
module.exports = mongoose.model('Job', jobSchema);