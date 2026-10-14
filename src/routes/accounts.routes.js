// src/routes/accounts.routes.js
// School-created accounts and passwords: admin only (docs/PERMISSIONS.md).
const express = require('express');
const router  = express.Router();
const {
  getUsers, createStudentLogin, getParents, createParent,
  createParentLogin, linkChild, unlinkChild, createPrincipal,
  setPrincipalStatus, setParentStatus, setStudentStatus, resetPassword,
} = require('../controllers/accounts.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { adminOnly }    = require('../middleware/role.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');

router.use(authenticate);

const checkIds = validateIds();   // malformed/unknown ids -> 404 (after role + access checks)
router.use(adminOnly);

router.get   ('/users',                                getUsers);
router.post  ('/users/:userId/reset-password',          checkIds, resetPassword);
router.post  ('/students/:studentId/login',             checkIds, createStudentLogin);
router.put   ('/students/:studentId/status',            checkIds, setStudentStatus);     // { is_active }
router.get   ('/parents',                              getParents);
router.post  ('/parents',                              createParent);
router.post  ('/parents/:parentId/login',               checkIds, createParentLogin);   // existing parent, no login yet
router.put   ('/parents/:parentId/status',              checkIds, setParentStatus);     // { is_active }
router.post  ('/parents/:parentId/children',            checkIds, linkChild);
router.delete('/parents/:parentId/children/:studentId', checkIds, unlinkChild);
router.post  ('/principals',                           createPrincipal);
router.put   ('/principals/:userId/status',             checkIds, setPrincipalStatus);   // { is_active }

module.exports = router;
