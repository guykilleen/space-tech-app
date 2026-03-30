const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { login, me } = require('../controllers/authController');

router.post('/login', login);
router.get('/me', authenticate, me);

module.exports = router;
