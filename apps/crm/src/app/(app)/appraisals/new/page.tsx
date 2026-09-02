import Link from 'next/link';
import { Card } from '@/components/ui';
import { NewAppraisalForm } from './new-form';

export const metadata = { title: 'New appraisal' };

export default function NewAppraisal() {
  return (
    <Card title="Appraise a car">
      <p className="mb-4 text-ink-muted">
        Capture the plate and mileage now. Confirm the derivative before you take it into stock —
        we will not guess a trim.
      </p>
      <NewAppraisalForm />
      <p className="mt-4">
        <Link href="/appraisals" className="text-link hover:underline">Back to part-exchange</Link>
      </p>
    </Card>
  );
}
