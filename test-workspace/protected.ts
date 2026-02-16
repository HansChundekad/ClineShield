// PROTECTED FILE - DO NOT MODIFY
// Phase 1-2: Test protected files feature (hooks should block edits)

export const CRITICAL_CONFIG = {
  apiKey: 'sk-test-key-12345',
  databaseUrl: 'postgres://localhost:5432/prod',
  encryptionKey: 'super-secret-key'
};

export function initializeApp(): void {
  console.log('Initializing critical application components...');
}
