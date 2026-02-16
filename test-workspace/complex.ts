// Complex TypeScript file for testing large structural changes
// Phase 1-2: Test high structural change % scenarios and function deletions

export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private users: User[] = [];

  addUser(user: User): void {
    this.users.push(user);
  }

  removeUser(id: string): void {
    this.users = this.users.filter(u => u.id !== id);
  }

  findUser(id: string): User | undefined {
    return this.users.find(u => u.id === id);
  }

  getAllUsers(): User[] {
    return [...this.users];
  }
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
