import app from "./app";

// Vercel owns the HTTP listener. Database schema changes must be applied
// explicitly, not during requests or on each serverless cold start.
export default app;
