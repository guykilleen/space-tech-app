const router = require('express').Router();
const { authenticate, isAdminOrMgr } = require('../middleware/auth');
const ctrl = require('../controllers/qb_labour_rates_controller');

router.use(authenticate, isAdminOrMgr);

router.get('/',          ctrl.getAll);
router.patch('/:type',   ctrl.updateRate);

module.exports = router;
