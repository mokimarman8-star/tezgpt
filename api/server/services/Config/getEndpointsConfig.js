const { createEndpointsConfigService } = require('@tezgpt/api');
const loadDefaultEndpointsConfig = require('./loadDefaultEConfig');
const { getAppConfig } = require('./app');

const { getEndpointsConfig, checkCapability } = createEndpointsConfigService({
  getAppConfig,
  loadDefaultEndpointsConfig,
});

module.exports = { getEndpointsConfig, checkCapability };
