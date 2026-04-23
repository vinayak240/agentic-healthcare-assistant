import type { SchemaDefinitionProperty } from 'mongoose';

import type { CudFoil } from '../interfaces/cud-foil.interface';

export const cudFoilProp: SchemaDefinitionProperty<CudFoil> = {
  type: {
    createdAt: { type: Date },
    updatedAt: { type: Date },
    deletedAt: { type: Date, default: null },
    deleted: { type: Boolean, default: false },
  },
  default: () => ({
    deletedAt: null,
    deleted: false,
  }),
  _id: false,
};

export const timestampOptions = {
  createdAt: 'cudFoil.createdAt',
  updatedAt: 'cudFoil.updatedAt',
} as const;

