const router = require('express').Router();
const multer = require('multer');
const { authenticate, isAdminOrMgr, isAdmin } = require('../middleware/auth');
const { importXlsx, clearAll } = require('../controllers/importController');

// Store file in memory — no disk writes needed
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel.sheet.macroEnabled.12',                    // .xlsm
      'application/vnd.ms-excel',                                           // .xls
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xlsm|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx / .xlsm / .xls files are accepted'));
    }
  },
});

router.use(authenticate);

router.post('/xlsx', isAdminOrMgr, upload.single('file'), importXlsx);
router.delete('/clear-all', isAdmin, clearAll);

module.exports = router;
