// Test: Multiple deleted functions
export function functionA() {
  return 'A';
}

export function functionB() {
  return 'B';
}

export function functionC() {
  return 'C';
}

export class Calculator {
  add(a: number, b: number) {
    return a + b;
  }

  subtract(a: number, b: number) {
    return a - b;
  }

  multiply(a: number, b: number) {
    return a * b;
  }
}

export const arrowFunc = () => {
  return 'arrow';
};
