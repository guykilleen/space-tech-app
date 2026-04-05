// Loaded by jest before any test file — sets test DB env vars
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });
