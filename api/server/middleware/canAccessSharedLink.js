const mongoose = require('mongoose');
const { createSharedLinkAccessMiddleware } = require('@tezgpt/api');

const canAccessSharedLink = createSharedLinkAccessMiddleware({ mongoose });

module.exports = canAccessSharedLink;
