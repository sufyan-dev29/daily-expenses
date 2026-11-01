import { DEFAULT_SEED, themeCss } from '@/lib/theme';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss(DEFAULT_SEED) }} />
      <main className="flex min-h-dvh items-center justify-center bg-surface-container-low px-4 py-10">
        <div className="w-full max-w-[400px] rounded-m3-xl bg-surface p-6 medium:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-container text-on-primary-container t-label-lg">Rs</span>
            <span className="t-title-md">Expense tracker</span>
          </div>
          {children}
        </div>
      </main>
    </>
  );
}
