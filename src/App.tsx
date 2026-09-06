import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Field, FluentProvider, Select, webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components';
import { BookOpen, GearSix, SignOut, Sun, Moon, Desktop, ArrowClockwise, HourglassMedium, LockKey, WarningCircle } from '@phosphor-icons/react';
import { service } from './lib/service';
import type { Account, Lesson, Resource, Role } from './types';
import { AuthView } from './components/AuthView';
import { StudyView } from './components/StudyView';
const AdminView = lazy(() => import('./components/AdminView').then(module => ({ default: module.AdminView })));
import { Loading, messageOf, Notice, roleLabels } from './components/shared';
import './styles.css';

type Appearance = 'system' | 'light' | 'dark';
const lightTheme: Theme = { ...webLightTheme, colorBrandBackground: '#176456', colorBrandBackgroundHover: '#125346', colorBrandBackgroundPressed: '#0d4339', colorBrandForeground1: '#176456', colorBrandForeground2: '#125346', colorBrandForegroundLink: '#176456', colorBrandForegroundLinkHover: '#125346', colorBrandStroke1: '#176456', colorCompoundBrandBackground: '#176456', colorCompoundBrandBackgroundHover: '#125346', colorCompoundBrandBackgroundPressed: '#0d4339', colorCompoundBrandForeground1: '#176456', colorCompoundBrandStroke: '#176456', colorCompoundBrandStrokeHover: '#125346', colorCompoundBrandStrokePressed: '#0d4339', colorNeutralForeground2BrandHover: '#176456', colorNeutralForeground2BrandPressed: '#125346', colorNeutralForeground2BrandSelected: '#176456', colorNeutralBackground1: '#fdfcf9', colorNeutralForeground1: '#193e45', colorNeutralForeground2: '#435958', colorNeutralForeground3: '#566b67', fontFamilyBase: '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif' };
const darkTheme: Theme = { ...webDarkTheme, colorBrandBackground: '#8dccb6', colorBrandBackgroundHover: '#adddca', colorBrandBackgroundPressed: '#70b9a1', colorNeutralForegroundOnBrand: '#112c27', colorBrandForeground1: '#9bd8c2', colorBrandForeground2: '#9bd8c2', colorBrandForegroundLink: '#9bd8c2', colorBrandForegroundLinkHover: '#c0e9d9', colorBrandStroke1: '#8dccb6', colorCompoundBrandBackground: '#8dccb6', colorCompoundBrandBackgroundHover: '#adddca', colorCompoundBrandBackgroundPressed: '#70b9a1', colorCompoundBrandForeground1: '#9bd8c2', colorCompoundBrandStroke: '#8dccb6', colorCompoundBrandStrokeHover: '#adddca', colorCompoundBrandStrokePressed: '#70b9a1', colorNeutralForeground2BrandHover: '#9bd8c2', colorNeutralForeground2BrandPressed: '#c0e9d9', colorNeutralForeground2BrandSelected: '#9bd8c2', colorNeutralBackground1: '#1c2d2a', colorNeutralForeground1: '#edf2eb', colorNeutralForeground2: '#c2d0c7', colorNeutralForeground3: '#b5c5bc', fontFamilyBase: '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif' };

