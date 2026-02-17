// ClineShield Demo - User Service
// 8 standalone functions to demonstrate No-Nuke protection
// Phase 1: Uses simple named functions (no classes) for regex detection

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

const users: Map<string, User> = new Map();

// Auth & Security Functions (8 total for deletion testing)

export function authenticateUser(email: string, password: string): boolean {
  const user = findUserByEmail(email);
  if (!user) return false;
  // TODO: Add password verification
  return true;
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function generateToken(userId: string): string {
  return `token_${userId}_${Date.now()}`;
}

export function validatePassword(password: string): boolean {
  return password.length >= 8;
}

export function createUser(user: User): void {
  if (!validateEmail(user.email)) {
    throw new Error('Invalid email');
  }
  users.set(user.id, user);
}

export function getUser(id: string): User | undefined {
  return users.get(id);
}

export function updateUser(id: string, updates: Partial<User>): boolean {
  const user = users.get(id);
  if (!user) return false;
  Object.assign(user, updates);
  return true;
}

export function deleteUser(id: string): boolean {
  return users.delete(id);
}

function findUserByEmail(email: string): User | undefined {
  return Array.from(users.values()).find(u => u.email === email);
}
