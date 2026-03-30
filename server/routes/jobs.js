const router = require('express').Router();
const { authenticate, isAdminOrMgr, notReadonly } = require('../middleware/auth');
const ctrl = require('../controllers/jobsController');

router.use(authenticate);

router.get('/',                       ctrl.getAll);
router.get('/:id',                    ctrl.getOne);
router.post('/',                      isAdminOrMgr, ctrl.create);
router.put('/:id',                    isAdminOrMgr, ctrl.update);
router.patch('/:id/wip',              notReadonly,  ctrl.updateWip);   // workshop can update %/due
router.delete('/:id',                 isAdminOrMgr, ctrl.remove);
router.post('/convert-quote/:id',     isAdminOrMgr, ctrl.convertFromQuote);

module.exports = router;
