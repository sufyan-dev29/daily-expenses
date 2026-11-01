import { EntryScreen } from '@/components/entry/EntryScreen';

export const metadata = { title: 'Add income' };

export default function Page() {
  return <EntryScreen kind="income" />;
}
