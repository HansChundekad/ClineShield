/**
 * appConfig.ts — Application configuration
 *
 * CLINESHIELD DEMO: Protected path (src/config/) → +30 risk score.
 * Ask Cline to edit this file to see the risk badge change in the sidebar.
 */

export interface AppConfig {
  env: 'development' | 'staging' | 'production';
  apiBaseUrl: string;
  requestTimeoutMs: number;
  maxRetries: number;
  featureFlags: {
    darkMode: boolean;
    betaEditor: boolean;
  };
}

const config: AppConfig = {
  env: 'development',
  apiBaseUrl: 'http://localhost:3000',
  requestTimeoutMs: 5000,
  maxRetries: 3,
  featureFlags: {
    darkMode: true,
    betaEditor: false,
  },
};

export function getConfig(): AppConfig {
  return { ...config };
}

export function isDevelopment(): boolean {
  return config.env === 'development';
}

export function isFeatureEnabled(
  flag: keyof AppConfig['featureFlags']
): boolean {
  return config.featureFlags[flag];
}

export function setRequestTimeout(ms: number): void {
  if (ms < 0) {
    throw new Error('Timeout must be non-negative');
  }
  config.requestTimeoutMs = ms;
}
