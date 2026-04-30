'use strict';

const express  = require('express');
const router   = express.Router();
const {
  listSupplies, getSupply, createSupply, updateSupply,
  addResource, removeResource, deleteSupply
} = require('../controllers/supplyController');
const authenticateAny = require('../middlewares/authenticateAny');

router.get('/',                             listSupplies);
router.get('/:id',                          getSupply);
router.post('/',                            authenticateAny, createSupply);
router.put('/:id',                          authenticateAny, updateSupply);
router.delete('/:id',                       authenticateAny, deleteSupply);
router.post('/:id/resource',                authenticateAny, addResource);
router.delete('/:id/resource/:resourceId',  authenticateAny, removeResource);

module.exports = router;
