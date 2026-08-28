export function isRenderableProductImageUrl(value: string) {
  if (value.startsWith("/api/assets/product-images/")) return true;
  try {
    const url = new URL(value);
    return !url.username
      && !url.password
      && (url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:"));
  } catch {
    return false;
  }
}

export function normalizeProductImageUrl(
  value: string,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
) {
  if (value.startsWith("/api/assets/product-images/")) return value;
  try {
    const url = new URL(value);
    if (url.pathname.startsWith("/api/assets/product-images/")) {
      return `${url.pathname}${url.search}`;
    }
    if (supabaseUrl) {
      const storageUrl = new URL(supabaseUrl);
      const publicPrefix = "/storage/v1/object/public/product-images/";
      if (url.origin === storageUrl.origin && url.pathname.startsWith(publicPrefix)) {
        return `/api/assets/product-images/${url.pathname.slice(publicPrefix.length)}`;
      }
    }
    return value;
  } catch {
    return value;
  }
}

export function isOptimizableProductImageUrl(value: string) {
  if (value.startsWith("/api/assets/product-images/")) return true;
  return false;
}
