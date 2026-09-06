import { describe, expect, it } from 'vitest';
import { SWAGGER_UI_CDN_BASE, SWAGGER_UI_STATIC_ASSETS, swaggerUiCdnRedirect } from './swagger-ui-assets.js';

describe('swaggerUiCdnRedirect', () => {
  it('redirects every static asset the Swagger UI template requests', () => {
    expect(SWAGGER_UI_STATIC_ASSETS).toEqual(
      new Set([
        'swagger-ui.css',
        'swagger-ui-bundle.js',
        'swagger-ui-standalone-preset.js',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'oauth2-redirect.html',
      ]),
    );
    for (const asset of SWAGGER_UI_STATIC_ASSETS) {
      expect(swaggerUiCdnRedirect(asset)).toBe(`${SWAGGER_UI_CDN_BASE}/${asset}`);
    }
  });

  it('tolerates mount-relative paths with a leading slash', () => {
    expect(swaggerUiCdnRedirect('/swagger-ui.css')).toBe(`${SWAGGER_UI_CDN_BASE}/swagger-ui.css`);
  });

  it('never redirects generated or unknown routes', () => {
    // Rendered by the API itself — redirecting it would break the docs page.
    expect(swaggerUiCdnRedirect('swagger-ui-init.js')).toBeNull();
    expect(swaggerUiCdnRedirect('/swagger-ui-init.js')).toBeNull();
    expect(swaggerUiCdnRedirect('')).toBeNull();
    expect(swaggerUiCdnRedirect('/')).toBeNull();
    expect(swaggerUiCdnRedirect('some-other-file.js')).toBeNull();
  });
});
