import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, useRestoreFocusTarget } from '@fluentui/react-components';
import { MagnifyingGlass, UserGear, CheckCircle, ArrowClockwise } from '@phosphor-icons/react';
import { service } from '../lib/service';
import type { Account, AccountStatus, Role } from '../types';
import { Empty, Loading, messageOf, Notice, roleLabels } from './shared';

const statusLabels: Record<AccountStatus, string> = { pending: '等待批准', active: '已啟用', suspended: '已停用' };
export function AccountsAdmin({ currentAccount, onReload }: { currentAccount: Account; onReload: () => Promise<void> }) {
  const restoreFocusTarget = useRestoreFocusTarget();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<Account | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try { const result = await service.accounts(); if (generation.current === request) { setAccounts(result); setError(''); } } catch (err) { if (generation.current === request) setError(messageOf(err)); } finally { if (generation.current === request) setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 60_000); const focus = () => void load(); window.addEventListener('focus', focus); return () => { generation.current++; window.clearInterval(timer); window.removeEventListener('focus', focus); }; }, [load]);
  const filtered = accounts.filter(account => (filter === 'all' || account.status === filter) && `${account.display_name} ${account.email}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section aria-labelledby="accounts-title"><div className="section-heading admin-section-heading"><div><h2 id="accounts-title">帳戶與權限</h2><p>批准新同學、安排教職員及管理員權限。</p></div><Button icon={<ArrowClockwise size={18}/>} onClick={() => void load()}>重新整理</Button></div><Notice>新登記帳戶預設等待批准。學生只可閱讀已發布材料；老師可閱讀全部未封存材料；管理員可修改帳戶及課程設定。</Notice>{success && <Notice kind="success">{success}</Notice>}{error && <Notice kind="error">{error}</Notice>}<div className="admin-filter-row account-filters"><Field label="搜尋帳戶"><Input type="search" contentBefore={<MagnifyingGlass size={18} aria-hidden="true"/>} value={search} onChange={(_, data) => setSearch(data.value)} placeholder="姓名或電郵"/></Field><Field label="啟用狀態"><Select value={filter} onChange={(_, data) => setFilter(data.value)}><option value="all">全部帳戶</option><option value="pending">等待批准</option><option value="active">已啟用</option><option value="suspended">已停用</option></Select></Field></div>
    {loading ? <Loading label="正在讀取帳戶…"/> : <><div className="result-meta" role="status">共 {filtered.length} 個帳戶<span>{accounts.filter(account => account.status === 'pending').length} 個等待批准</span></div>{filtered.length ? <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="帳戶清單，可左右捲動"><table className="admin-table"><thead><tr><th scope="col">帳戶</th><th scope="col">權限</th><th scope="col">狀態</th><th scope="col">操作</th></tr></thead><tbody>{filtered.map(account => <tr key={account.id}><td><strong>{account.display_name || '未填寫姓名'}{account.id === currentAccount.id && <span className="self-label">你</span>}</strong><small>{account.email}</small></td><td>{roleLabels[account.role]}</td><td><span className={`status-tag ${account.status === 'pending' ? 'waiting-tag' : account.status === 'suspended' ? 'staff-tag' : ''}`}>{statusLabels[account.status]}</span></td><td><Button {...restoreFocusTarget} size="small" icon={account.status === 'pending' ? <CheckCircle size={18}/> : <UserGear size={18}/>} onClick={() => { setEditing(account); setSuccess(''); }} aria-label={`${account.status === 'pending' ? '審批' : '管理'} ${account.display_name || account.email}`}>{account.status === 'pending' ? '審批帳戶' : '管理權限'}</Button></td></tr>)}</tbody></table></div> : <Empty title="沒有符合條件的帳戶">調整搜尋條件，或等候同學從登入頁申請帳戶。</Empty>}</>}
    {editing && <AccountEditor account={editing} isSelf={editing.id === currentAccount.id} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setSuccess('帳戶權限已更新。'); await load(); await onReload(); }}/>}
  </section>;
}

function AccountEditor({ account, isSelf, onClose, onSaved }: { account: Account; isSelf: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [role, setRole] = useState<Role>(account.role);
  const [status, setStatus] = useState<AccountStatus>(account.status === 'pending' ? 'active' : account.status);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() { setBusy(true); setError(''); try { await service.updateAccount(account, role, status); await onSaved(); } catch (err) { setError(messageOf(err)); } finally { setBusy(false); } }
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy) onClose(); }}><DialogSurface><DialogBody><DialogTitle>{confirm ? '確認這次權限變更' : account.status === 'pending' ? '審批新帳戶' : '管理帳戶權限'}</DialogTitle><DialogContent><div className="account-dialog-identity"><strong>{account.display_name || '未填寫姓名'}</strong><span>{account.email}</span></div>{!confirm ? <div className="stack-form"><Field label="帳戶權限"><Select value={role} onChange={(_, data) => setRole(data.value as Role)} disabled={busy}><option value="student">學生 · 已發布材料</option><option value="teacher">老師 · 全部未封存材料</option><option value="admin">管理員 · 全部材料及設定</option></Select></Field><Field label="帳戶狀態"><Select value={status} onChange={(_, data) => setStatus(data.value as AccountStatus)} disabled={busy}><option value="active">已啟用</option><option value="pending">等待批准</option><option value="suspended">已停用</option></Select></Field><p className="form-helper">停用帳戶後，該帳戶將無法取得課程材料。資料及操作記錄會保留。</p></div> : <div className="change-summary"><div><span>權限</span><strong>{roleLabels[account.role]} → {roleLabels[role]}</strong></div><div><span>狀態</span><strong>{statusLabels[account.status]} → {statusLabels[status]}</strong></div>{role === 'admin' && <Notice>管理員可以下載所有教材、修改發布安排及更改其他帳戶權限。</Notice>}{isSelf && (role !== 'admin' || status !== 'active') && <Notice>這是你目前使用的帳戶。變更後，你可能無法繼續使用管理後臺。</Notice>}<p className="form-helper">系統會保留至少一位已啟用管理員，並記錄本次操作。</p></div>}{error && <Notice kind="error">{error}<p>設定尚未儲存，你選擇的內容仍保留。</p></Notice>}</DialogContent><DialogActions><Button disabled={busy} onClick={confirm ? () => setConfirm(false) : onClose}>{confirm ? '返回修改' : '取消'}</Button><Button appearance="primary" disabled={busy || (role === account.role && status === account.status)} onClick={confirm ? () => void save() : () => setConfirm(true)}>{busy ? '正在更新…' : confirm ? '確認更新' : '核對變更'}</Button></DialogActions></DialogBody></DialogSurface></Dialog>;
}
