import Image from "next/image";
import { isOptimizableProductImageUrl, isRenderableProductImageUrl } from "@/lib/product-image-url";

type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  className?: string;
};

export function ProductImage({ src, alt, width, height, sizes, className = "" }: Props) {
  if (!isRenderableProductImageUrl(src)) return null;
  if (isOptimizableProductImageUrl(src)) {
    return (
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        quality={72}
        loading="lazy"
        className={className}
      />
    );
  }

  // Merchant-hosted images stay outside the server-side image proxy allowlist.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={className} />;
}
