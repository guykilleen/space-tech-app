require('dotenv').config();
const app  = require('./app');
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Space Tech Design API running on port ${PORT}`));
