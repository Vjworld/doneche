// Netlify serverless function entrypoint.
// Wraps the shared Express app (../../app.js) with serverless-http so
// Netlify can invoke it for every request routed by netlify.toml.
const serverless = require('serverless-http');
const app = require('../../app');

exports.handler = serverless(app);
