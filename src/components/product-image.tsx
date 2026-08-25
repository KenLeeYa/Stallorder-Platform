import Image from "next/image";
import type { CSSProperties } from "react";
import { isOptimizableProductImageUrl, isRenderableProductImageUrl, normalizeProductImageUrl } from "@/lib/product-image-url";

type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  className?: string;
  style?: CSSProperties;
};

export function ProductImage({ src, alt, width, height, sizes, className = "", style }: Props) {
  const normalizedSrc = normalizeProductImageUrl(src);
  if (!isRenderableProductImageUrl(normalizedSrc)) return null;
  if (isOptimizableProductImageUrl(normalizedSrc)) {
    return (
      <Image
        src={normalizedSrc}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        quality={75}
        loading="lazy"
        className={className}
        style={style}
      />
    );
  }

  // Merchant-hosted images stay outside the server-side image proxy allowlist.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={normalizedSrc} alt={alt} width={width} height={height} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={className} style={style} />;
}
