import { describe, expect, it } from 'vitest';
import { createTaskSchema, listTasksQuerySchema, registerSchema, updateTaskSchema } from '../src';

describe('schemas', () => {
  it('normalises email and enforces password policy', () => {
    expect(registerSchema.parse({ name: 'A', email: '  Me@Example.COM ', password: 'correcthorse1' }).email).toBe('me@example.com');
    expect(registerSchema.safeParse({ name: 'A', email: 'a@b.co', password: 'short1' }).success).toBe(false);
    expect(registerSchema.safeParse({ name: 'A', email: 'a@b.co', password: 'onlyletterslong' }).success).toBe(false);
  });

  it('dedupes and lowercases tags', () => {
    expect(createTaskSchema.parse({ title: 'x', tags: ['Work', 'work', 'HOME'] }).tags).toEqual(['work', 'home']);
  });

  it('rejects recurring tasks without a due date', () => {
    expect(createTaskSchema.safeParse({ title: 'x', recurrence: 'daily' }).success).toBe(false);
  });

  it('rejects empty updates', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 1 }).success).toBe(false);
  });

  it('coerces list query arrays and numbers', () => {
    const q = listTasksQuerySchema.parse({ status: 'todo,in_progress', priority: ['high'], limit: '10' });
    expect(q.status).toEqual(['todo', 'in_progress']);
    expect(q.priority).toEqual(['high']);
    expect(q.limit).toBe(10);
    expect(listTasksQuerySchema.safeParse({ status: 'bogus' }).success).toBe(false);
  });
});
