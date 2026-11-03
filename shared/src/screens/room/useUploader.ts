import { useCallback, useState } from "react";
import { MsgType, type MatrixEvent, type Room } from "matrix-js-sdk";
import { useMatrixClient } from "../../matrix/MatrixContext";
import { readImageSize, uploadFile } from "../../matrix/media";
import { useToast } from "../../components/Toast";

export interface UploadItem {
  id: string;
  name: string;
  progress: number;
  previewUrl: string | null;
}

export function useUploader(room: Room | null) {
  const client = useMatrixClient();
  const toast = useToast();
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const sendFiles = useCallback(
    async (files: File[], replyTo?: MatrixEvent | null) => {
      if (!room) return;
      const encrypted = room.hasEncryptionStateEvent();
      for (const file of files) {
        const id = `${Date.now()}-${Math.random()}`;
        const isImage = file.type.startsWith("image/");
        const previewUrl = isImage ? URL.createObjectURL(file) : null;
        setUploads((u) => [...u, { id, name: file.name, progress: 0, previewUrl }]);
        try {
          const size = isImage ? await readImageSize(file) : null;
          const uploaded = await uploadFile(client, file, file.name, encrypted, (p) =>
            setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))),
          );
          const msgtype = isImage
            ? MsgType.Image
            : file.type.startsWith("video/")
              ? MsgType.Video
              : file.type.startsWith("audio/")
                ? MsgType.Audio
                : MsgType.File;
          const info: Record<string, unknown> = { mimetype: file.type || "application/octet-stream", size: file.size };
          if (size && size.w) {
            info.w = size.w;
            info.h = size.h;
          }
          const content: Record<string, unknown> = { msgtype, body: file.name, filename: file.name, info, ...uploaded };
          if (replyTo) content["m.relates_to"] = { "m.in_reply_to": { event_id: replyTo.getId() } };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await client.sendMessage(room.roomId, content as any);
        } catch (e) {
          toast.error(e, `Could not send ${file.name}`);
        } finally {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setUploads((u) => u.filter((x) => x.id !== id));
        }
      }
    },
    [client, room, toast],
  );

  return { uploads, sendFiles };
}
