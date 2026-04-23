import type {
  FilterQuery,
  HydratedDocument,
  Model,
  ProjectionType,
  QueryOptions,
  UpdateQuery,
} from 'mongoose';

import type { CudFoil } from '../interfaces/cud-foil.interface';

type SoftDeletable = {
  cudFoil: CudFoil;
};

type CreateInput<TEntity> = Omit<TEntity, 'cudFoil'> & {
  cudFoil?: Partial<CudFoil>;
};

export abstract class BaseRepository<TEntity extends SoftDeletable> {
  protected constructor(private readonly model: Model<TEntity>) {}

  async create(input: CreateInput<TEntity>): Promise<HydratedDocument<TEntity>> {
    return this.model.create(input);
  }

  async findById(id: string): Promise<HydratedDocument<TEntity> | null> {
    return this.model.findOne(this.withNotDeleted({ _id: id })).exec();
  }

  async findMany(filter: FilterQuery<TEntity> = {}): Promise<Array<HydratedDocument<TEntity>>> {
    return this.model.find(this.withNotDeleted(filter)).exec();
  }

  async updateById(
    id: string,
    update: UpdateQuery<TEntity>,
  ): Promise<HydratedDocument<TEntity> | null> {
    return this.model
      .findOneAndUpdate(this.withNotDeleted({ _id: id }), update, { new: true })
      .exec();
  }

  async softDeleteById(id: string): Promise<HydratedDocument<TEntity> | null> {
    return this.model
      .findOneAndUpdate(
        this.withNotDeleted({ _id: id }),
        {
          $set: {
            'cudFoil.deleted': true,
            'cudFoil.deletedAt': new Date(),
          },
        },
        { new: true },
      )
      .exec();
  }

  protected findOne(
    filter: FilterQuery<TEntity>,
    projection?: ProjectionType<TEntity>,
    options?: QueryOptions<TEntity>,
  ) {
    return this.model.findOne(this.withNotDeleted(filter), projection, options);
  }

  private withNotDeleted(filter: FilterQuery<TEntity>): FilterQuery<TEntity> {
    return {
      ...filter,
      'cudFoil.deleted': false,
    };
  }
}

