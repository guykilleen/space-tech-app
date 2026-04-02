const router = require('express').Router();
const { authenticate, isAdminOrMgr } = require('../middleware/auth');
const ctrl = require('../controllers/qb_contacts_controller');

router.use(authenticate, isAdminOrMgr);

router.get('/',      ctrl.getAll);
router.get('/:id',   ctrl.getOne);
router.post('/',     ctrl.create);
router.put('/:id',   ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
