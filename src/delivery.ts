import { shoppingUrl } from './shopping.js';

export type DeliveryInput = { url: string; pincode: string; variant?: string };
export type DeliveryObservation = {
  observed_pin?: string;
  observed_variant?: string;
  delivery: 'confirmed' | 'rejected' | 'unclear';
  excerpt?: string;
  listing_in_stock?: boolean;
  reason_code?: 'access_blocked' | 'pin_unconfirmed' | 'variant_unconfirmed' | 'delivery_unclear';
};

export function deliveryInput(value: unknown): DeliveryInput {
  if (!value || typeof value !== 'object') throw new Error('Provide a product URL and PIN.');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !['url', 'pincode', 'variant'].includes(key)))
    throw new Error('Unknown delivery input.');
  if (typeof data.url !== 'string' || data.url.length > 2048)
    throw new Error('Provide a public product URL.');
  if (typeof data.pincode !== 'string' || !/^[1-9]\d{5}$/.test(data.pincode))
    throw new Error('Provide a six-digit Indian PIN code.');
  if (
    data.variant !== undefined &&
    (typeof data.variant !== 'string' || !data.variant.trim() || data.variant.length > 200)
  )
    throw new Error('Variant must contain 1–200 characters.');
  return {
    url: shoppingUrl(data.url),
    pincode: data.pincode,
    ...(typeof data.variant === 'string' ? { variant: data.variant.trim() } : {}),
  };
}

// This validates agent-reported observations; it does not independently prove page content.
export function deliveryVerdict(input: DeliveryInput, observation: DeliveryObservation) {
  const supported =
    !observation.reason_code &&
    observation.observed_pin === input.pincode &&
    !!observation.observed_variant?.trim() &&
    !/^(current default|default|unknown|unspecified)$/i.test(observation.observed_variant.trim()) &&
    (!input.variant ||
      observation.observed_variant.trim().toLowerCase() === input.variant.toLowerCase()) &&
    !!observation.excerpt?.trim();
  const verdict =
    supported && observation.delivery === 'confirmed'
      ? 'DELIVERABLE'
      : supported && observation.delivery === 'rejected'
        ? 'NOT_DELIVERABLE'
        : 'UNKNOWN';
  return {
    verdict,
    contradiction:
      verdict === 'NOT_DELIVERABLE' && observation.listing_in_stock === true
        ? true
        : verdict === 'UNKNOWN'
          ? null
          : false,
  };
}
