// Simple TypeScript file for testing basic edits
// Phase 1-2: Test low structural change % scenarios

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

function privateHelper(): void {
  console.log('This is a private function');
}

export const VERSION = '1.0.0';
