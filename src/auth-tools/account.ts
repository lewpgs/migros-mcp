import { api } from "../auth/api.js";
import { credsFromEnv } from "./_shared.js";

interface AddressEntry {
  uid: string;
  identity?: { firstName?: string; lastName?: string; title?: string };
  postalAddress?: {
    street?: string;
    streetNumber?: string;
    zipCode?: string;
    city?: string;
    country?: string;
  };
  isDelivery?: boolean;
  isBilling?: boolean;
  isContact?: boolean;
  default?: boolean;
}

/**
 * Fetch the logged-in customer's profile. Returns formatted JSON for the LLM.
 */
export async function getProfile(): Promise<string> {
  const profile = (await api(
    "GET",
    "/retentionapi/public/web/v1/customers/profile",
    undefined,
    { creds: credsFromEnv() }
  )) as Record<string, unknown>;

  return JSON.stringify(
    {
      userId: profile.userId,
      title: profile.title,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      languageCode: profile.languageCode,
      preferredCooperative: profile.preferredCooperative,
    },
    null,
    2
  );
}

/**
 * Fetch the user's saved addresses (delivery + billing). Filtered server-side
 * by the deliveryOnly/billingOnly flags; we ask for both by default.
 */
export async function getAddresses(): Promise<string> {
  const list = (await api(
    "GET",
    "/retentionapi/public/web/v1/customers/addresses?deliveryOnly=false&billingOnly=false",
    undefined,
    { creds: credsFromEnv() }
  )) as AddressEntry[];

  return JSON.stringify(
    list.map((a) => ({
      uid: a.uid,
      name: [a.identity?.firstName, a.identity?.lastName].filter(Boolean).join(" "),
      address: [a.postalAddress?.street, a.postalAddress?.streetNumber].filter(Boolean).join(" "),
      city: [a.postalAddress?.zipCode, a.postalAddress?.city].filter(Boolean).join(" "),
      country: a.postalAddress?.country,
      delivery: !!a.isDelivery,
      billing: !!a.isBilling,
      default: !!a.default,
    })),
    null,
    2
  );
}
