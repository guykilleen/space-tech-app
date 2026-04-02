require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth',           require('./routes/auth'));
app.use('/api/users',          require('./routes/users'));
app.use('/api/quotes',         require('./routes/quotes'));
app.use('/api/jobs',           require('./routes/jobs'));
app.use('/api/import',         require('./routes/import'));
// Quote Builder
app.use('/api/qb/contacts',   require('./routes/qb_contacts'));
app.use('/api/qb/price-list', require('./routes/qb_price_list'));
app.use('/api/qb/quotes',     require('./routes/qb_quotes'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '../client/build');
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
} else {
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
}

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Space Tech Design API running on port ${PORT}`));
