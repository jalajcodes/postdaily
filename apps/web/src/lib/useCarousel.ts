import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBlob, type CarouselBrand, type CarouselDesign, type CarouselSlide } from "@postdaily/shared";
import { api, tokenStore } from "./api";
import { ensureFonts, loadImage, type SlideAssets } from "./carousel";

/** Your LinkedIn photo as a same-origin image (so slides can be exported), or null. */
function useAvatar(enabled: boolean) {
  return useQuery({
    queryKey: ["avatar-image"],
    enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const blob = await fetchBlob(api.auth.avatarUrl(), tokenStore.get());
      return blob ? loadImage(URL.createObjectURL(blob)).catch(() => null) : null;
    },
  });
}

/**
 * Everything the slide renderer needs, once it's loaded: fonts for the design, your photo,
 * your logo and the slides' images. Returns null until ready.
 */
export function useCarouselAssets(design: CarouselDesign, brand: CarouselBrand, name: string, slides: CarouselSlide[]) {
  const avatar = useAvatar(brand.showAvatar);
  const [fontsFor, setFontsFor] = useState<string | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    let live = true;
    ensureFonts(design).then(() => live && setFontsFor(design.font));
    return () => {
      live = false;
    };
  }, [design.font]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!brand.logo) return setLogo(null);
    loadImage(brand.logo).then(setLogo, () => setLogo(null));
  }, [brand.logo]);

  const srcs = slides.map((s) => s.image).filter((x): x is string => !!x);
  const key = srcs.map((s) => s.length + s.slice(-24)).join("|");
  useEffect(() => {
    let live = true;
    Promise.all(srcs.map(async (src) => [src, await loadImage(src)] as const)).then(
      (pairs) => live && setImages(new Map(pairs)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = fontsFor === design.font && (!brand.showAvatar || !avatar.isLoading) && srcs.every((s) => images.has(s));
  if (!ready) return null;
  const assets: SlideAssets = {
    name,
    handle: brand.handle,
    showAvatar: brand.showAvatar,
    avatar: avatar.data ?? null,
    logo,
    images,
  };
  return assets;
}
