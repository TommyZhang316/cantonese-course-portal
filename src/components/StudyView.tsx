import { useMemo, useState } from 'react';
import { Button, Field, Input, Select } from '@fluentui/react-components';
import { ArrowRight, BookOpen, CalendarBlank, MagnifyingGlass, MapPin, Folders, ChalkboardTeacher, ArrowLeft, Clock, Check } from '@phosphor-icons/react';
import type { Account, Category, Lesson, Resource } from '../types';
import { service } from '../lib/service';
import { categories, Empty, formatDate, Notice, messageOf, portalNow, ResourceRow } from './shared';

type Selection = 'overview' | 'all' | 'shared' | number;
export function StudyView({ account, lessons, resources }: { account: Account; lessons: Lesson[]; resources: Resource[] }) {
  const [selected, setSelected] = useState<Selection>('overview');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState('');
  const [limit, setLimit] = useState(15);
  const teacher = account.role !== 'student';
  const available = useMemo(() => resources.filter(resource => !resource.archived_at), [resources]);
  const lesson = lessons.find(item => item.id === selected);
  const nextLesson = lessons.find(item => item.starts_at && new Date(item.starts_at).getTime() >= portalNow()) ?? lessons.find(item => !item.starts_at) ?? lessons.at(-1);
  const filtered = useMemo(() => available.filter(resource => {
    const inLesson = selected === 'all' || selected === 'overview' || (selected === 'shared' ? resource.lesson_id === null : resource.lesson_id === selected);
    const inCategory = category === 'all' || resource.category === category;
    const term = search.trim().toLocaleLowerCase();
    const inSearch = !term || `${resource.title} ${resource.description} ${resource.file_name}`.toLocaleLowerCase().includes(term);
    return inLesson && inCategory && inSearch;
  }), [available, selected, category, search]);
  function choose(value: Selection) { setSelected(value); setSearch(''); setCategory('all'); setLimit(15); setError(''); setDownloaded(''); }
  async function download(resource: Resource) {
    setBusy(previous => new Set(previous).add(resource.id)); setError(''); setDownloaded('');
    try { await service.download(resource); setDownloaded(`已準備「${resource.title}」，請查看瀏覽器下載記錄。`); } catch (err) { setError(messageOf(err)); } finally { setBusy(previous => { const next = new Set(previous); next.delete(resource.id); return next; }); }
  }
  const rows = (items: Resource[]) => items.map(resource => <ResourceRow key={resource.id} resource={resource} teacher={teacher} downloading={busy.has(resource.id)} onDownload={() => void download(resource)}/>);
  return <div className="study-layout">
    <aside className="course-sidebar" aria-label="課程導覽"><div className="sidebar-course"><span className="eyebrow">由聽懂，到開口講</span><strong>我們的粵語課堂</strong><span>{lessons.length} 課 · 課程材料</span></div><nav className="course-navigation" aria-label="材料範圍"><button className={`sidebar-link ${selected === 'overview' ? 'is-selected' : ''}`} onClick={() => choose('overview')} aria-current={selected === 'overview' ? 'page' : undefined}><BookOpen size={21} aria-hidden="true"/>課程總覽</button><button className={`sidebar-link ${selected === 'all' ? 'is-selected' : ''}`} onClick={() => choose('all')} aria-current={selected === 'all' ? 'page' : undefined}><Folders size={21} aria-hidden="true"/>全部材料<span className="nav-count">{available.length}</span></button><div className="sidebar-label">每課學習</div>{lessons.map((item, index) => <button key={item.id} className={`lesson-nav ${selected === item.id ? 'is-selected' : ''}`} aria-current={selected === item.id ? 'page' : undefined} onClick={() => choose(item.id)}><span className="lesson-nav-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{formatDate(item.starts_at, false)}</small></span></button>)}<button className={`sidebar-link shared-nav ${selected === 'shared' ? 'is-selected' : ''}`} onClick={() => choose('shared')} aria-current={selected === 'shared' ? 'page' : undefined}><Folders size={21} aria-hidden="true"/>共用資料</button></nav><div className="sidebar-note"><Clock size={18} aria-hidden="true"/><span>所有日期及發布時間<br/>均為香港時間（UTC+8）。</span></div></aside>
    <main id="main-content" className="study-main" tabIndex={-1}>
      {teacher && <div className="teacher-strip"><ChalkboardTeacher size={20} aria-hidden="true"/><span>教職員閱覽：可直接使用所有未封存材料；標籤顯示學生的發布狀態。</span></div>}
      {error && <Notice kind="error">{error}</Notice>}{downloaded && <Notice kind="success">{downloaded}</Notice>}
      {selected === 'overview' ? <>
        <header className="study-intro"><div><p className="eyebrow">你好，{account.display_name || '同學'}</p><h1>每一課，都多講一句。</h1><p>課堂上放膽試，課堂後慢慢練。你的學習材料，都放在這裏。</p></div><div className="course-stamp" aria-hidden="true"><span>粵語</span><small>jyut6 jyu5</small></div></header>
        {nextLesson && <section className="next-class" aria-labelledby="next-class-title"><div className="next-class-copy"><div className="eyebrow">{nextLesson.starts_at && new Date(nextLesson.starts_at).getTime() >= portalNow() ? '下一次，我們一起學' : nextLesson.starts_at ? '繼續溫習' : '接下來的學習'}</div><h2 id="next-class-title">{nextLesson.title}</h2><p>{nextLesson.summary}</p><div className="class-meta"><span><CalendarBlank size={18} aria-hidden="true"/>{formatDate(nextLesson.starts_at)}</span>{nextLesson.location && <span><MapPin size={18} aria-hidden="true"/>{nextLesson.location}</span>}</div><Button appearance="primary" icon={<ArrowRight size={18}/>} iconPosition="after" onClick={() => choose(nextLesson.id)}>查看本課材料</Button></div><div className="next-class-art"><img src={`${import.meta.env.BASE_URL}portal-classroom.webp`} srcSet={`${import.meta.env.BASE_URL}portal-classroom-small.webp 640w, ${import.meta.env.BASE_URL}portal-classroom-medium.webp 960w, ${import.meta.env.BASE_URL}portal-classroom.webp 1536w`} sizes="(max-width: 760px) 100vw, 50vw" width="1200" height="800" alt=""/></div></section>}
        <section aria-labelledby="journey-title" className="journey-section"><div className="section-heading"><div><p className="eyebrow">一步一步，學識開口</p><h2 id="journey-title">你的學習旅程</h2></div><span className="section-count">共 {lessons.length} 課</span></div><div className="lesson-grid">{lessons.map((item, index) => { const count = available.filter(resource => resource.lesson_id === item.id).length; const past = item.ends_at && new Date(item.ends_at).getTime() < portalNow(); return <button className="lesson-card" key={item.id} onClick={() => choose(item.id)}><div className="lesson-card-top"><span className="lesson-card-number">{String(index + 1).padStart(2, '0')}</span><span className="lesson-card-date">{formatDate(item.starts_at, false)}</span></div><h3>{item.title}</h3><p>{item.summary}</p><div className="lesson-card-bottom"><span>{past && <Check size={15} aria-hidden="true"/>}{count ? `${count} 份${teacher ? '課程' : '已開放'}材料` : '材料尚未開放'}</span><ArrowRight size={20} aria-hidden="true"/></div></button>; })}</div></section>
        <section aria-labelledby="shared-title" className="shared-section"><div className="section-heading"><div><p className="eyebrow">上課前，先看這裏</p><h2 id="shared-title">共用資料</h2></div></div>{available.some(resource => resource.lesson_id === null) ? <div className="resources-list">{rows(available.filter(resource => resource.lesson_id === null))}</div> : <Empty title="共用資料將在這裏出現">管理員開放資料後，這裏會自動更新。</Empty>}</section>
      </> : <>
        <Button appearance="transparent" className="back-link" icon={<ArrowLeft size={17}/>} onClick={() => choose('overview')}>課程總覽</Button><header className="materials-heading"><p className="eyebrow">{lesson ? `第 ${lessons.findIndex(item => item.id === lesson.id) + 1} 課` : selected === 'shared' ? '課堂前後，都用得上' : '按自己的步伐溫習'}</p><h1>{lesson?.title ?? (selected === 'shared' ? '共用資料' : '全部課程材料')}</h1><p>{lesson?.summary ?? (selected === 'shared' ? '課程指南、學習方法與共用練習。' : '搜尋筆記、演示文檔、活動及評核材料。')}</p>{lesson && <div className="class-meta"><span><CalendarBlank size={18} aria-hidden="true"/>{formatDate(lesson.starts_at)}</span>{lesson.location && <span><MapPin size={18} aria-hidden="true"/>{lesson.location}</span>}</div>}</header>
        <div className="material-filters"><Field label="搜尋材料"><Input contentBefore={<MagnifyingGlass size={20} aria-hidden="true"/>} value={search} onChange={(_, data) => { setSearch(data.value); setLimit(15); }} placeholder="輸入材料名稱或關鍵字" type="search"/></Field><Field label="材料類型"><Select value={category} onChange={(_, data) => { setCategory(data.value as typeof category); setLimit(15); }}><option value="all">全部類型</option>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field></div>
        <div className="result-meta" role="status">找到 {filtered.length} 份材料{!teacher && <span>只列出已向你開放的資料</span>}</div>
        {filtered.length ? <><div className="resources-list">{rows(filtered.slice(0, limit))}</div>{filtered.length > limit && <div className="load-more"><Button onClick={() => setLimit(value => value + 15)}>再顯示 15 份材料</Button></div>}</> : <Empty title={search || category !== 'all' ? '暫時找不到符合的材料' : '材料準備好後，會在這裏見面'}>{search || category !== 'all' ? '試試其他關鍵字，或把材料類型改為「全部類型」。' : '老師會按課程安排開放資料。你可以先查看其他課次或共用資料。'}</Empty>}
      </>}
    </main>
  </div>;
}
