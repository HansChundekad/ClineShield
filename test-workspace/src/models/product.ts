/**
 * product.ts — Product model
 *
 * CLINESHIELD DEMO: Class-based file, neutral path.
 * PreToolUse regex won't count method deletions (class methods aren't detected).
 * PostToolUse WILL catch type errors — try asking Cline to change a method's
 * return type incorrectly, or remove an interface property, to trigger tsc failure.
 */

export interface ProductData {
  id: string;
  name: string;
  price: number;
  stock: number;
  tags: string[];
}

export class Product {
  readonly id: string;
  name: string;
  private price: number;
  private stock: number;
  readonly tags: string[];

  constructor(data: ProductData) {
    this.id = data.id;
    this.name = data.name;
    this.price = data.price;
    this.stock = data.stock;
    this.tags = data.tags;
  }

  getPrice(): number {
    return this.price;
  }

  setPrice(price: number): void {
    if (price < 0) {
      throw new Error('Price cannot be negative');
    }
    this.price = price;
  }

  isInStock(): boolean {
    return this.stock > 0;
  }

  purchase(quantity: number): boolean {
    if (quantity > this.stock) {
      return false;
    }
    this.stock -= quantity;
    return true;
  }

  restock(quantity: number): void {
    if (quantity <= 0) {
      throw new Error('Restock quantity must be positive');
    }
    this.stock += quantity;
  }

  toJSON(): ProductData {
    return {
      id: this.id,
      name: this.name,
      price: this.price,
      stock: this.stock,
      tags: [...this.tags],
    };
  }
}
