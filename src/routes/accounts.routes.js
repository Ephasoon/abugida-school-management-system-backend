// src/routes/accounts.routes.js
// School-created accounts and passwords: admin only (docs/PERMISSIONS.md).
const express = require('express');
const router  = express.Router();
const {
  getUsers, createStudentLogin, getParents, createParent,
  createParentLogin, linkChild, unlinkChild, createPrincipal,
  setPrincipalStatus, resetPassword,
} = require('../controllers/accounts.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { adminOnly }    = require('../middleware/role.middleware');

router.use(authenticate);
router.use(adminOnly);

router.get   ('/users',                                getUsers);
router.post  ('/users/:userId/reset-password',         resetPassword);
router.post  ('/students/:studentId/login',            createStudentLogin);
router.get   ('/parents',                              getParents);
router.post  ('/parents',                              createParent);
router.post  ('/parents/:parentId/login',              createParentLogin);   // existing parent, no login yet
router.post  ('/parents/:parentId/children',           linkChild);
router.delete('/parents/:parentId/children/:studentId', unlinkChild);
router.post  ('/principals',                           createPrincipal);
router.put   ('/principals/:userId/status',            setPrincipalStatus);   // { is_active }

module.exports = router;
