const router = require('express').Router();
const { authenticate, isAdmin, isAdminOrMgr } = require('../middleware/auth');
const ctrl = require('../controllers/usersController');

router.use(authenticate);

router.get('/',           isAdminOrMgr, ctrl.getAll);
router.get('/:id',        isAdminOrMgr, ctrl.getOne);
router.post('/',          isAdmin,      ctrl.create);
router.put('/:id',        isAdmin,      ctrl.update);
router.delete('/:id',     isAdmin,      ctrl.deactivate);

module.exports = router;
