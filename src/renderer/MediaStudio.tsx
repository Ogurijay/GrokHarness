import { Dialog } from "./ui/Dialog";
import { Image as ImageIcon, Mic, Play, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComposerSubmitPayload, MediaAsset, PromptAttachment } from "../shared/types";
import { AttachIcon, ComposerSubmit } from "./composer-controls";
import { useImeEnterGuard } from "./ime";

export type StudioTab = "image" | "video" | "voice";

const ASPECTS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"] as const;

const COPY: Record<StudioTab, { title: string; hint: string; empty: string; placeholder: string }> = {
  image: {
    title: "图片生成",
    hint: "图片保存在本机。添加参考图可以修改已有画面。",
    empty: "还没有生成过图片。在底部写下画面，生成后会出现在这里。",
    placeholder: "描述画面，例如：金色日落下的平静海面，剪影棕榈树",
  },
  video: {
    title: "视频生成",
    hint: "添加参考图作为起始画面，或直接描述想要的镜头。",
    empty: "还没有生成过视频。在底部写下镜头，生成后会出现在这里。",
    placeholder: "描述镜头，例如：一只猫在爵士酒吧弹钢琴，镜头缓慢推近",
  },
  voice: {
    title: "语音转写",
    hint: "支持听写、录音和上传音频。转写结果保存到本机资源库。",
    empty: "还没有保存过转写。听写、录音或上传音频后会出现在这里。",
    placeholder: "",
  },
};

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function speechCtor(): (new () => SpeechRec) | undefined {
  const w = window as Window & { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

function sttLang(code: string): string | undefined {
  if (!code || code === "auto") return undefined;
  if (code === "zh" || code.startsWith("zh")) return "zh-CN";
  if (code === "en" || code.startsWith("en")) return "en-US";
  return code;
}

async function pickImage(): Promise<PromptAttachment | undefined> {
  const rows = await window.grok.pickFiles();
  return rows.find((row) => row.kind === "image");
}

function dayKey(ms: number): string {
  const date = new Date(ms);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayLabel(key: string): string {
  const now = new Date();
  const today = dayKey(now.getTime());
  const yest = dayKey(now.getTime() - 86400000);
  if (key === today) return "今天";
  if (key === yest) return "昨天";
  return key;
}

function formatWhen(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

function caption(asset: MediaAsset): string {
  const prompt = asset.prompt?.trim();
  if (prompt) return prompt;
  const text = asset.text?.trim();
  if (text) return text;
  const name = asset.name || "";
  if (/^(image|video)-[0-9a-f-]{8,}/i.test(name) || /^\d+\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$/i.test(name)) return "";
  return name;
}

function groupAssets(rows: MediaAsset[]): { key: string; label: string; items: MediaAsset[] }[] {
  const map = new Map<string, MediaAsset[]>();
  for (const row of rows) {
    const key = dayKey(row.createdAt || Date.now());
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()].map(([key, items]) => ({ key, label: dayLabel(key), items }));
}

export function MediaStudio({
  tab,
  busy,
  sessionId,
  voiceCaptureMode,
  voiceLanguage,
  onGenerate,
  onStop,
  onInsertText,
  onOpenSession,
}: {
  tab: StudioTab;
  busy: boolean;
  sessionId?: string;
  voiceCaptureMode: string;
  voiceLanguage: string;
  onGenerate: (payload: ComposerSubmitPayload) => Promise<void>;
  onStop: () => Promise<void>;
  onInsertText: (text: string) => void;
  onOpenSession: (sessionId: string, cwd?: string) => void;
}) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>("auto");
  const [imageRef, setImageRef] = useState<PromptAttachment | undefined>();
  const [videoPrompt, setVideoPrompt] = useState("");
  const [duration, setDuration] = useState<6 | 10>(6);
  const [videoRef, setVideoRef] = useState<PromptAttachment | undefined>();
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [viewer, setViewer] = useState<MediaAsset | undefined>();
  const [recording, setRecording] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [finalText, setFinalText] = useState("");
  const recRef = useRef<SpeechRec | undefined>(undefined);
  const mediaRef = useRef<MediaRecorder | undefined>(undefined);
  const chunksRef = useRef<Blob[]>([]);
  const { shouldHoldEnter, onCompositionEnd } = useImeEnterGuard();
  const hold = voiceCaptureMode !== "toggle";
  const copy = COPY[tab];

  async function load() {
    try {
      const rows = await window.grok.listMedia(tab);
      setAssets(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    setViewer(undefined);
    setQuery("");
    setError(undefined);
    void load();
  }, [tab]);

  useEffect(() => {
    if (!busy && !sending) {
      setPending(0);
      void load();
    }
  }, [busy, sending, tab]);

  useEffect(() => {
    if (!(busy || sending)) return;
    const id = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(id);
  }, [busy, sending, tab]);

  useEffect(() => () => {
    recRef.current?.stop();
    mediaRef.current?.state === "recording" && mediaRef.current.stop();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((row) =>
      [row.prompt, row.name, row.text, row.sessionId].some((value) => value?.toLowerCase().includes(q)),
    );
  }, [assets, query]);
  const groups = useMemo(() => groupAssets(filtered), [filtered]);

  useEffect(() => {
    if (!viewer) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewer(undefined);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const index = filtered.findIndex((row) => row.id === viewer.id);
      if (index < 0) return;
      const next = event.key === "ArrowRight" ? filtered[index + 1] : filtered[index - 1];
      if (next) setViewer(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, filtered]);

  async function run(payload: ComposerSubmitPayload, kind: StudioTab, prompt: string) {
    setError(undefined);
    setSending(true);
    setPending((count) => count + 1);
    try {
      await window.grok.recordMediaPrompt(kind, prompt, sessionId);
      await onGenerate(payload);
      void load();
    } catch (err) {
      setPending((count) => Math.max(0, count - 1));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function submitImage() {
    const prompt = imagePrompt.trim();
    if (!prompt) return;
    if (imageRef) {
      await run(
        {
          text: `请用附件图片做 image_edit，按下面说明修改，不要另起一张无关的新图。\n${prompt}${aspect !== "auto" ? `\naspect_ratio: ${aspect}` : ""}`,
          attachments: [imageRef],
          sessionRefs: [],
        },
        "image",
        prompt,
      );
      return;
    }
    await run(
      {
        text: `/imagine ${prompt}${aspect !== "auto" ? `\n请使用 aspect_ratio ${aspect}。` : ""}`,
        attachments: [],
        sessionRefs: [],
      },
      "image",
      prompt,
    );
  }

  async function submitVideo() {
    const prompt = videoPrompt.trim();
    if (!prompt) return;
    const extra = videoRef
      ? `用附件图作为第一帧，调用 image_to_video，时长 ${duration} 秒。`
      : `时长 ${duration} 秒。`;
    await run(
      {
        text: `/imagine-video ${prompt}\n${extra}`,
        attachments: videoRef ? [videoRef] : [],
        sessionRefs: [],
      },
      "video",
      prompt,
    );
  }

  function startSpeech() {
    const Ctor = speechCtor();
    setError(undefined);
    if (!Ctor) {
      setError("当前环境没有语音识别。可以录音后交给 Grok 转写，或安装系统语音包。");
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    const lang = sttLang(voiceLanguage);
    if (lang) rec.lang = lang;
    rec.onresult = (event) => {
      let interim = "";
      let done = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const row = event.results[i];
        if (row.isFinal) done += row[0].transcript;
        else interim += row[0].transcript;
      }
      if (done) setFinalText((prev) => `${prev}${done}`);
      setLiveText(interim);
    };
    rec.onerror = (event) => {
      if (event.error && event.error !== "no-speech" && event.error !== "aborted") {
        setError(event.error);
      }
      setRecording(false);
    };
    rec.onend = () => setRecording(false);
    recRef.current = rec;
    rec.start();
    setRecording(true);
  }

  function stopSpeech() {
    recRef.current?.stop();
    recRef.current = undefined;
    setRecording(false);
  }

  async function startTape() {
    setError(undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法打开麦克风");
    }
  }

  async function stopTapeAndSend() {
    const rec = mediaRef.current;
    if (!rec) {
      setRecording(false);
      return;
    }
    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        rec.stream.getTracks().forEach((track) => track.stop());
        resolve(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    });
    mediaRef.current = undefined;
    setRecording(false);
    if (blob.size < 64) {
      setError("没有录到有效音频");
      return;
    }
    const buf = await blob.arrayBuffer();
    const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
    const file = await window.grok.saveAudio(buf, blob.type || "audio/webm", ext);
    if (!file) {
      setError("保存录音失败");
      return;
    }
    await run(
      {
        text: "请把附件音频转写成文字。只输出转写正文，不要解释。",
        attachments: [file],
        sessionRefs: [],
      },
      "voice",
      "录音转写",
    );
  }

  async function pickAudioFile() {
    const rows = await window.grok.pickFiles();
    const file = rows.find((row) => row.mimeType.startsWith("audio/") || /\.(wav|mp3|m4a|aac|ogg|webm|flac)$/i.test(row.name));
    if (!file) {
      setError("请选择音频文件");
      return;
    }
    await run(
      {
        text: "请把附件音频转写成文字。只输出转写正文，不要解释。",
        attachments: [file],
        sessionRefs: [],
      },
      "voice",
      file.name,
    );
  }

  async function persistTranscript() {
    const text = `${finalText}${liveText}`.trim();
    if (!text) return;
    try {
      await window.grok.saveTranscript(text, "听写");
      setFinalText("");
      setLiveText("");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function useAsRef(asset: MediaAsset) {
    const [row] = await window.grok.inspectPaths([asset.path]);
    if (!row) return;
    if (tab === "video") setVideoRef(row);
    else setImageRef(row);
    setViewer(undefined);
  }

  async function reusePrompt(asset: MediaAsset) {
    const text = asset.prompt || asset.text || "";
    if (tab === "image") setImagePrompt(text);
    else if (tab === "video") setVideoPrompt(text);
    else setFinalText(text);
    setViewer(undefined);
  }

  const transcript = `${finalText}${liveText}`.trim();
  const blocked = busy || sending;
  const skeletons = Math.max(pending, blocked && tab !== "voice" ? 1 : 0);

  return (
    <div className="studio-page">
      <div className="studio-toolbar">
        <span className="studio-count">
          {filtered.length} 项{query ? " · 已筛选" : ""}
        </span>
        <input
          className="studio-search"
          value={query}
          aria-label="搜索媒体资源"
          placeholder="搜索提示词或文件名"
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="studio-lead">{copy.hint}</p>
      </div>

      <div className="studio-scroll">
        {filtered.length === 0 && !skeletons ? (
          <div className="studio-empty">
            <span className="studio-empty-icon">{tab === "image" ? <ImageIcon size={28} /> : tab === "video" ? <Video size={28} /> : <Mic size={28} />}</span>
            <strong>{copy.title}</strong>
            <p>{copy.empty}</p>
          </div>
        ) : tab === "voice" ? (
          <div className="studio-voice-list">
            {skeletons
              ? Array.from({ length: skeletons }, (_, index) => <div className="studio-voice-card pending" key={`p-${index}`} />)
              : null}
            {groups.map((group) => (
              <section key={group.key}>
                <h3 className="studio-day">{group.label}</h3>
                {group.items.map((asset) => (
                  <button className="studio-voice-card" type="button" key={asset.id} onClick={() => setViewer(asset)}>
                    <em>{formatWhen(asset.createdAt)}</em>
                    <p>{caption(asset) || asset.name}</p>
                  </button>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <>
            {filtered.length === 0 && skeletons ? (
              <div className="studio-masonry">
                {Array.from({ length: skeletons }, (_, index) => (
                  <div className="studio-tile pending" key={`p-${index}`} />
                ))}
              </div>
            ) : null}
            {groups.map((group) => (
              <section key={group.key}>
                <h3 className="studio-day">{group.label}</h3>
                <div className="studio-masonry">
                  {group.key === groups[0]?.key && skeletons
                    ? Array.from({ length: skeletons }, (_, index) => <div className="studio-tile pending" key={`s-${index}`} />)
                    : null}
                  {group.items.map((asset) => (
                    <button className="studio-tile" type="button" key={asset.id} onClick={() => setViewer(asset)}>
                      {asset.kind === "video" ? (
                        <video src={asset.src} muted playsInline preload="metadata" />
                      ) : (
                        <img src={asset.src} alt={caption(asset) || asset.name} />
                      )}
                      <span className="studio-tile-mask">
                        <em>{caption(asset) || formatWhen(asset.createdAt)}</em>
                      </span>
                      {asset.kind === "video" ? <i className="studio-play"><Play size={16} fill="currentColor" /></i> : null}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      <div className="studio-dock">
        {tab === "image" ? (
          <>
            <textarea
              aria-label={`${copy.title}提示词`}
              className="studio-prompt"
              rows={2}
              value={imagePrompt}
              placeholder={copy.placeholder}
              onChange={(event) => setImagePrompt(event.target.value)}
              onCompositionEnd={onCompositionEnd}
              onKeyDown={(event) => {
                if (shouldHoldEnter(event)) return;
                if (event.key === "Enter" && !event.ctrlKey && !event.shiftKey) {
                  event.preventDefault();
                  void submitImage();
                }
              }}
            />
            <div className="studio-dock-row">
              <div className="studio-chips">
                {ASPECTS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`chip-btn ${aspect === item ? "on" : ""}`}
                    onClick={() => setAspect(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <button
                className="icon-btn attach-btn"
                type="button"
                title="参考图"
                onClick={() => void pickImage().then((row) => row && setImageRef(row))}
              >
                <AttachIcon />
              </button>
              {imageRef ? (
                <button className="studio-ref-thumb" type="button" title="移除参考" onClick={() => setImageRef(undefined)}>
                  <img src={imageRef.preview || imageRef.path} alt="" />
                </button>
              ) : null}
              <ComposerSubmit
                busy={blocked}
                disabled={!imagePrompt.trim() && !blocked}
                onClick={() => void (blocked ? onStop() : submitImage())}
              />
            </div>
          </>
        ) : null}

        {tab === "video" ? (
          <>
            <textarea
              aria-label={`${copy.title}提示词`}
              className="studio-prompt"
              rows={2}
              value={videoPrompt}
              placeholder={copy.placeholder}
              onChange={(event) => setVideoPrompt(event.target.value)}
              onCompositionEnd={onCompositionEnd}
              onKeyDown={(event) => {
                if (shouldHoldEnter(event)) return;
                if (event.key === "Enter" && !event.ctrlKey && !event.shiftKey) {
                  event.preventDefault();
                  void submitVideo();
                }
              }}
            />
            <div className="studio-dock-row">
              <div className="studio-chips">
                {([6, 10] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`chip-btn ${duration === item ? "on" : ""}`}
                    onClick={() => setDuration(item)}
                  >
                    {item}s
                  </button>
                ))}
              </div>
              <button
                className="icon-btn attach-btn"
                type="button"
                title="第一帧"
                onClick={() => void pickImage().then((row) => row && setVideoRef(row))}
              >
                <AttachIcon />
              </button>
              {videoRef ? (
                <button className="studio-ref-thumb" type="button" title="移除第一帧" onClick={() => setVideoRef(undefined)}>
                  <img src={videoRef.preview || videoRef.path} alt="" />
                </button>
              ) : null}
              <ComposerSubmit
                busy={blocked}
                disabled={!videoPrompt.trim() && !blocked}
                onClick={() => void (blocked ? onStop() : submitVideo())}
              />
            </div>
          </>
        ) : null}

        {tab === "voice" ? (
          <>
            <div className="studio-transcript">{transcript || "转写会显示在这里。"}</div>
            <div className="studio-dock-row">
              <button
                className={`studio-mic ${recording ? "on" : ""}`}
                type="button"
                disabled={blocked}
                onMouseDown={() => {
                  if (hold) startSpeech();
                }}
                onMouseUp={() => {
                  if (hold) stopSpeech();
                }}
                onMouseLeave={() => {
                  if (hold && recording) stopSpeech();
                }}
                onClick={() => {
                  if (hold) return;
                  recording ? stopSpeech() : startSpeech();
                }}
              >
                {recording ? "正在听…" : hold ? "按住说话" : "开始听写"}
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={blocked}
                onClick={() => void (recording && mediaRef.current ? stopTapeAndSend() : startTape())}
              >
                {recording && mediaRef.current ? "停止并转写" : "录音转写"}
              </button>
              <button className="btn ghost" type="button" disabled={blocked} onClick={() => void pickAudioFile()}>
                上传音频
              </button>
              <button className="btn ghost" type="button" disabled={!transcript} onClick={() => void persistTranscript()}>
                保存到资源库
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={!transcript}
                onClick={() => {
                  onInsertText(transcript);
                }}
              >
                插入对话输入框
              </button>
            </div>
          </>
        ) : null}

        {error ? <div className="error-banner">{error}</div> : null}
        {blocked && !error ? <p className="studio-hint">正在生成，完成后会自动出现在资源库。对话仍在后台继续。</p> : null}
      </div>

      {viewer ? (
        <Dialog title="资源预览" className="media-preview-panel" onClose={() => setViewer(undefined)}>
          <div className="studio-lightbox-body" onClick={(event) => event.stopPropagation()}>
            <div className="studio-lightbox-stage">
              {viewer.kind === "video" ? (
                <video src={viewer.src} controls autoPlay />
              ) : viewer.kind === "voice" ? (
                <pre>{viewer.text || viewer.prompt || viewer.name}</pre>
              ) : (
                <img src={viewer.src} alt={viewer.prompt || viewer.name} />
              )}
            </div>
            <aside className="studio-lightbox-meta">
              <strong>{viewer.kind === "voice" ? "转写" : "提示词"}</strong>
              <p>{caption(viewer) || "没有记录提示词"}</p>
              <em>{formatWhen(viewer.createdAt)}</em>
              <div className="studio-lightbox-actions">
                <button className="btn ghost" type="button" onClick={() => void reusePrompt(viewer)}>
                  再用此提示
                </button>
                {viewer.kind !== "voice" ? (
                  <button className="btn ghost" type="button" onClick={() => void useAsRef(viewer)}>
                    作为参考
                  </button>
                ) : (
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      if (viewer.text) onInsertText(viewer.text);
                    }}
                  >
                    插入输入框
                  </button>
                )}
                {viewer.path ? (
                  <button className="btn ghost" type="button" onClick={() => void window.grok.exportMedia(viewer.path, viewer.name)}>
                    下载
                  </button>
                ) : null}
                {viewer.path ? (
                  <button className="btn ghost" type="button" onClick={() => void window.grok.copyMedia(viewer.path)}>
                    复制
                  </button>
                ) : null}
                {viewer.path ? (
                  <button className="btn ghost" type="button" onClick={() => void window.grok.revealMedia(viewer.path)}>
                    打开位置
                  </button>
                ) : null}
                {viewer.sessionId ? (
                  <button className="btn ghost" type="button" onClick={() => onOpenSession(viewer.sessionId!, viewer.cwd)}>
                    查看对话
                  </button>
                ) : null}
                <button
                  className="btn ghost danger"
                  type="button"
                  onClick={() => {
                    void window.grok.deleteMedia(viewer.id).then((result) => {
                      if (!result.ok) {
                        if (result.error) setError(result.error);
                        return;
                      }
                      setViewer(undefined);
                      void load();
                    });
                  }}
                >
                  删除
                </button>
              </div>
            </aside>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
