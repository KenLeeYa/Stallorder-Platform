import Image from "next/image";
import { isOptimizableProductImageUrl } from "@/lib/product-image-url";

type Props = {
  src: string;
  alt: string;
  className?: string;
};

export function ProductThumbnail({ src, alt, className = "" }: Props) {
  const classes = `h-20 w-20 shrink-0 rounded-md object-cover ${className}`;
  if (isOptimizableProductImageUrl(src)) {
    return (
      <Image
        src={src}
        alt={alt}
        width={80}
        height={80}
        sizes="80px"
        quality={72}
        loading="lazy"
        className={classes}
      />
    );
  }

  // External merchant URLs stay outside the server-side image proxy allowlist.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={80} height={80} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={classes} />;
}
