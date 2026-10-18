declare module 'tz-lookup' {
  /** Offline lookup of the IANA time zone at a coordinate. Throws for invalid coordinates. */
  export default function tzlookup(lat: number, lng: number): string;
}
