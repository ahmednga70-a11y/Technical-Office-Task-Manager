import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import healthRouter from "./routes/health";
import { logger } from "./lib/logger";
import { externalClerkConfiguration, usesExternalClerk } from "./lib/clerkConfiguration";
import { officePasswordSessionMiddleware } from "./lib/officePasswordAuth";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
const passwordAuthEnabled = process.env.OFFICE_AUTH_MODE === "password";

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Liveness must not depend on auth credentials, sessions, or database access.
app.use("/api", healthRouter);
if (!passwordAuthEnabled && !usesExternalClerk()) {
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
}
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (passwordAuthEnabled) {
  app.use("/api", officePasswordSessionMiddleware);
} else if (usesExternalClerk()) {
  const config = externalClerkConfiguration();
  if (config.publishableKey && config.secretKey) {
    // External Clerk uses its own instance domain; never manufacture a
    // clerk.<vercel-host> domain or send its keys to the managed proxy.
    app.use(clerkMiddleware(config));
  } else {
    app.use("/api", (_req, res) => {
      res.status(503).json({
        error: "Authentication is not configured on this deployment.",
        code: "AUTH_NOT_CONFIGURED",
      });
    });
  }
} else {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}

app.use("/api", router);

export default app;
