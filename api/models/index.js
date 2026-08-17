const mongoose = require('mongoose');
const { createMethods } = require('@tezgpt/data-schemas');
const { matchModelName, findMatchingPattern, isDeploymentSkillId } = require('@tezgpt/api');
const getLogStores = require('~/cache/getLogStores');

const methods = createMethods(mongoose, {
  matchModelName,
  findMatchingPattern,
  isExternalSkillId: isDeploymentSkillId,
  getCache: getLogStores,
});

const seedDatabase = async () => {
  await methods.initializeRoles();
  await methods.seedDefaultRoles();
  await methods.ensureDefaultCategories();
  await methods.seedSystemGrants();
};

module.exports = {
  ...methods,
  seedDatabase,
};
