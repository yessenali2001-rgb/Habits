'use client';
import dynamic from 'next/dynamic';
import { Spinner } from './ui';

// Leaflet touches `window`, so the map is only ever rendered in the browser
export const TripMapLoader = dynamic(() => import('./trip-map').then((m) => m.TripMap), {
  ssr: false,
  loading: () => <div className="grid h-96 place-items-center rounded-2xl border border-line bg-surface"><Spinner /></div>,
});
