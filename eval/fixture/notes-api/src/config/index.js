// Central config, read once from the environment.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'sqlite:./data/dev.db',
  sessionSecret: process.env.SESSION_SECRET ?? '',
  adminToken: process.env.ADMIN_TOKEN ?? '',
  stagingApiUrl: process.env.STAGING_API_URL ?? 'https://staging.notes.internal',
};
