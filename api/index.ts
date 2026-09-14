// Vercel serverless entry point. Every request to /api/* is rewritten here
// (see vercel.json) and handled by the same Express app used for local
// development — Express apps are themselves valid (req, res) handlers, so
// no separate serverless-specific routing code is needed.
import app from '../server';

export default app;
