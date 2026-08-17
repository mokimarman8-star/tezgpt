const {
  GenerationJobManager,
  createMessageRequestMiddleware,
  isPendingActionStale,
} = require('@tezgpt/api');
const { logger } = require('@tezgpt/data-schemas');
const { getConvoOwnership } = require('~/models');

module.exports = createMessageRequestMiddleware({
  getConvo: getConvoOwnership,
  getJob: (conversationId) => GenerationJobManager.getJob(conversationId),
  isPendingActionStale,
  logger,
});
