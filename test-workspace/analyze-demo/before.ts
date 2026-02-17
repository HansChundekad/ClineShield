export class UserService {
  private users: Map<string, User> = new Map();

  addUser(user: User): void {
    this.users.set(user.id, user);
  }

  removeUser(id: string): void {
    this.users.delete(id);
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
}
