import { parseEnv } from './env.ts';
import { createLogger } from './logger.ts';
import { startServer } from './server.ts';

const env = parseEnv();
const log = createLogger(env.logLevel);

log.info('server.starting', { port: env.port, allowedOrigins: env.allowedOrigins.length });

const server = startServer({ env, log });

process.on('SIGINT', () => {
  void server.stop().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void server.stop().then(() => process.exit(0));
});
