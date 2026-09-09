/**
 * The Swagger UI HTML template (@nestjs/swagger) requests these static files
 * from the /docs prefix. express.static serves them from
 * `swagger-ui-dist/` on a normal filesystem, but a serverless bundle never
 * sees them — nothing in the import graph references files that are only
 * resolved through express.static.
 *
 * When a request for one of these names falls through express.static, the
 * bootstrap middleware redirects it to a pinned-major CDN copy instead of
 * letting it 404. The generated `/docs` HTML and `/docs/swagger-ui-init.js`
 * are NOT static files — they are rendered by the API itself and must never
 * be redirected.
 */
export const SWAGGER_UI_STATIC_ASSETS = new Set([
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'oauth2-redirect.html',
]);

/** @nestjs/swagger 12 ships swagger-ui-dist 5.x — keep the major in sync. */
export const SWAGGER_UI_CDN_BASE = 'https://unpkg.com/swagger-ui-dist@5';

/**
 * CDN URL for a fallen-through Swagger UI asset, or null when the request is
 * not a redirectable static asset (generated routes and everything else).
 */
export function swaggerUiCdnRedirect(assetName: string): string | null {
  const name = assetName.replace(/^\//, '');
  if (!SWAGGER_UI_STATIC_ASSETS.has(name)) return null;
  return `${SWAGGER_UI_CDN_BASE}/${name}`;
}
