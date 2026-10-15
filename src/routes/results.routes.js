// src/routes/results.routes.js — results (B2) and school settings
const express = require('express');
const { getStudentResults, getClassResults, getSettings, updateSetting } = require('../controllers/results.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { adminOnly, allStaff, allAuthenticated } = require('../middleware/role.middleware');
const { requireStudentAccess, requireClassAccess } = require('../middleware/studentAccess.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');

const checkIds = validateIds();   // malformed/unknown ids -> 404 (after role + access checks)

const results = express.Router();
results.use(authenticate);
results.get('/student/:studentId', allAuthenticated, requireStudentAccess('studentId'), checkIds, getStudentResults);
results.get('/class/:classId',     allStaff, requireClassAccess('classId'), checkIds, getClassResults);

const settings = express.Router();
settings.use(authenticate);
settings.get('/',     allStaff, getSettings);
settings.put('/:key', adminOnly, updateSetting);

module.exports = { results, settings };
