const router = require('express').Router();
const { authenticate, isAdminOrMgr, notReadonly } = require('../middleware/auth');
const ctrl = require('../controllers/quotesController');

router.use(authenticate);

router.get('/',                      ctrl.getAll);         // all roles can view
router.get('/next-number',           ctrl.getNextNumber);
router.get('/:id',                   ctrl.getOne);
router.post('/',                     isAdminOrMgr, ctrl.create);
router.put('/:id',                   isAdminOrMgr, ctrl.update);
router.patch('/:id/status',          isAdminOrMgr, ctrl.updateStatus);
router.delete('/:id',                isAdminOrMgr, ctrl.remove);

module.exports = router;