export default function App() {
  const [appearance, setAppearance] = useState<Appearance>(() => { try { const saved = localStorage.getItem('course-appearance'); return saved === 'light' || saved === 'dark' ? saved : 'system'; } catch { return 'system'; } });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [account, setAccount] = useState<Account | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<'study' | 'admin'>('study');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(() => new URLSearchParams(window.location.search).get('recovery') === '1' || new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery');
  const generation = useRef(0);
  const identity = useRef('');
  const theme = appearance === 'system' ? systemDark ? 'dark' : 'light' : appearance;
  const refresh = useCallback(async (clear = false) => {
    const request = ++generation.current;
    if (clear) { setAccount(null); setLessons([]); setResources([]); setLoading(true); identity.current = ''; }
    try {
      const nextAccount = await service.session();
      if (request !== generation.current) return;
      const nextIdentity = nextAccount ? `${nextAccount.id}:${nextAccount.role}:${nextAccount.status}:${nextAccount.must_change_password}` : '';
      if (nextIdentity !== identity.current) { identity.current = nextIdentity; setResources([]); setLessons([]); setPage('study'); setLoading(true); }
      setAccount(nextAccount);
      if (!nextAccount || nextAccount.status !== 'active' || nextAccount.must_change_password) { setResources([]); setLessons([]); setError(''); return; }
      const [nextLessons, nextResources] = await Promise.all([service.lessons(), service.resources()]);
      if (request !== generation.current) return;
      setLessons([...nextLessons].sort((a, b) => a.sort_order - b.sort_order)); setResources(nextResources); setError('');
    } catch (err) { if (request === generation.current) { setError(messageOf(err)); setResources([]); setLessons([]); } } finally { if (request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const unsubscribe = service.onAuthChange(() => { void refresh(true); });
    const onFocus = () => void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    window.addEventListener('focus', onFocus);
    return () => { generation.current++; unsubscribe(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh]);
  useEffect(() => { const query = window.matchMedia('(prefers-color-scheme: dark)'); const update = () => setSystemDark(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; try { localStorage.setItem('course-appearance', appearance); } catch { /* Appearance is still usable when storage is unavailable. */ } }, [appearance, theme]);
  async function signOut() { setBusy(true); setError(''); try { await service.signOut(); await refresh(true); } catch (err) { setError(messageOf(err)); } finally { setBusy(false); } }
  async function preview(role: Role) { if (!service.demo || !service.previewAs) return; setBusy(true); try { await service.previewAs(role); await refresh(true); } catch (err) { setError(messageOf(err)); } finally { setBusy(false); } }
  const onAuthComplete = () => { setRecovery(false); void refresh(); };
  return <FluentProvider theme={theme === 'dark' ? darkTheme : lightTheme} className="portal-app" dir="ltr"><a className="skip-link" href="#main-content">跳到主要內容</a>
    {service.demo && <div className="demo-banner"><span><WarningCircle size={19} aria-hidden="true"/><strong>本機功能示範</strong>資料及下載檔案為示範內容，不是正式帳戶。示範時間：10 月 2 日 19:00。</span>{service.previewAs && <Field label="示範角色" orientation="horizontal"><Select aria-label="示範角色" value={account?.role ?? ''} onChange={(_, data) => void preview(data.value as Role)} disabled={busy}><option value="" disabled>選擇角色</option><option value="student">學生</option><option value="teacher">老師</option><option value="admin">管理員</option></Select></Field>}</div>}
    <header className="site-header"><div className="header-inner"><a href={import.meta.env.BASE_URL} className="brand" aria-label="公益粵語課堂首頁" onClick={event => { if (account && !recovery) { event.preventDefault(); setPage('study'); } }}><span className="brand-mark" aria-hidden="true">粵</span><span><strong>公益粵語課堂</strong><small>一齊學，一齊講。</small></span></a><div className="header-actions">{account && account.status === 'active' && !account.must_change_password && !recovery && <nav className="top-navigation" aria-label="主要導覽"><Button appearance={page === 'study' ? 'subtle' : 'transparent'} icon={<BookOpen size={19}/>} aria-current={page === 'study' ? 'page' : undefined} onClick={() => setPage('study')}>課程材料</Button>{account.role === 'admin' && <Button appearance={page === 'admin' ? 'subtle' : 'transparent'} icon={<GearSix size={19}/>} aria-current={page === 'admin' ? 'page' : undefined} onClick={() => setPage('admin')}>管理後臺</Button>}</nav>}<div className="theme-control"><label htmlFor="appearance" className="sr-only">顯示模式</label><Select id="appearance" value={appearance} icon={theme === 'dark' ? <Moon size={17}/> : appearance === 'system' ? <Desktop size={17}/> : <Sun size={17}/>} onChange={(_, data) => setAppearance(data.value as Appearance)} aria-label="顯示模式"><option value="system">跟隨系統</option><option value="light">淺色模式</option><option value="dark">深色模式</option></Select></div>{account && !recovery && <><div className="account-chip"><span className="account-initial" aria-hidden="true">{(account.display_name || account.email).slice(0, 1)}</span><span><strong>{account.display_name || '我的帳戶'}</strong><small>{roleLabels[account.role]}</small></span></div><Button appearance="transparent" icon={<SignOut size={20}/>} aria-label="登出帳戶" title="登出帳戶" onClick={() => void signOut()} disabled={busy}/></>}</div></div></header>
    {loading ? <main id="main-content" className="page-loading" tabIndex={-1}><Loading/></main> : recovery ? <AuthView onComplete={onAuthComplete} recovery/> : !account ? <>{error && <div className="global-notice"><Notice kind="error">{error}</Notice></div>}<AuthView onComplete={onAuthComplete}/></> : account.status !== 'active' ? <main id="main-content" className="account-wait-page" tabIndex={-1}><div className="account-wait-icon">{account.status === 'pending' ? <HourglassMedium size={40} weight="light"/> : <LockKey size={40} weight="light"/>}</div><p className="eyebrow">{account.display_name || '你好'}</p><h1>{account.status === 'pending' ? '你的學習位置，正在準備。' : '此帳戶目前已停用。'}</h1><p>{account.status === 'pending' ? '課程管理員尚未啟用此帳戶。請聯絡管理員確認使用安排。' : '請聯絡課程管理員，確認帳戶的使用安排。'}</p><div className="wait-email">{account.username ?? account.email}</div>{error && <Notice kind="error">{error}</Notice>}<Button appearance="primary" icon={<ArrowClockwise size={18}/>} onClick={() => void refresh()}>重新檢查狀態</Button><p className="form-helper">此頁亦會每分鐘自動更新。</p></main> : account.must_change_password ? <AuthView key={`password:${account.id}`} onComplete={onAuthComplete} requiredPasswordChange={account}/> : error ? <main id="main-content" className="page-loading" tabIndex={-1}><Notice kind="error" title="未能讀取課程資料">{error}</Notice><Button appearance="primary" onClick={() => void refresh()} icon={<ArrowClockwise size={18}/>}>重新讀取</Button></main> : page === 'admin' && account.role === 'admin' ? <Suspense fallback={<main id="main-content" className="page-loading" tabIndex={-1}><Loading label="正在開啟管理後臺…"/></main>}><AdminView key={`${account.id}:${account.role}`} account={account} resources={resources} lessons={lessons} onReload={() => refresh()}/></Suspense> : <StudyView key={`${account.id}:${account.role}`} account={account} lessons={lessons} resources={resources}/>}
    <footer className="site-footer"><div><span>公益粵語課堂</span><span>一個讓大家安心開口的課堂。</span></div><span>日期與時間以香港時間為準</span></footer>
  </FluentProvider>;
}
