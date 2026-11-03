import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { useMediaUrl, downloadMedia } from "../matrix/media";
import { useMatrixClient } from "../matrix/MatrixContext";
import { IconButton, Spinner } from "./ui";
import type { EncryptedFile } from "../lib/attachments";

export interface LightboxImage {
  mxc: string;
  name: string;
  caption?: string;
  /** Low-resolution URL shown while the original loads. */
  placeholder?: string | null;
  file?: EncryptedFile;
  mimetype?: string;
}

export function Lightbox({ image, onClose }: { image: LightboxImage | null; onClose: () => void }) {
  const client = useMatrixClient();
  const url = useMediaUrl(image?.mxc, image?.file ? { file: image.file, mimetype: image.mimetype } : undefined);

  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [image, onClose]);

  if (!image) return null;
  const src = url ?? image.placeholder;
  return createPortal(
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox__title">{image.name}</span>
        <IconButton label="Download" onClick={() =>
            downloadMedia(client, image.mxc, image.name, image.file ? { file: image.file, mimetype: image.mimetype } : undefined)
          }>
          <Download size={20} />
        </IconButton>
        <IconButton label="Close" onClick={onClose}>
          <X size={22} />
        </IconButton>
      </div>
      <div className="lightbox__stage">
        {src ? <img src={src} alt={image.name} onClick={(e) => e.stopPropagation()} /> : <Spinner size={36} />}
      </div>
      {image.caption && <div className="lightbox__caption">{image.caption}</div>}
    </div>,
    document.body,
  );
}
