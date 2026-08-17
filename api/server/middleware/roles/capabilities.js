const { generateCapabilityCheck, capabilityContextMiddleware } = require('@tezgpt/api');
const {
  getUserPrincipals,
  hasAnyConfigReadAccess,
  hasCapabilityForPrincipals,
  getHeldCapabilities,
} = require('~/models');

const {
  hasCapability,
  requireCapability,
  hasConfigCapability,
  hasAnyConfigReadAccess: checkAnyConfigReadAccess,
  getReadableConfigSections,
} = generateCapabilityCheck({
  getUserPrincipals,
  hasAnyConfigReadAccess,
  hasCapabilityForPrincipals,
  getHeldCapabilities,
});

module.exports = {
  hasCapability,
  requireCapability,
  hasConfigCapability,
  capabilityContextMiddleware,
  hasAnyConfigReadAccess: checkAnyConfigReadAccess,
  getReadableConfigSections,
};
