import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { existsSync } from "node:fs";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";
import { HttpError } from "./lib/http-error";
import { resolveFrontendDistDir } from "./lib/paths";

const app: Express = express();

/**
 * Disable the framework fingerprint so responses do not advertise the server
 * technology. Also set `trust proxy` in `index.ts` so client IPs (used by the
 * login rate limiter) are correct behind the platform's proxy.
 */
app.disable("x-powered-by");

/**
 * Security headers.
 *
 * The content-security-policy is deliberately permissive enough for the
 * existing UI, which loads Google Fonts and injects inline styles through
 * Tailwind and Framer Motion, while still blocking the dangerous classes:
 * object embedding, and framing by third parties.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        // React sets inline styles via the style attribute, which
        // style-src-attr covers separately from style-src-elem.
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        ...(process.env.NODE_ENV === "production"
          ? { "upgrade-insecure-requests": [] }
          : {}),
      },
    },
    // The app is same-origin and serves no user-uploaded content, so these can
    // be locked down tightly.
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts:
      process.env.NODE_ENV === "production"
        ? { maxAge: 15_552_000, includeSubDomains: true }
        : false,
  }),
);

/**
 * CORS.
 *
 * In the recommended deployment the frontend is served from this same process,
 * so cross-origin requests are unnecessary and are refused. `ALLOWED_ORIGINS`
 * is available for an operator who deliberately splits the frontend onto a
 * different host.
 *
 * The origin check must explicitly allow this server's *own* origin. Browsers
 * attach an `Origin` header to same-origin POST/PUT/DELETE requests (only plain
 * GET is usually sent without one), so a naive "allowlist or reject" policy
 * breaks every form submission - including sign-in - on the deployed app. The
 * request's real origin is derived from the forwarded host/proto that the
 * platform's proxy sets.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  maxAge: 600,
} satisfies cors.CorsOptions;

function forwardedProtocol(req: express.Request): string {
  const header = req.headers["x-forwarded-proto"];
  const first = Array.isArray(header) ? header[0] : header;
  return first?.split(",")[0]?.trim() || req.protocol;
}

app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;

    // Non-browser clients (curl, health checks) send no Origin header.
    if (!origin) {
      callback(null, { ...corsOptions, origin: true });
      return;
    }

    const host = req.headers.host;
    const selfOrigin = host
      ? `${forwardedProtocol(req)}://${host}`
      : undefined;

    if (selfOrigin && origin === selfOrigin) {
      callback(null, { ...corsOptions, origin: true });
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, { ...corsOptions, origin: true });
      return;
    }

    // Local Vite dev server on a different port, when nothing is configured.
    if (process.env.NODE_ENV !== "production" && allowedOrigins.length === 0) {
      callback(null, { ...corsOptions, origin: true });
      return;
    }

    // Refuse by omitting the CORS headers rather than throwing: the browser
    // then blocks the read, and a legitimate same-origin request that only
    // tripped this by a proxy-header quirk still receives its real response.
    callback(null, { ...corsOptions, origin: false });
  }),
);

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

/**
 * Broad abuse guard for the whole API surface.
 *
 * Public product and verification lookups are unauthenticated by design so a
 * printed QR code works for anyone, but each call costs a database query and a
 * ledger read. Without a ceiling, one client can enumerate product IDs or
 * exhaust the small connection pool. The limit is deliberately generous - it
 * targets abuse, not normal use - while the sign-in route keeps its own much
 * stricter limiter.
 */
const apiAbuseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT ?? 600),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  message: { error: "Too many requests. Please slow down and try again." },
});

app.use("/api", apiAbuseLimiter);

// A bounded JSON body limit. Without it a single request could allocate a large
// buffer and exhaust memory on a free-tier instance.
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use("/api", router);

/**
 * Serve the production frontend build from the same process.
 *
 * In production the React build is served here rather than by a second service,
 * so the app runs on one host and `/api` is same-origin. The SPA history
 * fallback must not intercept `/api`, otherwise a mistyped API route would
 * return HTML with a 200 status instead of a JSON error.
 */
const frontendDist = resolveFrontendDistDir();

if (frontendDist) {
  app.use(
    express.static(frontendDist, {
      index: false,
      maxAge: "1y",
      setHeaders(res, filePath) {
        // Hashed assets can be cached aggressively; the HTML entry point must
        // not be, or clients would keep loading a stale asset manifest.
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(frontendDist, "index.html"));
  });
  logger.info({ frontendDist }, "Serving the production frontend build");
} else {
  logger.warn(
    "The frontend build was not found. Run the frontend build, or set SERVE_FRONTEND=false if the frontend is hosted separately.",
  );
}

/**
 * A JSON 404 for unmatched API paths.
 *
 * Without this, an unknown `/api/...` path falls through to Express's default
 * HTML error page, which a fetch-based client cannot parse and which can mask a
 * mistyped route as a deployment problem.
 */
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

/**
 * Map an error to a client-visible status.
 *
 * Body parser and similar middleware attach a 4xx `status` to their errors.
 * Returning 500 for those hides the real cause (for example a 413 "request
 * entity too large" reported as a server fault) and makes client debugging
 * harder, so a trustworthy 4xx is preserved. Anything else stays a 500.
 */
function clientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : undefined;
  return status !== undefined && status >= 400 && status < 500
    ? status
    : undefined;
}

app.use(
  (
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    const status = clientErrorStatus(error);
    if (status) {
      const type =
        typeof error === "object" && error !== null && "type" in error
          ? String((error as { type?: unknown }).type)
          : "client error";
      logger.warn({ err: error, status }, "Rejected client request");
      res.status(status).json({ error: `Request rejected: ${type}.` });
      return;
    }

    // Log the real cause server-side; return a generic message so stack traces,
    // SQL fragments, and connection strings never reach the client.
    req.log.error({ err: error }, "Unhandled API request error");
    res.status(500).json({ error: "The request could not be completed." });
  },
);

export default app;
