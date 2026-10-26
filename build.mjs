import { mkdir, copyFile } from 'node:fs/promises';

// Explicit allowlist: never publish server code or local secrets.
await mkdir(new URL('./public/', import.meta.url), { recursive: true });
for (const file of ['index.html', 'styles.css', 'script.js', 'favicon.png', 'apple-touch-icon.png']) {
  await copyFile(new URL(file, import.meta.url), new URL(`./public/${file}`, import.meta.url));
}
