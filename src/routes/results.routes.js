// src/routes/results.routes.js — results (B2), conduct, promotion decisions, semester locks,
// and school settings
const express = require('express');
const { getStudentResults, getClassResults, getSettings, updateSetting } = require('../controllers/results.controller');
const { getConduct, putConduct, putStudentPromotion, putClassPromotion, getLocks, createLock, deleteLock } = require('../controllers/resultsAdmin.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { adminOnly, allStaff, allAuthenticated, schoolLeaders, teacherOrAdmin } = require('../middleware/role.middleware');
const { requireStudentAccess, requireClassAccess } = require('../middleware/studentAccess.middleware');
const { requireHomeroom, requireHomeroomOrClass } = require('../middleware/homeroom.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');

const checkIds = validateIds();   // malformed/unknown ids -> 404 (after role + access checks)

const results = express.Router();
results.use(authenticate);
results.get('/student/:studentId', allAuthenticated, requireStudentAccess('studentId'), checkIds, getStudentResults);
results.get('/class/:classId',     allStaff, requireClassAccess('classId'), checkIds, getClassResults);
// Conduct and remark (D23): the homeroom teacher of the class and the admin enter them
results.get('/class/:classId/conduct', allStaff, requireHomeroomOrClass('classId'), checkIds, getConduct);
results.put('/class/:classId/conduct', teacherOrAdmin, requireHomeroom('classId'), checkIds, putConduct);
// Manual promotion decisions (D26)
results.put('/student/:studentId/promotion', adminOnly, checkIds, putStudentPromotion);
results.put('/class/:classId/promotion',     adminOnly, checkIds, putClassPromotion);
// Semester locks (D29)
results.get('/locks',        schoolLeaders, getLocks);
results.post('/locks',       adminOnly, createLock);
results.delete('/locks/:id', adminOnly, deleteLock);

const settings = express.Router();
settings.use(authenticate);
settings.get('/',     allStaff, getSettings);
settings.put('/:key', adminOnly, updateSetting);

module.exports = { results, settings };
