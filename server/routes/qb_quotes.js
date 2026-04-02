const router = require('express').Router();
const { authenticate, isAdminOrMgr } = require('../middleware/auth');
const ctrl = require('../controllers/qb_quotes_controller');

router.use(authenticate, isAdminOrMgr);

// Quote headers — full nested save (header + all units + lines in one call)
router.get('/next-number',   ctrl.getNextNumber);
router.get('/',              ctrl.getAll);
router.get('/:id',           ctrl.getOne);
router.post('/',             ctrl.create);
router.put('/:id',           ctrl.update);
router.patch('/:id/status',  ctrl.updateStatus);
router.delete('/:id',        ctrl.remove);

// Computed read-only views
router.get('/:id/summary',   ctrl.getSummary);
router.get('/:id/budget',    ctrl.getBudgetQty);
router.get('/:id/pdf',       ctrl.getPdf);

module.exports = router;
