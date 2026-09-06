import { useState, type FormEvent } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Textarea, useRestoreFocusTarget } from '@fluentui/react-components';
import { PencilSimple, CalendarBlank } from '@phosphor-icons/react';
import { service } from '../lib/service';
import type { Lesson } from '../types';
import { fromHKInput, fullDate, messageOf, Notice, toHKInput } from './shared';

export function LessonsAdmin({ lessons, onReload }: { lessons: Lesson[]; onReload: () => Promise<void> }) {
  const restoreFocusTarget = useRestoreFocusTarget();
  const [editing, setEditing] = useState<Lesson | null>(null);
  const [success, setSuccess] = useState('');
  return <section aria-labelledby="lessons-admin-title"><div className="section-heading admin-section-heading"><div><h2 id="lessons-admin-title">課次與日期</h2><p>設定上課時間及課程介紹，供全班查看。</p></div></div><Notice>新材料可設為上課前一周上午 9 時發布。更改課次日期後，請到「材料與發布」核對已設定的發布時間。</Notice>{success && <Notice kind="success">{success}</Notice>}<div className="lesson-admin-list">{lessons.map((lesson, index) => <article key={lesson.id} className="lesson-admin-row"><span className="lesson-admin-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{lesson.title}</h3><p>{lesson.summary}</p><div className="class-meta"><span><CalendarBlank size={17} aria-hidden="true"/>{fullDate(lesson.starts_at)}{lesson.starts_at && ' 香港時間'}</span><span>{lesson.duration_minutes} 分鐘</span></div></div><Button {...restoreFocusTarget} icon={<PencilSimple size={18}/>} onClick={() => { setEditing(lesson); setSuccess(''); }} aria-label={`編輯第 ${index + 1} 堂`}>編輯</Button></article>)}</div>{editing && <LessonEditor key={editing.id} lesson={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setSuccess('課次資料已更新。請核對相關材料的發布時間。'); await onReload(); }}/>}</section>;
}

function LessonEditor({ lesson, onClose, onSaved }: { lesson: Lesson; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(lesson.title);
  const [summary, setSummary] = useState(lesson.summary);
  const [starts, setStarts] = useState(toHKInput(lesson.starts_at));
  const [duration, setDuration] = useState(String(lesson.duration_minutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!title.trim()) { setError('請填寫課次名稱。'); return; }
    const minutes = Number(duration);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 480) { setError('課堂時長須為 15 至 480 分鐘的整數。'); return; }
    setBusy(true);
    try { const start = fromHKInput(starts); await service.updateLesson(lesson, { title: title.trim(), summary: summary.trim(), starts_at: start, ends_at: start ? new Date(new Date(start).getTime() + minutes * 60_000).toISOString() : '', duration_minutes: minutes, location: lesson.location }); await onSaved(); } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy) onClose(); }}><DialogSurface><form onSubmit={submit}><DialogBody><DialogTitle>編輯課次</DialogTitle><DialogContent className="editor-content"><div className="stack-form"><Field label="課次名稱" required><Input value={title} required maxLength={200} disabled={busy} onChange={(_, data) => setTitle(data.value)}/></Field><Field label="課次介紹"><Textarea rows={4} resize="vertical" maxLength={2000} value={summary} disabled={busy} onChange={(_, data) => setSummary(data.value)}/></Field><Field label="上課日期及時間（香港時間 UTC+8）" hint="留空表示日期待安排。"><Input type="datetime-local" value={starts} disabled={busy} onChange={(_, data) => setStarts(data.value)}/></Field><Field label="課堂時長（分鐘）" required><Input type="number" min={15} max={480} step={1} value={duration} required disabled={busy} onChange={(_, data) => setDuration(data.value)}/></Field>{lesson.location && <Field label="上課地點"><Input readOnly value={lesson.location}/></Field>}<Notice>這項修改不會改動現有材料的發布時間。儲存後，請核對本課的所有定時材料。</Notice>{error && <Notice kind="error">{error}<p>你的修改仍保留在此表單。</p></Notice>}</div></DialogContent><DialogActions><Button onClick={onClose} disabled={busy}>取消</Button><Button type="submit" appearance="primary" disabled={busy}>{busy ? '正在儲存…' : '儲存課次'}</Button></DialogActions></DialogBody></form></DialogSurface></Dialog>;
}
