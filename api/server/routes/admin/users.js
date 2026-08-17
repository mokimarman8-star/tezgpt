const express = require('express');
const { createAdminUsersHandlers } = require('@tezgpt/api');
const { SystemCapabilities } = require('@tezgpt/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
// const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const handlers = createAdminUsersHandlers({
  findUsers: db.findUsers,
  countUsers: db.countUsers,
  deleteUserById: db.deleteUserById,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadUsers, handlers.listUsers);
router.get('/search', requireReadUsers, handlers.searchUsers);
// router.delete('/:id', requireManageUsers, handlers.deleteUser);

module.exports = router;
