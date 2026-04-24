import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { HydratedDocument } from 'mongoose';
import { UsersRepository } from '../../dal/repositories/users.repository';
import type { User } from '../../dal/schemas/user.schema';

@Injectable()
export class UserService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async createUser(input: {
    name: string;
    email: string;
    allergies?: string[];
    medicalConditions?: string[];
    medicalHistory?: string[];
  }) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existingUser = await this.usersRepository.findByEmail(normalizedEmail);

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const user = await this.usersRepository.create({
      name: input.name.trim(),
      email: normalizedEmail,
      allergies: this.normalizeStringList(input.allergies),
      medicalConditions: this.normalizeStringList(input.medicalConditions),
      medicalHistory: this.normalizeStringList(input.medicalHistory),
    });

    return this.serializeUser(user);
  }

  async listUsers() {
    const users = await this.usersRepository.findMany();

    return {
      items: users.map((user) => this.serializeUser(user)),
    };
  }

  async getUser(id: string) {
    const user = await this.usersRepository.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.serializeUser(user);
  }

  async loginUser(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.usersRepository.findByEmail(normalizedEmail);

    if (!user) {
      throw new NotFoundException('No account found for this email');
    }

    return this.serializeUser(user);
  }

  async ensureUserExists(id: string): Promise<HydratedDocument<User>> {
    const user = await this.usersRepository.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private serializeUser(user: HydratedDocument<User>) {
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      allergies: this.normalizeStringList(user.allergies),
      medicalConditions: this.normalizeStringList(user.medicalConditions),
      medicalHistory: this.normalizeStringList(user.medicalHistory),
      createdAt: user.cudFoil.createdAt?.toISOString() ?? null,
      updatedAt: user.cudFoil.updatedAt?.toISOString() ?? null,
    };
  }

  private normalizeStringList(values: string[] | undefined): string[] {
    return Array.isArray(values)
      ? values.map((value) => value.trim()).filter((value) => value.length > 0)
      : [];
  }
}
