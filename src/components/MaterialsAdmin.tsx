import { useId, useState, type FormEvent } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, Textarea, useRestoreFocusTarget } from '@fluentui/react-components';
import { Plus, PencilSimple, Archive, ArrowCounterClockwise, MagnifyingGlass, X, UploadSimple, CalendarBlank } from '@phosphor-icons/react';
import { service } from '../lib/service';
import type { Category, Lesson, Resource, ResourceInput, StudentPolicy } from '../types';
import { categories, categoryLabels, Empty, fromHKInput, fullDate, messageOf, Notice, policyLabel, suggestedRelease, toHKInput } from './shared';

export function MaterialsAdmin({ resources, lessons, onReload }: { resources: Resource[]; lessons: Lesson[]; onReload: () => Promise<void> }) {
  const restoreFocusTarget = useRestoreFocusTarget();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('active');
  const [lessonFilter, setLessonFilter] = useState('all');
  const [editor, setEditor] = useState<Resource | 'new' | null>(null);
  const [archive, setArchive] = useState<Resource | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const filtered = resources.filter(item => (scope === 'all' || (scope === 'archived' ? !!item.archived_at : !item.archived_at)) && (lessonFilter === 'all' || (lessonFilter === 'shared' ? item.lesson_id === null : item.lesson_id === Number(lessonFilter))) && `${item.title} ${item.file_name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  async function doArchive() {
    if (!archive) return;
    setBusy(true); setError('');
    try { await service.archiveResource(archive, !archive.archived_at); setSuccess(`已${archive.archived_at ? '恢復' : '封存'}「${archive.title}」。`); setArchive(null); await onReload(); } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  }
  return <section aria-labelledby="materials-admin-title"><div className="section-heading admin-section-heading"><div><h2 id="materials-admin-title">材料與發布</h2><p>老師即時取用；學生按每份材料的設定閱覽。</p></div><Button {...restoreFocusTarget} appearance="primary" icon={<Plus size={18}/>} onClick={() => { setEditor('new'); setSuccess(''); setError(''); }}>新增材料</Button></div>
    {success && <Notice kind="success">{success}</Notice>}{error && !archive && <Notice kind="error">{error}</Notice>}
    <div className="admin-filter-row"><Field label="搜尋材料"><Input type="search" contentBefore={<MagnifyingGlass size={18} aria-hidden="true"/>} value={search} onChange={(_, data) => setSearch(data.value)} placeholder="材料名稱或檔名"/></Field><Field label="課次"><Select value={lessonFilter} onChange={(_, data) => setLessonFilter(data.value)}><option value="all">全部課次</option><option value="shared">共用資料</option>{lessons.map((lesson, index) => <option key={lesson.id} value={lesson.id}>第 {index + 1} 堂 · {lesson.title}</option>)}</Select></Field><Field label="檔案狀態"><Select value={scope} onChange={(_, data) => setScope(data.value)}><option value="active">使用中</option><option value="archived">已封存</option><option value="all">全部狀態</option></Select></Field></div>
    <div className="result-meta" role="status">共 {filtered.length} 份材料<span>封存可隨時恢復；所有變更會記錄在操作記錄。</span></div>
    {filtered.length ? <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="材料清單，可左右捲動"><table className="admin-table"><thead><tr><th scope="col">材料</th><th scope="col">課次／類型</th><th scope="col">學生發布</th><th scope="col">操作</th></tr></thead><tbody>{filtered.map(resource => <tr key={resource.id}><td><strong>{resource.title}</strong><small>{resource.file_name}</small></td><td>{resource.lesson_id === null ? '共用資料' : lessons.find(lesson => lesson.id === resource.lesson_id)?.title ?? `第 ${resource.lesson_id} 堂`}<small>{categoryLabels[resource.category]}</small></td><td><span className={`status-tag ${resource.student_policy === 'never' ? 'staff-tag' : ''}`}>{policyLabel(resource)}</span>{resource.student_policy === 'scheduled' && <small>{fullDate(resource.release_at)}<br/>香港時間</small>}</td><td><div className="table-actions"><Button {...restoreFocusTarget} disabled={!!resource.archived_at} size="small" icon={<PencilSimple size={17}/>} onClick={() => { setEditor(resource); setSuccess(''); setError(''); }} aria-label={`編輯 ${resource.title}`}>編輯</Button><Button {...restoreFocusTarget} size="small" appearance="subtle" icon={resource.archived_at ? <ArrowCounterClockwise size={17}/> : <Archive size={17}/>} onClick={() => { setArchive(resource); setError(''); }} aria-label={`${resource.archived_at ? '恢復' : '封存'} ${resource.title}`}>{resource.archived_at ? '恢復' : '封存'}</Button></div></td></tr>)}</tbody></table></div> : <Empty title="這裏暫時沒有材料">調整篩選，或按「新增材料」上傳課程檔案。</Empty>}
    {editor && <ResourceEditor key={editor === 'new' ? 'new' : editor.id} current={editor === 'new' ? undefined : editor} lessons={lessons} onClose={() => setEditor(null)} onSaved={async (title) => { setEditor(null); setSuccess(`已儲存「${title}」。`); await onReload(); }}/>}
    {archive && <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy) setArchive(null); }}><DialogSurface><DialogBody><DialogTitle>{archive?.archived_at ? '恢復這份材料？' : '封存這份材料？'}</DialogTitle><DialogContent><p>「{archive?.title}」</p><p>{archive?.archived_at ? '恢復後，老師可即時取用；學生是否可見，仍按原有發布設定。' : '封存後，老師及學生都不會在材料頁看到此檔案。原檔與設定會保留，管理員可隨時恢復。'}</p>{error && <Notice kind="error">{error}</Notice>}</DialogContent><DialogActions><Button onClick={() => setArchive(null)} disabled={busy}>取消</Button><Button appearance="primary" disabled={busy} onClick={() => void doArchive()}>{busy ? '處理中…' : archive?.archived_at ? '確認恢復' : '確認封存'}</Button></DialogActions></DialogBody></DialogSurface></Dialog>}
  </section>;
}

function ResourceEditor({ current, lessons, onClose, onSaved }: { current?: Resource; lessons: Lesson[]; onClose: () => void; onSaved: (title: string) => Promise<void> }) {
  const fileId = useId();
  const [title, setTitle] = useState(current?.title ?? '');
  const [description, setDescription] = useState(current?.description ?? '');
  const [lessonId, setLessonId] = useState(current?.lesson_id?.toString() ?? 'shared');
  const [category, setCategory] = useState<Category>(current?.category ?? 'notes');
  const [policy, setPolicy] = useState<StudentPolicy>(current?.student_policy ?? 'never');
  const [releaseAt, setReleaseAt] = useState(toHKInput(current?.release_at));
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedLesson = lessons.find(lesson => lesson.id === Number(lessonId));
  const defaultTime = suggestedRelease(selectedLesson?.starts_at);
  function changeLesson(value: string) {
    setLessonId(value);
    if (!current && value !== 'shared') { setPolicy('scheduled'); setReleaseAt(suggestedRelease(lessons.find(lesson => lesson.id === Number(value))?.starts_at)); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!title.trim()) { setError('請填寫材料名稱。'); return; }
    if (!current && !file) { setError('請選擇要上傳的檔案。'); return; }
    if (policy === 'scheduled' && !releaseAt) { setError('請設定學生發布時間，或先選擇「永不向學生發布」。'); return; }
    setBusy(true);
    try { const input: ResourceInput = { title: title.trim(), description: description.trim(), lesson_id: lessonId === 'shared' ? null : Number(lessonId), category, student_policy: policy, release_at: policy === 'scheduled' ? fromHKInput(releaseAt) : null }; await service.saveResource(input, current, file); await onSaved(title.trim()); } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy) onClose(); }}><DialogSurface className="wide-dialog"><form onSubmit={submit}><DialogBody><DialogTitle action={<Button appearance="subtle" icon={<X size={20}/>} aria-label="關閉編輯材料" onClick={onClose} disabled={busy}/>}>{current ? '編輯材料' : '新增材料'}</DialogTitle><DialogContent className="editor-content"><p className="muted">{current ? `材料版本 ${current.version}。不選擇新檔案，便保留現有檔案。` : '新增課程檔案，並設定學生何時可以閱覽。'}</p><div className="stack-form"><Field label="材料名稱" required><Input required value={title} maxLength={200} onChange={(_, data) => setTitle(data.value)} disabled={busy}/></Field><Field label="材料說明"><Textarea value={description} maxLength={2000} resize="vertical" rows={3} onChange={(_, data) => setDescription(data.value)} disabled={busy}/></Field><div className="form-columns"><Field label="所屬課次"><Select value={lessonId} onChange={(_, data) => changeLesson(data.value)} disabled={busy}><option value="shared">共用資料</option>{lessons.map((lesson, index) => <option key={lesson.id} value={lesson.id}>第 {index + 1} 堂 · {lesson.title}</option>)}</Select></Field><Field label="材料類型"><Select value={category} onChange={(_, data) => setCategory(data.value as Category)} disabled={busy}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field></div><Field label={{ children: current ? '替換檔案（可選）' : '上傳檔案', htmlFor: fileId }} required={!current} hint={current ? `目前：${current.file_name}。替換後保留操作記錄。` : '選擇已準備好的 PDF、Word、PPT 或其他課程檔案。'}><input id={fileId} className="file-input" type="file" required={!current} disabled={busy} onChange={event => setFile(event.target.files?.[0])}/></Field><div className="editor-policy"><Field label="向學生發布" required><Select value={policy} onChange={(_, data) => { setPolicy(data.value as StudentPolicy); if (data.value === 'scheduled' && !releaseAt && defaultTime) setReleaseAt(defaultTime); }} disabled={busy}><option value="never">永不向學生發布 · 僅教職員</option><option value="scheduled">按設定時間發布</option><option value="immediate">立即向學生發布</option></Select></Field><p className="form-helper">{policy === 'never' ? '適用於教師答案、評分準則及教師整套檔案。老師與管理員可立即取用。' : policy === 'immediate' ? '儲存後，所有已啟用的學生都可以取用此材料。' : '到達指定時間後自動開放，無需再次登入操作。老師與管理員可提前取用。'}</p>{policy === 'scheduled' && <><Field label="學生發布時間（香港時間 UTC+8）" required><Input type="datetime-local" value={releaseAt} onChange={(_, data) => setReleaseAt(data.value)} required disabled={busy}/></Field>{defaultTime ? <Button size="small" appearance="subtle" icon={<CalendarBlank size={18}/>} onClick={() => setReleaseAt(defaultTime)} disabled={busy}>設為上課前一周上午 9 時</Button> : <p className="form-helper">此課尚未設定上課日期，請自行填寫發布時間。</p>}<p className="form-helper">日後更改上課日期不會覆蓋此處設定，請同時核對材料發布時間。</p></>}</div>{error && <Notice kind="error" title="未能儲存">{error}<p>你填寫的內容仍保留在這裏。如資料已被其他管理員更新，請記下本次修改，再關閉並重新開啟材料核對。</p></Notice>}</div></DialogContent><DialogActions><Button onClick={onClose} disabled={busy}>取消</Button><Button type="submit" appearance="primary" icon={<UploadSimple size={18}/>} disabled={busy}>{busy ? '正在儲存…' : '儲存材料'}</Button></DialogActions></DialogBody></form></DialogSurface></Dialog>;
}
