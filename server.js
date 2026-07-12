// Local development entrypoint. Production (Netlify) uses
// netlify/functions/app.js which wraps the same Express app from app.js.
require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`doneche running on http://localhost:${PORT}`);
});
