import { DEFAULT_SEED, themeCss } from '@/lib/theme';

export const metadata = { title: 'Setup' };

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss(DEFAULT_SEED) }} />
      {children}
    </>
  );
}
