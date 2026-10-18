import type { Metadata } from 'next';
import { TripWizard } from '@/components/trip-wizard';

export const metadata: Metadata = { title: 'New trip' };

export default function NewTripPage() {
  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-2xl"><h1 className="text-2xl font-semibold tracking-tight">Plan a new trip</h1><p className="mt-1 text-muted">Five quick steps. You can change everything later.</p></div>
      <TripWizard defaultCurrency="USD" />
    </div>
  );
}
