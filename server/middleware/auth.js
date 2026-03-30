const jwt = require('jsonwebtoken');

// Verify JWT and attach user to req
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, name, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Role-based access: pass one or more allowed roles
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Convenience role guards
const isAdmin      = authorize('admin');
const isAdminOrMgr = authorize('admin', 'manager');
const notReadonly  = authorize('admin', 'manager', 'workshop');

module.exports = { authenticate, authorize, isAdmin, isAdminOrMgr, notReadonly };
