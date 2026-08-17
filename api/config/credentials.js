require('dotenv').config();

const { bootstrapCredentials } = require('@tezgpt/api/credentials');

module.exports = bootstrapCredentials();
