export interface GuestTokenResponse {
  token: string;
}

export interface ProductSearchResponse {
  productIds: string[];
  numberOfProducts: number;
  categories: unknown[];
}

export interface NutrientHeader {
  label: string;
  unit: string;
}

export interface NutrientRow {
  label: string;
  values: string[];
}

export interface NutrientsTable {
  headers: NutrientHeader[];
  rows: NutrientRow[];
}

export interface NutrientsInformation {
  nutrientsTable?: NutrientsTable;
}

export interface ProductDetails {
  uid: string;
  miglesId?: string;
  name?: string;
  title?: string;
  description?: string;
  brand?: string;
  brandLine?: string;
  origin?: string;
  ingredients?: string;
  allergenText?: string;
  price?: {
    value?: number;
    unitPrice?: string;
    promotionalPrice?: number;
  };
  nutrientsInformation?: NutrientsInformation;
  ratings?: {
    average?: number;
    count?: number;
  };
  categories?: Array<{
    code?: string;
    name?: string;
  }>;
  images?: Array<{
    url?: string;
  }>;
  gtins?: string[];
  regulatedDescription?: string;
  productAvailability?: {
    isAvailable?: boolean;
  };
}

export interface CategoryItem {
  id?: string;
  name?: string;
  slug?: string;
  children?: CategoryItem[];
}

export interface CategoryListResponse {
  categories: CategoryItem[];
}

export interface StoreResult {
  id?: string;
  name?: string;
  address?: {
    street?: string;
    zip?: string;
    city?: string;
  };
  location?: {
    lat?: number;
    lng?: number;
  };
  openingHours?: Array<{
    day?: string;
    open?: string;
    close?: string;
  }>;
  type?: string;
}

export interface PromotionItem {
  id?: string;
  name?: string;
  description?: string;
  price?: {
    value?: number;
    promotionalPrice?: number;
  };
  validFrom?: string;
  validTo?: string;
}

export interface PromotionSearchResponse {
  items: PromotionItem[];
}
