// src/routes/class.routes.js — classes per academic year (Phase 2 G2, M7a)
const express = require('express');
const router  = express.Router();
const { getClasses, createClass, updateClass } = require('../controllers/class.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { adminOnly, allStaff } = require('../middleware/role.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');
const { validateBodyIds } = require('../middleware/validateBodyIds.middleware');

router.use(authenticate);

const checkIds = validateIds({ id: 'classes' });   // malformed/unknown ids -> 404 (after role checks)

router.get ('/',    allStaff,  getClasses);   // ?academic_year_id= (default: the current year)
router.post('/',    adminOnly, validateBodyIds({ academic_year_id: 'academic_years', homeroom_teacher_id: 'teachers' }), createClass);
router.put ('/:id', adminOnly, checkIds, validateBodyIds({ homeroom_teacher_id: 'teachers' }), updateClass);

module.exports = router;
