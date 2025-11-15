const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  // The name of the configuration setting (e.g., "max_retries")
  key: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  
  // The value of the setting
  value: {
    type: mongoose.Schema.Types.Mixed, // 'Mixed' can store any data type
    required: true,
  },
});

// Create and export the Mongoose model
module.exports = mongoose.model('Config', configSchema);