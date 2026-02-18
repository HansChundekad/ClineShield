// Simple TypeScript file for testing basic edits
// Phase 1-2: Test low structural change % scenarios

export function greet(name: string): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const unused = 42;
  console.log(`Greeting user: ${name}`);
  return `Hi, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

function _privateHelper(): void {
  console.log('This is a private function');
}
void _privateHelper;

// Multi-line function for testing deletion detection
export function processUser(user: { name: string; email: string }): string {
  const normalizedName = user.name.trim().toLowerCase();
  const domain = user.email.split('@')[1];
  const result = `${normalizedName} @ ${domain}`;
  return result;
}

export const VERSION = '1.0.0';
