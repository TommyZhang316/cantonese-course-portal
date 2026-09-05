import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Field, Input } from '@fluentui/react-components';
import { Folders, UsersThree, CalendarBlank, ClockCounterClockwise, ArrowClockwise, MagnifyingGlass, ShieldCheck } from '@phosphor-icons/react';
import type { Account, AuditEntry, Lesson, Resource } from '../types';
import { service } from '../lib/service';
import { MaterialsAdmin } from './MaterialsAdmin';
import { AccountsAdmin } from './AccountsAdmin';
import { LessonsAdmin } from './LessonsAdmin';
import { Empty, fullDate, Loading, messageOf, Notice } from './shared';

export function AdminView({ account, resources, lessons, onReload }: { account: Account; resources: Resource[]; lessons: Lesson[]; onReload: () => Promise<void> }) {
  const [tab, setTab] = useState('materials');
  return <main id="main-content" className="admin-main" tabIndex={-1}><header className="admin-heading"><div><p className="eyebrow"><ShieldCheck size={18} aria-hidden="true"/>課程管理</p><h1>把課堂安排好。</h1><p>材料、發布時間與帳戶權限，集中在這裏管理。</p></div><span className="timezone-label">香港時間 · UTC+8</span></header><nav className="admin-tabs" aria-label="管理範圍">{[{id:'materials',label:'材料與發布',icon:<Folders size={20}/>},{id:'accounts',label:'帳戶與權限',icon:<UsersThree size={20}/>},{id:'lessons',label:'課次與日期',icon:<CalendarBlank size={20}/>},{id:'audit',label:'操作記錄',icon:<ClockCounterClockwise size={20}/>}].map(item => <Button key={item.id} appearance={tab === item.id ? 'subtle' : 'transparent'} aria-current={tab === item.id ? 'page' : undefined} icon={item.icon} onClick={() => setTab(item.id)}>{item.label}</Button>)}</nav><div className="admin-content">{tab === 'materials' && <MaterialsAdmin resources={resources} lessons={lessons} onReload={onReload}/>} {tab === 'accounts' && <AccountsAdmin currentAccount={account} onReload={onReload}/>} {tab === 'lessons' && <LessonsAdmin lessons={lessons} onReload={onReload}/>} {tab === 'audit' && <AuditLog/>}</div></main>;
}

function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(50);
  const generation = useRef(0);
  const load = useCallback(async () => { const request = ++generation.current; try { const result = await service.audit(); if (request === generation.current) { setEntries(result); setError(''); } } catch (err) { if (request === generation.current) setError(messageOf(err)); } finally { if (request === generation.current) setLoading(false); } }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 60_000); const focus = () => void load(); window.addEventListener('focus', focus); return () => { generation.current++; window.clearInterval(timer); window.removeEventListener('focus', focus); }; }, [load]);
  const filtered = entries.filter(entry => `${entry.actor_name} ${entry.action} ${entry.target_label} ${entry.detail}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section aria-labelledby="audit-title"><div className="section-heading admin-section-heading"><div><h2 id="audit-title">操作記錄</h2><p>查閱教材、課次及帳戶設定的最近變更。</p></div><Button icon={<ArrowClockwise size={18}/>} onClick={() => void load()}>重新整理</Button></div>{error && <Notice kind="error">{error}</Notice>}<div className="audit-search"><Field label="搜尋操作記錄"><Input contentBefore={<MagnifyingGlass size={18} aria-hidden="true"/>} value={search} type="search" onChange={(_, data) => { setSearch(data.value); setLimit(50); }} placeholder="操作人員、材料或操作內容"/></Field></div>{loading ? <Loading label="正在讀取操作記錄…"/> : <><div className="result-meta" role="status">目前載入的記錄中，找到 {filtered.length} 筆<span>最新記錄在前 · 香港時間</span></div>{filtered.length ? <><div className="admin-table-scroll" tabIndex={0} role="region" aria-label="操作記錄，可左右捲動"><table className="admin-table audit-table"><thead><tr><th scope="col">時間／人員</th><th scope="col">操作</th><th scope="col">對象／內容</th></tr></thead><tbody>{filtered.slice(0, limit).map(entry => <tr key={entry.id}><td><time dateTime={entry.created_at}>{fullDate(entry.created_at)}</time><small>{entry.actor_name}</small></td><td>{entry.action}</td><td><strong>{entry.target_label}</strong><small>{entry.detail}</small></td></tr>)}</tbody></table></div>{filtered.length > limit && <div className="load-more"><Button onClick={() => setLimit(value => value + 50)}>再顯示 50 筆記錄</Button></div>}</> : <Empty title="暫時沒有符合的操作記錄">材料、課次及帳戶設定更新後，記錄會顯示在這裏。</Empty>}</>}</section>;
}
