import { Check } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PROJECT_COLORS, createProjectSchema, type ProjectDTO } from '@taskflow/shared';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Dialog';
import { Field, Input } from '../../components/ui/Input';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useProjectMutations } from './hooks';

export function ProjectDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project?: ProjectDTO }) {
  const { create, update } = useProjectMutations();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(PROJECT_COLORS[0]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setColor(project?.color ?? PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]!);
    setError(undefined);
  }, [open, project]);

  const pending = create.isPending || update.isPending;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createProjectSchema.safeParse({ name, color });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    try {
      if (project) {
        await update.mutateAsync({ id: project.id, input: parsed.data });
      } else {
        const created = await create.mutateAsync(parsed.data);
        navigate(`/projects/${created.id}`);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the project.');
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={project ? 'Edit project' : 'New project'} description="Group related tasks together.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field label="Name" error={error}>
          {(p) => <Input {...p} autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Product launch" />}
        </Field>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Colour</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn('grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110', color === c && 'ring-2')}
                style={{ backgroundColor: c, ['--tw-ring-color' as string]: c }}
              >
                {color === c ? <Check className="size-4 text-white" /> : null}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            {project ? 'Save' : 'Create project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
