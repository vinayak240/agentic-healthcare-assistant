import { describe, expect, it } from 'bun:test';
import type { FilterQuery, Model, ProjectionType, QueryOptions, UpdateQuery } from 'mongoose';
import { BaseRepository } from '../src/dal/repositories/base.repository';

interface TestEntity {
  name: string;
  cudFoil: {
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    deleted: boolean;
  };
}

class TestRepository extends BaseRepository<TestEntity> {
  constructor(model: Model<TestEntity>) {
    super(model);
  }

  exposeFindOne(
    filter: FilterQuery<TestEntity>,
    projection?: ProjectionType<TestEntity>,
    options?: QueryOptions<TestEntity>,
  ) {
    return this.findOne(filter, projection, options);
  }
}

describe('BaseRepository', () => {
  it('adds default soft-delete fields on create', async () => {
    let capturedInput: Record<string, unknown> | null = null;
    const model = {
      async create(input: Record<string, unknown>) {
        capturedInput = input;
        return input;
      },
      findOne() {
        throw new Error('not used');
      },
      find() {
        throw new Error('not used');
      },
      findOneAndUpdate() {
        throw new Error('not used');
      },
    } as unknown as Model<TestEntity>;

    const repository = new TestRepository(model);

    await repository.create({
      name: 'Jane Doe',
    } as Omit<TestEntity, 'cudFoil'>);

    expect(capturedInput).toEqual({
      name: 'Jane Doe',
      cudFoil: {
        deleted: false,
        deletedAt: null,
      },
    });
  });

  it('preserves explicit cudFoil values while still defaulting missing ones', async () => {
    let capturedInput: Record<string, unknown> | null = null;
    const model = {
      async create(input: Record<string, unknown>) {
        capturedInput = input;
        return input;
      },
      findOne() {
        throw new Error('not used');
      },
      find() {
        throw new Error('not used');
      },
      findOneAndUpdate() {
        throw new Error('not used');
      },
    } as unknown as Model<TestEntity>;

    const repository = new TestRepository(model);
    const deletedAt = new Date('2026-04-23T00:00:00.000Z');

    await repository.create({
      name: 'Jane Doe',
      cudFoil: {
        deleted: true,
        deletedAt,
      },
    } as TestEntity);

    expect(capturedInput).toEqual({
      name: 'Jane Doe',
      cudFoil: {
        deleted: true,
        deletedAt,
      },
    });
  });
});
