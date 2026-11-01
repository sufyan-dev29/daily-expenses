import { EntryScreen } from '@/components/entry/EntryScreen';

export const metadata = { title: 'Add expense' };

export default function Page() {
  return <EntryScreen kind="expense" />;
}
