import { Suspense } from 'react';
import { InsightsView } from '@/components/insights/InsightsView';

export const metadata = { title: 'Insights' };

export default function Page() {
  return (
    <Suspense>
      <InsightsView />
    </Suspense>
  );
}
