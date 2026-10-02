/**
 * Resolve the public base URL that customer-facing QR codes must point at.
 *
 * A QR code printed on a product label has to keep working after deployment, so
 * it must never encode a development address. Resolution order:
 *
 *  1. `VITE_PUBLIC_URL` - the deployed HTTPS origin, baked in at build time.
 *  2. `window.location.origin` - the origin the page is actually served from.
 *
 * Option 2 already yields the deployed URL once the app is live, so the QR code
 * is correct without configuration. `VITE_PUBLIC_URL` exists for the case where
 * the printed QR must carry a specific canonical host (for example a custom
 * domain, or a URL that differs from the API host).
 *
 * Development origins are rejected outright so a QR generated during local
 * development can never be mistaken for a production one.
 */
const BLOCKED_ORIGIN_PATTERNS = [
  /^localhost$/i,
  /^127\.0\.0\.1$/i,
  /^\[?::1\]?$/i,
  /^(0\.0\.0\.0)$/,
  /\.replit\.dev$/i,
  /\.repl\.co$/i,
  /\.localhost$/i,
  /\.local$/i,
];

function isBlockedOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return true;
  }
  return BLOCKED_ORIGIN_PATTERNS.some((pattern) => pattern.test(host));
}

/** Normalise an origin or absolute URL to a canonical absolute base URL. */
function normalizeBaseUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (isBlockedOrigin(url.origin)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function getPublicBaseUrl(): string {
  const configured = normalizeBaseUrl(import.meta.env.VITE_PUBLIC_URL ?? '');
  if (configured) return configured;

  if (typeof window !== 'undefined') {
    const current = normalizeBaseUrl(window.location.origin);
    if (current) return current;
  }

  // Nothing usable: fall back to a relative URL so the QR payload is still a
  // valid, resolvable path rather than an invalid absolute address.
  return '';
}

/**
 * The URL encoded into the product's QR code. Always absolute when a public
 * origin is known.
 */
export function getVerificationUrl(productId: string): string {
  const base = getPublicBaseUrl();
  const path = `/verify/${encodeURIComponent(productId)}`;
  return base ? `${base}${path}` : path;
}
