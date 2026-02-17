// Complex TypeScript file for testing large structural changes
// Phase 1-2: Test high structural change % scenarios and function deletions
// Uses standalone named functions (no classes) for regex pattern detection

export interface User {
  id: string;
  name: string;
  email: string;
}

const users: User[] = [];

// User Management Functions (7 total - deleting 4+ should trigger block)

export function addUser(user: User): void {
  users.push(user);
}

export function removeUser(id: string): void {
  const index = users.findIndex(u => u.id === id);
  if (index !== -1) users.splice(index, 1);
}

export function findUser(id: string): User | undefined {
  return users.find(u => u.id === id);
}

export function getAllUsers(): User[] {
  return [...users];
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function formatUserName(user: User): string {
  return `${user.name} <${user.email}>`;
}

function internalLogger(message: string): void {
  console.log(`[UserService] ${message}`);
}

export const DEFAULT_USER: User = {
  id: '000',
  name: 'Guest',
  email: 'guest@example.com'
};
