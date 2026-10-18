'use client';
import { forwardRef, useMemo, type SelectHTMLAttributes } from 'react';
import { DateTime } from 'luxon';
import { allZones, offsetLabel } from '@/lib/time';
import { Select } from './ui';

/** Every IANA zone with its current UTC offset, so people can pick "Europe/Rome (UTC+2)". */
export const ZoneSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function ZoneSelect(props, ref) {
  const options = useMemo(() => {
    const now = DateTime.now();
    return allZones().map((z) => ({ z, label: `${z.replace(/_/g, ' ')} (${offsetLabel(z, now)})` }));
  }, []);
  return (
    <Select ref={ref} {...props}>
      {options.map((o) => <option key={o.z} value={o.z}>{o.label}</option>)}
    </Select>
  );
}, );

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'AED', 'SAR', 'INR', 'CNY', 'KRW', 'THB', 'VND', 'IDR', 'MYR', 'SGD', 'HKD', 'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'PEN', 'ZAR', 'EGP', 'MAD', 'KZT', 'UAH', 'GEL', 'RUB'];

export const CurrencySelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function CurrencySelect(props, ref) {
  return (
    <Select ref={ref} {...props}>
      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </Select>
  );
});
