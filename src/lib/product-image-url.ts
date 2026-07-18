export function isOptimizableProductImageUrl(
  value: string,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
) {
  if (!supabaseUrl) return false;
  try {
    const imageUrl = new URL(value);
    const storageUrl = new URL(supabaseUrl);
    return imageUrl.origin === storageUrl.origin
      && imageUrl.pathname.startsWith("/storage/v1/object/public/product-images/");
  } catch {
    return false;
  }
}
