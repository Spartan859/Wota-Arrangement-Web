import {
  ArrowLeft,
  Copy,
  ExternalLink,
  FileAudio,
  LogIn,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteShare,
  deleteShareAudio,
  fetchShares,
  uploadShareAudio,
} from "../api/client";
import { formatBytes, type ShareSummary } from "../core/share";
import { useSession } from "../session";

export function MySharesPage() {
  const { session, loading: sessionLoading, login } = useSession();
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<{
    id: string;
    value: number;
  } | null>(null);
  const load = async () => {
    if (!session.authenticated) return;
    setLoading(true);
    try {
      setShares(await fetchShares());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取在线编排。");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [session.authenticated]);
  useEffect(() => {
    if (!error && !notice) return;
    const timer = setTimeout(() => {
      setError("");
      setNotice("");
    }, 6000);
    return () => clearTimeout(timer);
  }, [error, notice]);
  if (sessionLoading)
    return <main className="public-loading">正在读取账号状态…</main>;
  if (!session.authenticated || !session.user)
    return (
      <main className="public-error">
        <LogIn size={34} />
        <h1>登录后查看在线编排</h1>
        <button className="primary" onClick={() => login("/shares")}>
          登录
        </button>
      </main>
    );
  const used = session.user.usedBytes;
  const quota = session.user.quotaBytes;
  return (
    <div className="account-page">
      <header className="account-header">
        <Link to="/">
          <ArrowLeft size={17} /> 返回工作台
        </Link>
        <div>
          <span>Wota 账号</span>
          <h1>我的在线编排</h1>
          <p>
            {session.user.email} · 已用 {formatBytes(used)} /{" "}
            {formatBytes(quota)}
          </p>
        </div>
        {session.user.isAdmin && <Link to="/admin">管理员后台</Link>}
      </header>
      <div className="quota-bar" aria-label="云空间用量">
        <span
          style={{
            width: `${quota ? Math.min(100, (used / quota) * 100) : 0}%`,
          }}
        />
      </div>
      {(error || notice) && (
        <div className={"message toast " + (error ? "error" : "")} role="alert">
          {error || notice}
        </div>
      )}
      {loading ? (
        <main className="public-loading">正在读取在线编排…</main>
      ) : shares.length ? (
        <main className="share-list">
          {shares.map((share) => (
            <article className="share-card" key={share.id}>
              <div>
                <h2>{share.songName}</h2>
                <p>
                  版本 {share.revision} · 更新于{" "}
                  {new Date(share.updatedAt).toLocaleString()}
                </p>
                <p className={share.audio ? "audio-ok" : "audio-missing"}>
                  {share.audio
                    ? `${share.audio.name} · ${formatBytes(share.audio.sizeBytes)}`
                    : "云端音乐已删除，分享页仍可使用本地音乐"}
                </p>
              </div>
              <div className="share-card-actions">
                <a href={share.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} /> 打开
                </a>
                <button
                  onClick={() => {
                    if (!navigator.clipboard) {
                      setNotice(share.url);
                      return;
                    }
                    void navigator.clipboard
                      .writeText(share.url)
                      .then(() => setNotice("分享链接已复制。"))
                      .catch(() => setNotice(share.url));
                  }}
                >
                  <Copy size={15} /> 复制链接
                </button>
                <label className="file-button">
                  <FileAudio size={15} />{" "}
                  {share.audio ? "更换音乐" : "恢复音乐"}
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file || !session.csrfToken) return;
                      setProgress({ id: share.id, value: 0 });
                      void uploadShareAudio(
                        share.id,
                        { blob: file, name: file.name },
                        session.csrfToken,
                        (value) => setProgress({ id: share.id, value }),
                      )
                        .then((updated) => {
                          setShares((current) =>
                            current.map((item) =>
                              item.id === updated.id ? updated : item,
                            ),
                          );
                          setNotice("云端音乐已更新。");
                        })
                        .catch((cause) =>
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : "上传失败。",
                          ),
                        )
                        .finally(() => setProgress(null));
                      event.target.value = "";
                    }}
                  />
                </label>
                {share.audio && (
                  <button
                    onClick={() => {
                      if (
                        !session.csrfToken ||
                        !confirm("删除云端音乐？分享链接会继续有效。")
                      )
                        return;
                      void deleteShareAudio(share.id, session.csrfToken)
                        .then(() => {
                          setShares((current) =>
                            current.map((item) =>
                              item.id === share.id
                                ? { ...item, audio: null }
                                : item,
                            ),
                          );
                          setNotice("云端音乐已删除，分享编排仍然有效。");
                        })
                        .catch((cause) =>
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : "删除失败。",
                          ),
                        );
                    }}
                  >
                    删除音乐
                  </button>
                )}
                <button
                  className="danger"
                  onClick={() => {
                    if (
                      !session.csrfToken ||
                      !confirm("取消在线分享并删除云端音乐？")
                    )
                      return;
                    void deleteShare(share.id, session.csrfToken)
                      .then(() => {
                        setShares((current) =>
                          current.filter((item) => item.id !== share.id),
                        );
                        setNotice("在线分享已取消。");
                      })
                      .catch((cause) =>
                        setError(
                          cause instanceof Error ? cause.message : "删除失败。",
                        ),
                      );
                  }}
                >
                  <Trash2 size={15} /> 取消分享
                </button>
              </div>
              {progress?.id === share.id && (
                <progress max={100} value={progress.value} />
              )}
            </article>
          ))}
        </main>
      ) : (
        <main className="empty-state">
          <h2>还没有在线编排</h2>
          <p>回到工作台，在导出窗口发布并复制分享链接。</p>
          <Link to="/">返回工作台</Link>
        </main>
      )}
    </div>
  );
}
