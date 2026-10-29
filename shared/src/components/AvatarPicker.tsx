import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Avatar } from "./Avatar";
import { Spinner } from "./ui";

/** Avatar with a camera overlay that lets the user pick a new image. */
export function AvatarPicker({
  mxc,
  previewFile,
  name,
  id,
  size = 96,
  busy,
  editable = true,
  onPick,
  onView,
}: {
  mxc?: string | null;
  previewFile?: File | null;
  name: string;
  id: string;
  size?: number;
  busy?: boolean;
  editable?: boolean;
  onPick: (file: File) => void;
  onView?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!previewFile) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(previewFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);

  return (
    <div className="avatar-picker" style={{ width: size, height: size }}>
      {preview ? (
        <div className="avatar" style={{ width: size, height: size }}>
          <img src={preview} alt="" />
        </div>
      ) : (
        <Avatar mxc={mxc} name={name} id={id} size={size} onClick={onView} />
      )}
      {editable && (
        <button
          type="button"
          className="avatar-picker__btn"
          onClick={() => inputRef.current?.click()}
          aria-label="Change picture"
          title="Change picture"
          disabled={busy}
        >
          {busy ? <Spinner size={16} /> : <Camera size={16} />}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
