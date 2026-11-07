import { zodResolver } from '@hookform/resolvers/zod';
import clsx from 'clsx';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { Runway } from '../components/Runway';
import { useAuth } from '../hooks/useAuth';
import { roleLabel } from '../lib/roles';
import type { Role } from '../api/types';

const schema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
type FormValues = z.infer<typeof schema>;

const DEMO: { role: Role; email: string; does: string }[] = [
  { role: 'MANAGER', email: 'manager@stocksense.in', does: 'Moves stock, approves orders, runs forecasts' },
  { role: 'PURCHASER', email: 'purchaser@stocksense.in', does: 'Raises and submits purchase orders' },
  { role: 'ADMIN', email: 'admin@stocksense.in', does: 'Everything, plus team management' },
  { role: 'VIEWER', email: 'viewer@stocksense.in', does: 'Read-only access' },
];

// A still life of the product's core idea for the brand panel.
const SHOWCASE = [
  { name: 'Whole Wheat Atta 10 kg', where: 'Kolkata Hub', q: 36, rop: 294, ss: 60, note: 'Runs out in 1 day' },
  { name: 'Aloo Bhujia 400 g', where: 'Mumbai DC', q: 410, rop: 520, ss: 110, note: 'Order 1,240 packs' },
  { name: 'Assam CTC Tea 500 g', where: 'Delhi NCR DC', q: 1180, rop: 410, ss: 90, note: '27 days of cover' },
  { name: 'Lemon Soda 750 ml', where: 'Bengaluru DC', q: 4300, rop: 380, ss: 70, note: '₹1.1 L tied up in overstock' },
];

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  if (user) return <Navigate to={(location.state as { from?: string })?.from ?? '/'} replace />;

  const onSubmit = async (v: FormValues) => {
    setServerError(null);
    try {
      await login(v.email, v.password);
      navigate((location.state as { from?: string })?.from ?? '/', { replace: true });
    } catch (e) {
      setServerError((e as Error).message);
    }
  };

  const fillDemo = (email: string) => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', 'Demo@1234', { shouldValidate: true });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#F3F5F4" />
            <rect x="7" y="18" width="5" height="7" rx="1" fill="#14213D" />
            <rect x="13.5" y="13" width="5" height="12" rx="1" fill="#14213D" />
            <rect x="20" y="8" width="5" height="17" rx="1" fill="#E8A317" />
          </svg>
          <span className="font-wide text-[19px] font-[800]">StockSense</span>
        </div>

        <div className="max-w-[560px]">
          <h1 className="font-wide text-[44px] leading-[1.05] font-[800] tracking-tight">
            Reorder before the shelf goes empty.
          </h1>
          <p className="mt-5 max-w-[46ch] text-[16px] leading-relaxed text-white/70">
            StockSense forecasts demand for every product in every warehouse, tells your team exactly how much to
            order, and shows the cash sitting idle in slow stock.
          </p>

          <ul className="mt-10 space-y-5 rounded-[var(--radius-lg)] bg-white/[.04] p-6 ring-1 ring-white/10">
            {SHOWCASE.map((s) => (
              <li key={s.name}>
                <div className="mb-2 flex items-baseline justify-between gap-4 text-[13px]">
                  <span className="font-semibold text-white">
                    {s.name} <span className="font-normal text-white/50">at {s.where}</span>
                  </span>
                  <span className="shrink-0 text-white/70">{s.note}</span>
                </div>
                <div className="[&_.bg-concrete]:bg-white/10 [&_.bg-ink]:bg-white">
                  <Runway quantity={s.q} reorderPoint={s.rop} safetyStock={s.ss} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[12px] text-white/45">Built with React, Node.js, FastAPI and PostgreSQL.</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px]">
          <h2 className="font-wide text-[26px] font-[750]">Sign in</h2>
          <p className="mt-1 text-[14px] text-muted">Use your work email, or pick a demo account below.</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
            <label className="block">
              <span className="label">Email</span>
              <input {...register('email')} type="email" autoComplete="username" className="input h-10" />
              {errors.email && <p className="field-error">{errors.email.message}</p>}
            </label>
            <label className="block">
              <span className="label">Password</span>
              <input {...register('password')} type="password" autoComplete="current-password" className="input h-10" />
              {errors.password && <p className="field-error">{errors.password.message}</p>}
            </label>
            {serverError && (
              <p role="alert" className="rounded-[var(--radius-md)] bg-out-soft px-3 py-2 text-[13px] text-out">
                {serverError}
              </p>
            )}
            <button type="submit" className="btn-primary h-10 w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-9">
            <p className="text-[13px] font-semibold">Demo accounts</p>
            <p className="text-[12px] text-muted">Each role sees different actions. Password is filled in for you.</p>
            <div className="mt-3 grid gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.role}
                  type="button"
                  onClick={() => fillDemo(d.email)}
                  className={clsx(
                    'group flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-ink',
                  )}
                >
                  <span>
                    <span className="block text-[13px] font-semibold">{roleLabel[d.role]}</span>
                    <span className="block text-[12px] text-muted">{d.does}</span>
                  </span>
                  <span className="text-[12px] font-semibold text-sky opacity-0 transition-opacity group-hover:opacity-100">
                    Use
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
