// Test: Multiple deleted functions
// functionA deleted
// functionB deleted

export function functionC() {
  return 'C';
}

export class Calculator {
  add(a: number, b: number) {
    return a + b;
  }
  // subtract deleted
  // multiply deleted
}

// arrowFunc deleted
