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

export function isOptimizableProductImageUrl(
  value: string,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
) {
  if (value.startsWith("/api/assets/product-images/")) return true;
  if (!supabaseUrl || !isRenderableProductImageUrl(value)) return false;
  try {
    const imageUrl = new URL(value);
    const storageUrl = new URL(supabaseUrl);
    return imageUrl.origin === storageUrl.origin
      && imageUrl.pathname.startsWith("/storage/v1/object/public/product-images/");
  } catch {
    return false;
  }
}
