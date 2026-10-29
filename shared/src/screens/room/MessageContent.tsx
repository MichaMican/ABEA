import { Fragment, useMemo, useState, type ReactNode } from "react";
import { EventType, MsgType, type MatrixEvent } from "matrix-js-sdk";
import * as linkify from "linkifyjs";
import { Ban, Download, FileText, Lock, MapPin, Music, Play } from "lucide-react";
import { useMatrixClient } from "../../matrix/MatrixContext";
import { downloadMedia, useMediaUrl } from "../../matrix/media";
import { isEmojiOnly, stripReplyFallback } from "../../matrix/events";
import { formatBytes } from "../../lib/format";
import { usePlatform } from "../../platform";
import type { EncryptedFile } from "../../lib/attachments";
import type { LightboxImage } from "../../components/Lightbox";
import { Spinner } from "../../components/ui";

interface MediaInfo {
  w?: number;
  h?: number;
  mimetype?: string;
  size?: number;
  thumbnail_url?: string;
  thumbnail_file?: EncryptedFile;
  thumbnail_info?: { w?: number; h?: number; mimetype?: string };
}

export function Linkified({ text }: { text: string }) {
  const platform = usePlatform();
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    let last = 0;
    for (const match of linkify.find(text)) {
      if (match.start > last) out.push(text.slice(last, match.start));
      const href = match.href;
      out.push(
        <a
          key={`${match.start}`}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => {
            e.stopPropagation();
            if (platform.openExternal) {
              e.preventDefault();
              platform.openExternal(href);
            }
          }}
        >
          {match.value}
        </a>,
      );
      last = match.end;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text, platform]);
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

export function isMediaMessage(ev: MatrixEvent): boolean {
  if (ev.isRedacted()) return false;
  if (ev.getType() === EventType.Sticker) return true;
  const t = ev.getContent().msgtype;
  return t === MsgType.Image || t === MsgType.Video;
}

/** True when the image has a caption separate from its file name (Matrix v1.10 media captions). */
function captionOf(content: Record<string, unknown>): string | null {
  const body = String(content.body ?? "");
  const filename = content.filename as string | undefined;
  if (filename && body && body !== filename) return body;
  return null;
}

export function MessageContent({
  ev,
  onOpenImage,
  emote,
}: {
  ev: MatrixEvent;
  onOpenImage: (img: LightboxImage) => void;
  emote?: string;
}) {
  if (ev.isRedacted()) {
    return (
      <span className="msg-muted">
        <Ban size={14} /> Message deleted
      </span>
    );
  }
  if (ev.isBeingDecrypted()) {
    return (
      <span className="msg-muted">
        <Spinner size={12} /> Decrypting…
      </span>
    );
  }
  if (ev.isDecryptionFailure() || ev.getType() === EventType.RoomMessageEncrypted) {
    return (
      <span className="msg-muted" title={ev.decryptionFailureReason ?? undefined}>
        <Lock size={14} /> Unable to decrypt this message
      </span>
    );
  }
  const content = ev.getContent() as Record<string, unknown>;
  if (ev.getType() === EventType.Sticker) {
    return <ImageContent content={content} onOpen={onOpenImage} sticker />;
  }
  switch (content.msgtype) {
    case MsgType.Image:
      return <ImageContent content={content} onOpen={onOpenImage} />;
    case MsgType.Video:
      return <VideoContent content={content} />;
    case MsgType.Audio:
      return <AudioContent content={content} />;
    case MsgType.File:
      return <FileContent content={content} />;
    case MsgType.Location: {
      const geo = String(content.geo_uri ?? "").replace(/^geo:/, "").split(";")[0];
      return (
        <a className="file-card" href={`https://www.openstreetmap.org/?mlat=${geo.split(",")[0]}&mlon=${geo.split(",")[1]}`} target="_blank" rel="noreferrer">
          <span className="file-card__icon">
            <MapPin size={20} />
          </span>
          <span className="file-card__text">
            <span className="file-card__name">{String(content.body ?? "Location")}</span>
            <span className="file-card__meta">{geo}</span>
          </span>
        </a>
      );
    }
    default: {
      const body = stripReplyFallback(String(content.body ?? ""));
      if (emote) {
        return (
          <span className="msg-text msg-text--emote">
            * {emote} <Linkified text={body} />
          </span>
        );
      }
      return (
        <span className={`msg-text ${content.msgtype === MsgType.Notice ? "msg-text--notice" : ""} ${isEmojiOnly(body) ? "msg-text--emoji" : ""}`}>
          <Linkified text={body} />
        </span>
      );
    }
  }
}

function fitSize(w?: number, h?: number, maxW = 320, maxH = 360): { width: number; height: number } {
  if (!w || !h) return { width: 260, height: 190 };
  const scale = Math.min(1, maxW / w, maxH / h);
  return { width: Math.max(80, Math.round(w * scale)), height: Math.max(60, Math.round(h * scale)) };
}

