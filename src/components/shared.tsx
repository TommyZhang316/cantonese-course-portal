import type { ReactNode } from 'react';
import { Button } from '@fluentui/react-components';
import { WarningCircle, CheckCircle, Info, BookOpen, FileText, Presentation, GameController, PuzzlePiece, Exam, DownloadSimple } from '@phosphor-icons/react';
import type { Category, Resource, Role } from '../types';
import { service } from '../lib/service';

export function portalNow() { return service.demo ? new Date('2026-10-02T11:00:00Z').getTime() : Date.now(); }

export const roleLabels: Record<Role, string> = { student: '學生', teacher: '老師', admin: '管理員' };
export const categoryLabels: Record<Category, string> = { notes: '課堂筆記', slides: '演示文檔', activity: '互動活動', game: '課堂遊戲', exam: '評核材料', guide: '課程指南', other: '其他資料' };
export const categories = Object.entries(categoryLabels) as [Category, string][];
export function messageOf(error: unknown) { return error instanceof Error ? error.message : '操作未能完成，請稍後再試。'; }
export function formatDate(value: string | null | undefined, time = true) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '日期待安排';
  return new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', month: 'long', day: 'numeric', weekday: 'short', ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(new Date(value));
}
export function fullDate(value: string | null | undefined) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '未設定';
  return new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
/** HTML datetime-local values always represent Hong Kong wall time, not the browser's timezone. */
export function toHKInput(value: string | null | undefined) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '';
  return new Date(new Date(value).getTime() + 8 * 3600_000).toISOString().slice(0, 16);
}
export function fromHKInput(value: string): string | null {
  if (!value) return null;
  const result = new Date(value + ':00+08:00');
  if (Number.isNaN(result.getTime())) throw new Error('請輸入有效的日期與時間。');
  return result.toISOString();
}
export function suggestedRelease(start: string | null | undefined): string {
  if (!start) return '';
  const hk = toHKInput(start).slice(0, 10);
  if (!hk) return '';
  const date = new Date(hk + 'T09:00:00+08:00');
  date.setTime(date.getTime() - 7 * 24 * 3600_000);
  return toHKInput(date.toISOString());
}
export function fileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
export function policyLabel(resource: Resource) {
  if (resource.archived_at) return '已封存';
  if (resource.student_policy === 'never') return '僅教職員';
  if (resource.student_policy === 'immediate') return '學生可見';
  if (!resource.release_at) return '發布時間未設定';
  return new Date(resource.release_at).getTime() <= portalNow() ? '學生可見' : '定時發布';
}
export function Notice({ kind = 'info', children, title }: { kind?: 'error' | 'success' | 'info'; children: ReactNode; title?: string }) {
  const Icon = kind === 'error' ? WarningCircle : kind === 'success' ? CheckCircle : Info;
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}><Icon size={22} aria-hidden="true" /><div>{title && <strong>{title}</strong>}<div>{children}</div></div></div>;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><BookOpen size={38} weight="light" aria-hidden="true" /><h3>{title}</h3><p>{children}</p></div>;
}
export function Loading({ label = '正在讀取課程材料…' }: { label?: string }) {
  return <div className="loading-state" role="status" aria-label={label}><span className="sr-only">{label}</span><div className="skeleton skeleton-heading"/><div className="skeleton skeleton-line"/><div className="skeleton-grid">{[1, 2, 3, 4].map(item => <div key={item} className="skeleton skeleton-card"/>)}</div></div>;
}
export function ResourceIcon({ category }: { category: Category }) {
  const Icon = { notes: FileText, slides: Presentation, activity: PuzzlePiece, game: GameController, exam: Exam, guide: BookOpen, other: FileText }[category];
  return <Icon size={25} weight="regular" aria-hidden="true"/>;
}
export function ResourceRow({ resource, teacher, downloading, onDownload }: { resource: Resource; teacher: boolean; downloading: boolean; onDownload: () => void }) {
  const extension = resource.file_name.split('.').at(-1)?.toUpperCase() ?? 'FILE';
  return <article className="resource-row"><div className="resource-type"><ResourceIcon category={resource.category}/></div><div className="resource-copy"><div className="resource-eyebrow">{categoryLabels[resource.category]}<span aria-hidden="true">·</span>{extension}<span aria-hidden="true">·</span>{fileSize(resource.file_size)}</div><h3>{resource.title}</h3>{resource.description && <p>{resource.description}</p>}{teacher && <div className="resource-policy"><span className={`status-tag ${resource.student_policy === 'never' ? 'staff-tag' : ''}`}>{policyLabel(resource)}</span>{resource.student_policy === 'scheduled' && resource.release_at && <span>{fullDate(resource.release_at)} 香港時間</span>}</div>}</div><Button className="download-button" icon={<DownloadSimple size={19}/>} disabled={downloading} onClick={onDownload} aria-label={`下載 ${resource.title}`}>{downloading ? '準備中' : '下載'}</Button></article>;
}
