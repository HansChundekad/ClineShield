// ClineShield Demo - User Service
// 8 functions to demonstrate No-Nuke protection

export class UserService {
  private users: Map<string, User> = new Map();

  // Auth & Security (HIGH RISK)
  authenticateUser(email: string, password: string): boolean {
    const user = this.findUserByEmail(email);
    if (!user) return false;
    // TODO: Add password verification
    return true;
  }

  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // CRUD Operations
  createUser(user: User): void {
    if (!this.validateEmail(user.email)) {
      throw new Error('Invalid email');
    }
    this.users.set(user.id, user);
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  updateUser(id: string, updates: Partial<User>): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    Object.assign(user, updates);
    return true;
  }

  deleteUser(id: string): boolean {
    return this.users.delete(id);
  }

  // Query Operations
  findUserByEmail(email: string): User | undefined {
    return Array.from(this.users.values()).find(u => u.email === email);
  }

  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}
