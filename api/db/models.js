const mongoose = require('mongoose');
const { createModels } = require('@tezgpt/data-schemas');
const models = createModels(mongoose);

module.exports = { ...models };
