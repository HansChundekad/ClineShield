/**
 * userService.ts — Auth & user management
 *
 * CLINESHIELD DEMO: Protected path (src/auth/) → +30 risk score.
 * 8 exported functions — ask Cline to delete 5 to trigger PreToolUse block.
 */

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
}

const users: Map<string, User> = new Map();

export function createUser(user: User): void {
  if (!validateEmail(user.email)) {
    throw new Error(`Invalid email: ${user.email}`);
  }
  users.set(user.id, user);
}

export function getUser(id: string): User | undefined {
  return users.get(id);
}

export function updateUser(id: string, updates: Partial<User>): boolean {
  const user = users.get(id);
  if (!user) {
    return false;
  }
  Object.assign(user, updates);
  return true;
}

export function authenticateUser(email: string, password: string): boolean {
  const user = findByEmail(email);
  if (!user) {
    return false;
  }
  // Demo: replace with real password check
  return password.length >= 8;
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function generateToken(userId: string): string {
  return `tok_${userId}_${Date.now()}`;
}

function findByEmail(email: string): User | undefined {
  return Array.from(users.values()).find(u => u.email === email);
}
