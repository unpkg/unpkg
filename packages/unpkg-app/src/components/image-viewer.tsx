import { type VNode } from "preact";

export interface ImageViewerProps {
  alt?: string;
  src: string;
}

export function ImageViewer({ alt, src }: ImageViewerProps): VNode {
  return (
    <div class="py-8 border-b border-x border-slate-300 bg-white">
      <img alt={alt} src={src} class="w-3/4 block mx-auto" />
    </div>
  );
}
