import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

  // The Express API and the BullMQ worker live in the same package but are not
  // part of the web build. Keep their server-only dependencies out of the
  // client bundle.
  serverExternalPackages: ['@prisma/client', 'bullmq', 'ioredis', 'pino'],

  // Linting runs as its own CI step over the whole repo, not just the app, so
  // the Next build does not repeat it.
  typedRoutes: true,
};

export default config;
