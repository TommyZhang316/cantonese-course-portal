import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, useRestoreFocusTarget } from '@fluentui/react-components';
import { MagnifyingGlass, UserGear, CheckCircle, ArrowClockwise, Key } from '@phosphor-icons/react';
import { service } from '../lib/service';
import type { Account, AccountStatus, Role } from '../types';
import { Empty, Loading, messageOf, Notice, roleLabels } from './shared';
import { BatchAccounts } from './BatchAccounts';

const statusLabels: Record<AccountStatus, string> = { pending: '舊有待處理', active: '已啟用', suspended: '已停用' };
export function AccountsAdmin({ currentAccount, onReload }: { currentAccount: Account; onReload: () => Promise<void> }) {
  const restoreFocusTarget = useRestoreFocusTarget();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<Account | null>(null);
  const [resetting, setResetting] = useState<Account | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try { const result = await service.accounts(); if (generation.current === request) { setAccounts(result); setError(''); } } catch (err) { if (generation.current === request) setError(messageOf(err)); } finally { if (generation.current === request) setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 60_000); const focus = () => void load(); window.addEventListener('focus', focus); return () => { generation.current++; window.clearInterval(timer); window.removeEventListener('focus', focus); }; }, [load]);
  const filtered = accounts.filter(account => (filter === 'all' || account.status === filter) && `${account.display_name} ${account.username || ''} ${account.email}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section aria-labelledby="accounts-title"><div className="section-heading admin-section-heading"><div><h2 id="accounts-title">帳戶與權限</h2><p>直接建立學生帳戶，安排教職員及管理員權限。</p></div><Button icon={<ArrowClockwise size={18}/>} onClick={() => void load()}>重新整理</Button></div><Notice>學生帳戶由管理員建立，啟用後只可閱讀已發布材料；老師可閱讀全部未封存材料；管理員可修改帳戶及課程設定。</Notice>{success && <Notice kind="success">{success}</Notice>}{error && <Notice kind="error">{error}</Notice>}
    <BatchAccounts accounts={accounts} unavailable={loading || Boolean(error)} onCreated={load}/>
    <div className="admin-filter-row account-filters"><Field label="搜尋帳戶"><Input type="search" contentBefore={<MagnifyingGlass size={18} aria-hidden="true"/>} value={search} onChange={(_, data) => setSearch(data.value)} placeholder="姓名、帳戶名稱或電郵"/></Field><Field label="啟用狀態"><Select value={filter} onChange={(_, data) => setFilter(data.value)}><option value="all">全部帳戶</option><option value="pending">舊有待處理</option><option value="active">已啟用</option><option value="suspended">已停用</option></Select></Field></div>
    {loading ? <Loading label="正在讀取帳戶…"/> : <><div className="result-meta" role="status">共 {filtered.length} 個帳戶<span>{accounts.filter(account => account.status === 'pending').length} 個舊有待處理</span></div>{filtered.length ? <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="帳戶清單，可左右捲動"><table className="admin-table"><thead><tr><th scope="col">帳戶</th><th scope="col">權限</th><th scope="col">狀態</th><th scope="col">操作</th></tr></thead><tbody>{filtered.map(account => <tr key={account.id}><td><strong>{account.display_name || '未填寫姓名'}{account.id === currentAccount.id && <span className="self-label">你</span>}</strong><small>{account.username || account.email}</small></td><td>{roleLabels[account.role]}</td><td><span className={`status-tag ${account.status === 'pending' ? 'waiting-tag' : account.status === 'suspended' ? 'staff-tag' : ''}`}>{statusLabels[account.status]}</span>{account.must_change_password && <small>首次登入需改密碼</small>}</td><td><div className="batch-accounts-manage-actions"><Button {...restoreFocusTarget} size="small" icon={account.status === 'pending' ? <CheckCircle size={18}/> : <UserGear size={18}/>} onClick={() => { setEditing(account); setSuccess(''); }} aria-label={`${account.status === 'pending' ? '處理' : '管理'} ${account.display_name || account.username || account.email}`}>{account.status === 'pending' ? '處理舊有帳戶' : '管理權限'}</Button>{account.username && account.role === 'student' && account.id !== currentAccount.id && <Button {...restoreFocusTarget} size="small" appearance="subtle" icon={<Key size={18}/>} onClick={() => { setResetting(account); setSuccess(''); }} aria-label={`重設 ${account.display_name || account.username} 的初始密碼`}>重設初始密碼</Button>}</div></td></tr>)}</tbody></table></div> : <Empty title="沒有符合條件的帳戶">調整搜尋條件，或在上方貼上同學姓名建立帳戶。</Empty>}</>}
    {editing && <AccountEditor account={editing} isSelf={editing.id === currentAccount.id} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setSuccess('帳戶權限已更新。'); await load(); await onReload(); }}/>}
    {resetting && <ResetInitialPassword account={resetting} onClose={() => setResetting(null)} onSaved={async () => { setResetting(null); setSuccess(`${resetting.display_name} 的初始密碼已重設為 ${resetting.username}，下次登入需先設定新密碼。`); await load(); }}/>}
  </section>;
}

function AccountEditor({ account, isSelf, onClose, onSaved }: { account: Account; isSelf: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [role, setRole] = useState<Role>(account.role);
  const [status, setStatus] = useState<AccountStatus>(account.status === 'pending' ? 'active' : account.status);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() { setBusy(true); setError(''); try { await service.updateAccount(account, role, status); await onSaved(); } catch (err) { setError(messageOf(err)); } finally { setBusy(false); } }
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy) onClose(); }}><DialogSurface><DialogBody><DialogTitle>{confirm ? '確認這次權限變更' : account.status === 'pending' ? '處理舊有帳戶' : '管理帳戶權限'}</DialogTitle><DialogContent><div className="account-dialog-identity"><strong>{account.display_name || '未填寫姓名'}</strong><span>{account.username || account.email}</span></div>{!confirm ? <div className="stack-form"><Field label="帳戶權限"><Select value={role} onChange={(_, data) => setRole(data.value as Role)} disabled={busy}><option value="student">學生 · 已發布材料</option><option value="teacher">老師 · 全部未封存材料</option><option value="admin">管理員 · 全部材料及設定</option></Select></Field><Field label="帳戶狀態"><Select value={status} onChange={(_, data) => setStatus(data.value as AccountStatus)} disabled={busy}><option value="active">已啟用</option><option value="pending">舊有待處理</option><option value="suspended">已停用</option></Select></Field><p className="form-helper">停用帳戶後，該帳戶將無法取得課程材料。資料及操作記錄會保留。</p></div> : <div className="change-summary"><div><span>權限</span><strong>{roleLabels[account.role]} → {roleLabels[role]}</strong></div><div><span>狀態</span><strong>{statusLabels[account.status]} → {statusLabels[status]}</strong></div>{role === 'admin' && <Notice>管理員可以下載所有教材、修改發布安排及更改其他帳戶權限。</Notice>}{isSelf && (role !== 'admin' || status !== 'active') && <Notice>這是你目前使用的帳戶。變更後，你可能無法繼續使用管理後臺。</Notice>}<p className="form-helper">系統會保留至少一位已啟用管理員，並記錄本次操作。</p></div>}{error && <Notice kind="error">{error}<p>設定尚未儲存，你選擇的內容仍保留。</p></Notice>}</DialogContent><DialogActions><Button disabled={busy} onClick={confirm ? () => setConfirm(false) : onClose}>{confirm ? '返回修改' : '取消'}</Button><Button appearance="primary" disabled={busy || (role === account.role && status === account.status)} onClick={confirm ? () => void save() : () => setConfirm(true)}>{busy ? '正在更新…' : confirm ? '確認更新' : '核對變更'}</Button></DialogActions></DialogBody></DialogSurface></Dialog>;
}

function ResetInitialPassword({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function reset() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await service.resetInitialPassword(account); await onSaved(); }
    catch (err) { setError(messageOf(err)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy) onClose(); }}><DialogSurface><DialogBody><DialogTitle>重設這位同學的初始密碼</DialogTitle><DialogContent><div className="account-dialog-identity"><strong>{account.display_name}</strong><span>{account.username}</span></div><p>重設後，初始密碼會與帳戶名稱相同。請把以下資料逐一交給這位同學。</p><div className="change-summary"><div><span>初始密碼</span><strong>{account.username}</strong></div></div><Notice>原有密碼將失效。這位同學下次登入時，必須先設定新密碼，才可閱讀課程材料。</Notice>{error && <Notice kind="error">{error}</Notice>}</DialogContent><DialogActions><Button disabled={busy} onClick={onClose}>取消</Button><Button appearance="primary" disabled={busy} onClick={() => void reset()}>{busy ? '正在重設…' : '確認重設初始密碼'}</Button></DialogActions></DialogBody></DialogSurface></Dialog>;
}
