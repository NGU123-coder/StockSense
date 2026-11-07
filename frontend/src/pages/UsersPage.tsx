import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../api/client';
import type { Role } from '../api/types';
import { ErrorState, Field, Modal, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { date } from '../lib/format';
import { roleLabel } from '../lib/roles';

interface TeamMember { id: string; name: string; email: string; role: Role; isActive: boolean; createdAt: string }
const roles: Role[] = ['ADMIN', 'MANAGER', 'PURCHASER', 'VIEWER'];

const schema = z.object({
  name: z.string().trim().min(2, 'Enter a name'),
  email: z.email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
  role: z.enum(['ADMIN', 'MANAGER', 'PURCHASER', 'VIEWER']),
});
type V = z.infer<typeof schema>;

function Invite({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<V>({ resolver: zodResolver(schema), defaultValues: { name: '', email: '', password: '', role: 'VIEWER' } });
  const save = useMutation({
    mutationFn: (v: V) => api.post('/users', v),
    onSuccess: () => { toast.success('Team member added'); qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Modal open onClose={onClose} title="Add a team member" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" form="invite-form">Add member</button></>}>
      <form id="invite-form" className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Full name" error={errors.name?.message}><input className="input" {...register('name')} /></Field>
        <Field label="Work email" error={errors.email?.message}><input className="input" type="email" {...register('email')} /></Field>
        <Field label="Temporary password" error={errors.password?.message} hint="Share it securely; they can change it later."><input className="input" type="text" {...register('password')} /></Field>
        <Field label="Role">
          <select className="input" {...register('role')}>{roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</select>
        </Field>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const { allowed, user: me } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['users'], queryFn: () => api.get<TeamMember[]>('/users'), enabled: allowed('manageUsers') });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: Role; isActive?: boolean }) => api.patch(`/users/${id}`, body),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!allowed('manageUsers')) return <Navigate to="/" replace />;

  return (
    <>
      <PageHeader title="Team" subtitle="Roles decide what each person can do. Changes apply the next time they sign in." actions={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> Add member</button>} />
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[720px]">
            <thead><tr><th>Name</th><th>Role</th><th>Joined</th><th>Access</th></tr></thead>
            <tbody>
              {isLoading && Array.from({ length: 4 }, (_, i) => <tr key={i}><td colSpan={4}><Skeleton className="h-8" /></td></tr>)}
              {data?.map((u) => (
                <tr key={u.id} className={u.isActive ? '' : 'opacity-55'}>
                  <td><p className="font-semibold">{u.name}{u.id === me?.id && <span className="ml-2 text-[12px] font-normal text-muted">(you)</span>}</p><p className="text-[12px] text-muted">{u.email}</p></td>
                  <td>
                    <select className="input h-8 w-[190px]" value={u.role} disabled={u.id === me?.id} onChange={(e) => update.mutate({ id: u.id, role: e.target.value as Role })} aria-label={`Role for ${u.name}`}>
                      {roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                    </select>
                  </td>
                  <td className="text-muted">{date(u.createdAt)}</td>
                  <td>
                    {u.id !== me?.id && (
                      <button className={u.isActive ? 'btn-danger h-8' : 'btn-ghost h-8'} onClick={() => update.mutate({ id: u.id, isActive: !u.isActive })}>
                        {u.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <Invite onClose={() => setAdding(false)} />}
    </>
  );
}
