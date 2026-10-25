import { createServer } from './app.mjs';

// Vercel imports this file, so startup must also run on import.
if (!process.env.VERCEL) {
  try { process.loadEnvFile(new URL('.env', import.meta.url)); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const port = Number(process.env.PORT || 3000);
const server = createServer();
server.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Website running at http://localhost:${server.address().port}`);
});
export default server;
