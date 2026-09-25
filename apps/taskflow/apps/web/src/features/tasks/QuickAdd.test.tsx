import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectDTO } from '@taskflow/shared';
import { QuickAdd } from './QuickAdd';
import { positionBetween } from './TaskList';

const project: ProjectDTO = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Side Project',
  color: '#6366f1',
  icon: null,
  position: 1,
  archivedAt: null,
  openTaskCount: 0,
  createdAt: '',
  updatedAt: '',
};

describe('QuickAdd', () => {
  it('shows parsed tokens live and submits structured input', async () => {
    const onCreate = vi.fn();
    render(<QuickAdd projects={[project]} defaults={{}} onCreate={onCreate} />);
    const input = screen.getByTestId('quick-add');
    await userEvent.type(input, 'Ship v2 tomorrow #launch !urgent @side-project');
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.getByText('launch')).toBeInTheDocument();
    expect(screen.getByText('Side Project')).toBeInTheDocument();

    await userEvent.keyboard('{Enter}');
    expect(onCreate).toHaveBeenCalledTimes(1);
    const arg = onCreate.mock.calls[0]![0];
    expect(arg).toMatchObject({ title: 'Ship v2', priority: 'urgent', tags: ['launch'], projectId: project.id, allDay: true });
    expect(arg.dueAt).toBeTypeOf('string');
    expect(input).toHaveValue('');
  });

  it('warns about unknown projects and applies view defaults', async () => {
    const onCreate = vi.fn();
    render(<QuickAdd projects={[]} defaults={{ projectId: project.id }} onCreate={onCreate} />);
    await userEvent.type(screen.getByTestId('quick-add'), 'Plain task @nowhere{Enter}');
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ title: 'Plain task', projectId: project.id });
  });

  it('ignores empty submissions', async () => {
    const onCreate = vi.fn();
    render(<QuickAdd projects={[]} defaults={{}} onCreate={onCreate} />);
    await userEvent.type(screen.getByTestId('quick-add'), '   {Enter}');
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('positionBetween', () => {
  it('computes midpoints and ends', () => {
    expect(positionBetween(10, 20)).toBe(15);
    expect(positionBetween(undefined, 2048)).toBe(1024);
    expect(positionBetween(1024, undefined)).toBe(2048);
  });
});