function ImageContent({
  content,
  onOpen,
  sticker,
}: {
  content: Record<string, unknown>;
  onOpen: (img: LightboxImage) => void;
  sticker?: boolean;
}) {
  const info = (content.info ?? {}) as MediaInfo;
  const file = content.file as EncryptedFile | undefined;
  const mxc = (file?.url ?? content.url) as string | undefined;
  const thumbFile = info.thumbnail_file;
  const isGif = info.mimetype === "image/gif";
  const thumbSource = file ? (thumbFile ?? file) : undefined;
  const url = useMediaUrl(thumbSource ? thumbSource.url : mxc, thumbSource
    ? { file: thumbSource, mimetype: thumbFile ? (info.thumbnail_info?.mimetype ?? "image/jpeg") : info.mimetype }
    : isGif
      ? undefined
      : { width: 800, height: 800, method: "scale" });
  const size = sticker ? fitSize(info.w, info.h, 180, 180) : fitSize(info.w, info.h);
  const caption = captionOf(content);
  const name = String(content.filename ?? content.body ?? "image");
  if (!mxc) return <span className="msg-muted">Invalid image</span>;
  return (
    <>
      <button
        className={`msg-image ${sticker ? "msg-image--sticker" : ""} ${url ? "is-loaded" : ""}`}
        style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }}
        onClick={(e) => {
          e.stopPropagation();
          onOpen({ mxc, name, caption: caption ?? undefined, placeholder: url, file, mimetype: info.mimetype });
        }}
      >
        {url ? <img src={url} alt={name} draggable={false} /> : <Spinner size={22} />}
      </button>
      {caption && (
        <span className="msg-text msg-caption">
          <Linkified text={caption} />
        </span>
      )}
    </>
  );
}

function VideoContent({ content }: { content: Record<string, unknown> }) {
  const info = (content.info ?? {}) as MediaInfo;
  const file = content.file as EncryptedFile | undefined;
  const mxc = (file?.url ?? content.url) as string | undefined;
  const [play, setPlay] = useState(false);
  const thumbMxc = info.thumbnail_file?.url ?? info.thumbnail_url;
  const thumb = useMediaUrl(thumbMxc, info.thumbnail_file ? { file: info.thumbnail_file, mimetype: info.thumbnail_info?.mimetype } : undefined);
  const video = useMediaUrl(play ? mxc : null, file ? { file, mimetype: info.mimetype } : undefined);
  const size = fitSize(info.w, info.h);
  return (
    <div className="msg-video" style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }}>
      {play && video ? (
        <video src={video} controls autoPlay playsInline />
      ) : (
        <button className="msg-video__poster" onClick={(e) => (e.stopPropagation(), setPlay(true))} aria-label="Play video">
          {thumb && <img src={thumb} alt="" />}
          <span className="msg-video__play">{play ? <Spinner size={22} /> : <Play size={26} fill="currentColor" />}</span>
        </button>
      )}
    </div>
  );
}

function AudioContent({ content }: { content: Record<string, unknown> }) {
  const info = (content.info ?? {}) as MediaInfo;
  const file = content.file as EncryptedFile | undefined;
  const mxc = (file?.url ?? content.url) as string | undefined;
  const [load, setLoad] = useState(false);
  const url = useMediaUrl(load ? mxc : null, file ? { file, mimetype: info.mimetype } : undefined);
  if (load && url) return <audio className="msg-audio" src={url} controls autoPlay />;
  return (
    <button className="file-card" onClick={(e) => (e.stopPropagation(), setLoad(true))}>
      <span className="file-card__icon">{load ? <Spinner size={18} /> : <Music size={20} />}</span>
      <span className="file-card__text">
        <span className="file-card__name">{String(content.body ?? "Audio")}</span>
        <span className="file-card__meta">Tap to play · {formatBytes(info.size)}</span>
      </span>
    </button>
  );
}

function FileContent({ content }: { content: Record<string, unknown> }) {
  const client = useMatrixClient();
  const info = (content.info ?? {}) as MediaInfo;
  const file = content.file as EncryptedFile | undefined;
  const mxc = (file?.url ?? content.url) as string | undefined;
  const name = String(content.filename ?? content.body ?? "file");
  const [busy, setBusy] = useState(false);
  const ext = name.includes(".") ? name.split(".").pop()!.toUpperCase().slice(0, 4) : "FILE";
  return (
    <button
      className="file-card"
      onClick={async (e) => {
        e.stopPropagation();
        if (!mxc) return;
        setBusy(true);
        try {
          await downloadMedia(client, mxc, name, file ? { file, mimetype: info.mimetype } : undefined);
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="file-card__icon">
        <FileText size={20} />
        <i>{ext}</i>
      </span>
      <span className="file-card__text">
        <span className="file-card__name">{name}</span>
        <span className="file-card__meta">{formatBytes(info.size) || info.mimetype}</span>
      </span>
      <span className="file-card__dl">{busy ? <Spinner size={16} /> : <Download size={18} />}</span>
    </button>
  );
}
