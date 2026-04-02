const router = require('express').Router();
const { authenticate, isAdminOrMgr } = require('../middleware/auth');
const ctrl = require('../controllers/qb_price_list_controller');

router.use(authenticate, isAdminOrMgr);

router.get('/',                    ctrl.getAll);   // ?category=Materials&active=true
router.get('/:id',                 ctrl.getOne);
router.post('/',                   ctrl.create);
router.put('/:id',                 ctrl.update);
router.patch('/:id/toggle-active', ctrl.toggleActive);
router.delete('/:id',              ctrl.remove);

module.exports = router;
