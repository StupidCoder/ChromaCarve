/**
 * Example models shipped with the app (served from `public/models`). They load
 * on demand via `ensureBundledModel` and are cached in the asset store, keyed by
 * their `source` id (which is also a `ModelSettings.source` value).
 */
export interface BundledModel {
  /** Also the `ModelSettings.source` value. */
  source: string;
  label: string;
  url: string;
}

export const BUNDLED_MODELS: BundledModel[] = [
  { source: 'horse', label: 'Horse', url: `${import.meta.env.BASE_URL}models/horse.msh` },
];

export const BUNDLED_BY_SOURCE = new Map(BUNDLED_MODELS.map((m) => [m.source, m]));
