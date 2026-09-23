import { ArrowLeft, LogIn, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  addAdmin,
  adminDeleteShare,
  adminDeleteShareAudio,
  fetchAdminUsers,
  fetchAdminUserShares,
  updateUserQuota,
} from "../api/client";
import {
  formatBytes,
  quotaMiB,
  type AdminUser,
  type ShareSummary,
} from "../core/share";
import { useSession } from "../session";

export function AdminPage() {
  const { session, loading: sessionLoading, login } = useSession();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const loadUsers = async (nextPage = page) => {
    setLoading(true);
    try {
      const result = await fetchAdminUsers(nextPage, search);
      setUsers(result.users);
      setTotal(result.total);
      setPage(result.page);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取用户。");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (session.user?.isAdmin) void loadUsers();
  }, [session.user?.isAdmin]);
  useEffect(() => {
    if (!selected) return;
    fetchAdminUserShares(selected.id)
      .then(setShares)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "无法读取用户文件。"),
      );
  }, [selected]);
  useEffect(() => {
    if (!error && !notice) return;
    const timer = setTimeout(() => {
      setError("");
      setNotice("");
    }, 6000);
    return () => clearTimeout(timer);
  }, [error, notice]);
  if (sessionLoading)
    return <main className="public-loading">正在读取管理员状态…</main>;
  if (!session.user?.isAdmin)
    return (
      <main className="public-error">
        <LogIn size={34} />
        <h1>需要管理员账号</h1>
        {!session.authenticated && (
          <button className="primary" onClick={() => login("/admin")}>
            登录
          </button>
        )}
        <Link to="/">返回工作台</Link>
      </main>
    );
  const mutate = async (operation: () => Promise<unknown>, message: string) => {
    if (!session.csrfToken) return;
    try {
      await operation();
      setNotice(message);
      if (selected) setShares(await fetchAdminUserShares(selected.id));
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "管理操作失败。");
    }
  };
  return (
    <div className="admin-page">
      <header className="account-header">
        <Link to="/">
          <ArrowLeft size={17} /> 返回工作台
        </Link>
        <div>
          <span>Wota 管理</span>
          <h1>账号与云空间</h1>
          <p>查看用户文件、调整配额并邀请管理员。</p>
        </div>
        <Link to="/shares">我的分享</Link>
      </header>
      {(error || notice) && (
        <div className={"message toast " + (error ? "error" : "")} role="alert">
          {error || notice}
        </div>
      )}
      <main className="admin-layout">
        <section className="admin-users">
          <form
            className="admin-search"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              void loadUsers(1);
            }}
          >
            <Search size={15} />
            <input
              aria-label="搜索用户"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="邮箱或用户名"
            />
            <button>搜索</button>
          </form>
          {loading ? (
            <p>正在读取用户…</p>
          ) : (
            <div className="admin-user-list">
              {users.map((user) => (
                <button
                  key={user.id}
                  className={selected?.id === user.id ? "active" : ""}
                  onClick={() => setSelected(user)}
                >
                  <span>
                    <strong>{user.name || user.email}</strong>
                    <small>
                      {user.email} · {user.shareCount} 个在线编排
                    </small>
                  </span>
                  <span>
                    {formatBytes(user.usedBytes)} /{" "}
                    {formatBytes(user.quotaBytes)}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="admin-pagination">
            <button
              disabled={page <= 1 || loading}
              onClick={() => void loadUsers(page - 1)}
            >
              上一页
            </button>
            <span>
              第 {page} 页 · 共 {total} 位用户
            </span>
            <button
              disabled={page * 20 >= total || loading}
              onClick={() => void loadUsers(page + 1)}
            >
              下一页
            </button>
          </div>
          <form
            className="add-admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!session.csrfToken) return;
              void mutate(
                () =>
                  addAdmin(
                    { email: adminEmail, name: adminName },
                    session.csrfToken!,
                  ),
                "管理员邀请邮件已发送。",
              ).then(() => {
                setAdminEmail("");
                setAdminName("");
              });
            }}
          >
            <h2>添加管理员</h2>
            <input
              type="email"
              required
              aria-label="管理员邮箱"
              placeholder="邮箱"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
            />
            <input
              aria-label="管理员姓名"
              placeholder="姓名"
              value={adminName}
              onChange={(event) => setAdminName(event.target.value)}
            />
            <button className="primary">发送邀请</button>
          </form>
        </section>
        <section className="admin-detail">
          {selected ? (
            <>
              <div className="admin-user-heading">
                <div>
                  <h2>{selected.name || selected.email}</h2>
                  <p>{selected.email}</p>
                </div>
                <label>
                  配额（MiB）
                  <input
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={quotaMiB(selected.quotaBytes)}
                    onBlur={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isFinite(value) || !session.csrfToken) return;
                      void mutate(
                        () =>
                          updateUserQuota(
                            selected.id,
                            value,
                            session.csrfToken!,
                          ),
                        "用户配额已更新。",
                      );
                    }}
                  />
                </label>
              </div>
              <div className="admin-share-list">
                {shares.map((share) => (
                  <article key={share.id}>
                    <div>
                      <strong>{share.songName}</strong>
                      <span>
                        {share.audio
                          ? `${formatBytes(share.audio.sizeBytes)} · ${share.audio.name}`
                          : "无云端音乐"}
                      </span>
                    </div>
                    <a href={share.url} target="_blank" rel="noreferrer">
                      查看
                    </a>
                    {share.audio && (
                      <button
                        onClick={() =>
                          void mutate(
                            () =>
                              adminDeleteShareAudio(
                                share.id,
                                session.csrfToken!,
                              ),
                            "云端音乐已删除。",
                          )
                        }
                      >
                        删除音乐
                      </button>
                    )}
                    <button
                      className="danger"
                      onClick={() => {
                        if (!confirm(`删除 ${share.songName} 的在线编排？`))
                          return;
                        void mutate(
                          () => adminDeleteShare(share.id, session.csrfToken!),
                          "在线编排已删除。",
                        );
                      }}
                    >
                      <Trash2 size={14} /> 删除
                    </button>
                  </article>
                ))}
                {!shares.length && (
                  <p className="muted">该用户还没有在线编排。</p>
                )}
              </div>
            </>
          ) : (
            <p className="muted">选择用户后查看音乐和在线编排。</p>
          )}
        </section>
      </main>
    </div>
  );
}
