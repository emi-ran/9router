import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
it('installs ffmpeg in the final runtime stage, not just the builder', () => {
 const dockerfile = readFileSync(fileURLToPath(new URL('../../Dockerfile', import.meta.url)), 'utf8');
 const runtime = dockerfile.split(/FROM .* AS runner/)[1];
 expect(runtime).toBeTruthy();
 expect(runtime).toMatch(/RUN apk add --no-cache[^\n]*\bffmpeg\b/);
});
