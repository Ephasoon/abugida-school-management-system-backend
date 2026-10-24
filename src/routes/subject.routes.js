// src/routes/subject.routes.js — subjects (Phase 2 G3, M7)
const express = require('express');
const router  = express.Router();
const { getSubjects, createSubject, updateSubject, deleteSubject } = require('../controllers/subject.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { adminOnly, allStaff } = require('../middleware/role.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');

router.use(authenticate);

const checkIds = validateIds({ id: 'subjects' });   // malformed/unknown ids -> 404 (after role checks)

router.get   ('/',    allStaff,  getSubjects);   // ?status=active|inactive|all (default all)
router.post  ('/',    adminOnly, createSubject);
router.put   ('/:id', adminOnly, checkIds, updateSubject);
router.delete('/:id', adminOnly, checkIds, deleteSubject);   // unused subjects only (409 otherwise)

module.exports = router;
