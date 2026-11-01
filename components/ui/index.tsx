'use client';
import { AnimatePresence, motion } from 'framer-motion';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ Icon */
export function Icon({ name, fill, className, size }: { name: string; fill?: boolean; className?: string; size?: number }) {
  return (
    <span aria-hidden className={cx('icon', fill && 'fill', className)} style={size ? { fontSize: size } : undefined}>
      {name}
    </span>
  );
}

/* ------------------------------------------------------------------ Buttons */
type BtnVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';
const BTN: Record<BtnVariant, string> = {
  filled: 'bg-primary text-on-primary',
  tonal: 'bg-secondary-container text-on-secondary-container',
  outlined: 'border border-outline-variant text-primary',
  text: 'text-primary',
  danger: 'bg-error text-on-error',
};

export function Button({
  variant = 'filled',
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; icon?: string }) {
  return (
    <button
      {...rest}
      className={cx(
        'state press t-label-lg inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-6',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
        BTN[variant],
        className,
      )}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  fill,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; fill?: boolean }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx(
        'state press inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant',
        'disabled:opacity-40',
        className,
      )}
    >
      <Icon name={icon} fill={fill} />
    </button>
  );
}

/* ------------------------------------------------------------------ Chip */
export function Chip({
  children,
  selected,
  icon,
  onClick,
  onRemove,
  className,
  ...rest
}: {
  children: ReactNode;
  selected?: boolean;
  icon?: string;
  onClick?: () => void;
  onRemove?: () => void;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <span
      className={cx(
        'state press t-label-lg inline-flex h-9 shrink-0 items-center gap-1 rounded-full',
        selected ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant',
        className,
      )}
    >
      <button
        {...rest}
        type="button"
        onClick={onClick}
        className="relative z-10 inline-flex h-9 items-center gap-1.5 rounded-full pl-3.5 pr-3.5"
        style={onRemove ? { paddingRight: 4 } : undefined}
      >
        {icon && <Icon name={icon} size={18} />}
        {children}
      </button>
      {onRemove && (
        <button type="button" aria-label="Remove filter" onClick={onRemove} className="relative z-10 mr-1.5 flex h-6 w-6 items-center justify-center rounded-full">
          <Icon name="close" size={16} />
        </button>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ Segmented (connected button group) */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  checkmark = false,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: string; tone?: 'need' | 'want' }[];
  /** show a check on the selected option (only when there is room) */
  checkmark?: boolean;
  label: string;
  className?: string;
}) {
  const last = options.length - 1;
  return (
    <div role="radiogroup" aria-label={label} className={cx('flex h-12 gap-0.5', className)}>
      {options.map((o, i) => {
        const on = value === o.value;
        const tone = o.tone === 'want' ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-secondary-container text-on-secondary-container';
        const shape = on ? 'rounded-full' : i === 0 ? 'rounded-l-full rounded-r-[10px]' : i === last ? 'rounded-r-full rounded-l-[10px]' : 'rounded-[10px]';
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'state press t-label-lg flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 transition-[border-radius,background-color,color] duration-300',
              shape,
              on ? tone : 'bg-surface-container-high text-on-surface-variant',
            )}
          >
            {on && checkmark ? <Icon name="check" size={18} className="tick" /> : o.icon ? <Icon name={o.icon} size={18} /> : null}
            <span className="whitespace-nowrap">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Switch */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full border-2 transition-colors duration-200',
        checked ? 'border-primary bg-primary' : 'border-outline bg-surface-container-highest',
      )}
    >
      <span
        className={cx(
          'block rounded-full transition-all duration-200 ease-emphasized',
          checked ? 'ml-[22px] h-6 w-6 bg-on-primary' : 'ml-1 h-4 w-4 bg-outline',
        )}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ Text field */
export function Field({
  label,
  hint,
  error,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="t-label-md mb-1.5 block px-1 text-on-surface-variant">
        {label}
      </label>
      <input
        id={id}
        {...rest}
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${id}-d` : undefined}
        className={cx(
          't-body-lg h-14 w-full rounded-2xl border-2 bg-surface-container-high px-4 text-on-surface transition-colors duration-200 placeholder:text-on-surface-variant/60',
          error ? 'border-error' : 'border-transparent focus:border-primary',
          'focus:outline-none',
        )}
      />
      {(hint || error) && (
        <p id={`${id}-d`} role={error ? 'alert' : undefined} className={cx('t-label-md mt-1 px-1', error ? 'text-error' : 'text-on-surface-variant')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Card / section */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-[28px] bg-surface-container-low p-5', className)}>{children}</section>;
}

export function Section({ title, description, icon, children }: { title: string; description?: string; icon?: string; children: ReactNode }) {
  return (
    <Card className="rise mb-4">
      <div className="flex items-center gap-3">
        {icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
            <Icon name={icon} size={22} fill />
          </span>
        )}
        <h2 className="t-title-lg">{title}</h2>
      </div>
      {description && <p className="t-body-md mb-3 mt-2 text-on-surface-variant">{description}</p>}
      <div className={description ? '' : 'mt-4'}>{children}</div>
    </Card>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-2xl', className)} />;
}

export function Spinner({ size = 22 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ Sheet (bottom sheet on phones, dialog on desktop) */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // callers pass a new onClose every render; keep the latest in a ref so typing in a field never re-runs the open effect
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const swipe = useSwipeDismiss(onClose);
  const bind = useCallback((el: HTMLDivElement | null) => { ref.current = el; swipe(el); }, [swipe]);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // opening a picker must never raise the on-screen keyboard: drop focus from any text field underneath
    if (prev && /^(input|textarea|select)$/i.test(prev.tagName)) prev.blur();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 50);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      clearTimeout(t);
      // give focus back to buttons only, never to a text field (that would pop the keyboard up again)
      if (prev && !/^(input|textarea|select)$/i.test(prev.tagName)) prev.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center expanded:items-center">
          <motion.div
            className="absolute inset-0 bg-scrim/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            ref={bind}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative flex max-h-[88dvh] w-full max-w-[560px] flex-col rounded-t-[32px] bg-surface-container-low expanded:rounded-[32px]"
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
          >
            <div className="mx-auto mt-3 h-1 w-8 rounded-full bg-outline-variant expanded:hidden" />
            <h2 className="t-title-lg px-6 pb-2 pt-4">{title}</h2>
            <div className="scroller min-h-0 flex-1 px-2 pb-2">{children}</div>
            {footer && <div className="px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ swipe down to dismiss
 * Touch-only. Dragging down on the top bar, or on content that is scrolled to its top, moves the panel with the
 * finger (CSS `translate`, so it composes with framer-motion's own transform) and closes it past a threshold.
 * Returns a callback ref; the listeners are attached when the element mounts and removed when it unmounts. */
export function useSwipeDismiss(onClose: () => void): (el: HTMLElement | null) => void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    let startY = 0, startX = 0, lastY = 0, lastT = 0, vel = 0, dy = 0;
    let mode: 'idle' | 'maybe' | 'drag' | 'ignore' = 'idle';
    const reset = (animate: boolean) => {
      el.style.transition = animate ? 'translate 220ms cubic-bezier(0.2,0,0,1)' : '';
      el.style.translate = '';
      if (animate) setTimeout(() => { el.style.transition = ''; }, 240);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { mode = 'ignore'; return; }
      const t = e.target as HTMLElement;
      // never hijack text selection, sliders or horizontally scrolling rows
      if (t.closest('input, textarea, select, [data-no-swipe]')) { mode = 'ignore'; return; }
      const sc = t.closest('.scroller') as HTMLElement | null;
      if (sc && el.contains(sc) && sc.scrollTop > 0) { mode = 'ignore'; return; }
      mode = 'maybe';
      startY = lastY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      lastT = e.timeStamp; vel = 0; dy = 0;
      el.style.transition = '';
    };
    const onMove = (e: TouchEvent) => {
      if (mode === 'idle' || mode === 'ignore') return;
      const y = e.touches[0].clientY;
      const x = e.touches[0].clientX;
      if (mode === 'maybe') {
        const ady = y - startY, adx = Math.abs(x - startX);
        if (Math.abs(ady) < 8 && adx < 8) return;
        if (ady > 0 && ady > adx) mode = 'drag';
        else { mode = 'ignore'; return; }
      }
      e.preventDefault();
      dy = Math.max(0, y - startY);
      const dt = e.timeStamp - lastT;
      if (dt > 0) vel = (y - lastY) / dt;
      lastY = y; lastT = e.timeStamp;
      // light resistance so it feels attached but not loose
      el.style.translate = `0 ${dy < 0 ? 0 : dy * 0.92}px`;
    };
    const onEnd = () => {
      if (mode !== 'drag') { mode = 'idle'; return; }
      mode = 'idle';
      if (dy > 110 || vel > 0.6) {
        el.style.transition = 'translate 200ms cubic-bezier(0.2,0,0,1)';
        el.style.translate = `0 ${el.getBoundingClientRect().height}px`;
        closeRef.current();
      } else reset(true);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    cleanup.current = () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);
}

/* ------------------------------------------------------------------ Snackbar */
interface SnackOpts { message: string; actionLabel?: string; onAction?: () => void; duration?: number }
const SnackCtx = createContext<(o: SnackOpts) => void>(() => {});
export const useSnackbar = () => useContext(SnackCtx);

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<(SnackOpts & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((o: SnackOpts) => {
    clearTimeout(timer.current);
    setSnack({ ...o, id: Date.now() });
    timer.current = setTimeout(() => setSnack(null), o.duration ?? 5000);
  }, []);
  return (
    <SnackCtx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-h)+16px+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 expanded:bottom-6" aria-live="polite">
        <AnimatePresence>
          {snack && (
            <motion.div
              key={snack.id}
              className="pointer-events-auto flex min-h-[52px] w-full max-w-[480px] items-center gap-2 rounded-2xl bg-inverse-surface py-1 pl-5 pr-2 text-inverse-on-surface shadow-lg"
              initial={{ y: 16, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            >
              <span className="t-body-md flex-1">{snack.message}</span>
              {snack.actionLabel && (
                <button
                  className="t-label-lg min-h-[48px] rounded-full px-4 text-inverse-primary"
                  onClick={() => { snack.onAction?.(); setSnack(null); }}
                >
                  {snack.actionLabel}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </SnackCtx.Provider>
  );
}

/* ------------------------------------------------------------------ hooks */
export function useMediaQuery(q: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setM(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}

export function useReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** True while <html> carries the "dark" class (follows the app theme, not just the OS). */
export function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const f = () => setDark(el.classList.contains('dark'));
    f();
    const mo = new MutationObserver(f);
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useStable<T extends object>(o: T): T {
  return useMemo(() => o, [o]);
}
