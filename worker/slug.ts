/**
 * URL-safe slug from a display name. Arabic and accented Latin both appear in
 * souk and shop names, so strip diacritics before dropping non-ASCII rather
 * than mangling "Marché" into "march".
 *
 * Shared by store and market creation — both write a NOT NULL UNIQUE slug.
 */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
