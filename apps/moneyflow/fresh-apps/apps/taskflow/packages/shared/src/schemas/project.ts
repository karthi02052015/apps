import { z } from 'zod';
import { LIMITS, PROJECT_COLORS } from '../constants';
import { hexColorSchema, tagNameSchema } from './common';

const projectNameSchema = z.string().trim().min(1, 'Name is required').max(LIMITS.nameMax);
const iconSchema = z.string().trim().max(32);

export const createProjectSchema = z.object({
  name: projectNameSchema,
  color: hexColorSchema.default(PROJECT_COLORS[0]),
  icon: iconSchema.nullish(),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: projectNameSchema.optional(),
    color: hexColorSchema.optional(),
    icon: iconSchema.nullish(),
    position: z.number().finite().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

export interface ProjectDTO {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  position: number;
  archivedAt: string | null;
  openTaskCount: number;
  createdAt: string;
  updatedAt: string;
}


export const createTagSchema = z.object({ name: tagNameSchema, color: hexColorSchema.optional() });
export const updateTagSchema = z
  .object({ name: tagNameSchema.optional(), color: hexColorSchema.optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export interface TagDTO {
  id: string;
  name: string;
  color: string;
  taskCount: number;
}
