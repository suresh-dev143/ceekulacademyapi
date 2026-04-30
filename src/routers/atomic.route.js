'use strict';

const express = require('express');
const router = express.Router();
const atomicController = require('../controllers/atomicController');
const { authenticateUser } = require('../middlewares');

// The Save Engine: Autosave draft layer
router.post('/autosave', authenticateUser, atomicController.autosave);

// The Evolution Engine: Layered updates
router.post('/update', authenticateUser, atomicController.addUpdate);

// The Global Dispatcher: Use & Send
router.post('/dispatch', authenticateUser, atomicController.dispatch);

// CRUD Operations
router.get('/list', authenticateUser, atomicController.listMyContent);
router.delete('/:id', authenticateUser, atomicController.deleteContent);

// Retrieval
router.get('/:id', authenticateUser, atomicController.getEvolution);

module.exports = router;
