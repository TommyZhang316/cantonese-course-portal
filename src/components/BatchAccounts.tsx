import { useRef, useState } from 'react';
import { Button, Field, Input, ProgressBar, Textarea } from '@fluentui/react-components';
import { ArrowClockwise, DownloadSimple, FileArrowUp, Trash, UserPlus } from '@phosphor-icons/react';
import { service } from '../lib/service';
import { buildUsernamePreview, credentialsCsv, MAX_ACCOUNT_BATCH, normalizeUsername, parseNameInput, usernameError } from '../lib/usernames';
import type { Account, CreateAccountResult } from '../types';
import { messageOf, Notice } from './shared';

interface PreviewRow {
  key: number;
  name: string;
  username: string;
  suffixed: boolean;
  status: 'draft' | CreateAccountResult['status'];
  message?: string;
}

export function BatchAccounts({ accounts, unavailable, onCreated }: { accounts: Account[]; unavailable: boolean; onCreated: () => Promise<void> }) {
  const [source, setSource] = useState('');
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [fileName, setFileName] = useState('');
  const [exported, setExported] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const knownUsernames = new Set(accounts.flatMap(account => account.username ? [normalizeUsername(account.username)] : []));
  const counts = new Map<string, number>();
  rows.forEach(row => counts.set(row.username, (counts.get(row.username) ?? 0) + 1));
  const problemFor = (row: PreviewRow): string => {
    if (row.status === 'created') return '';
    const invalid = usernameError(row.username);
    if (invalid) return invalid;
    if ((counts.get(row.username) ?? 0) > 1) return '這一批有相同帳戶名稱，請修改其中一個。';
    if (knownUsernames.has(row.username) || row.status === 'existing') return '帳戶已存在，本次會略過；現有密碼及權限保持不變。';
    return '';
  };
  const ready = rows.filter(row => row.status !== 'created' && !problemFor(row));
  const created = rows.filter(row => row.status === 'created');
  const remaining = rows.filter(row => row.status !== 'created');

  function preview() {
    try {
      const inputs = parseNameInput(source);
      const next = buildUsernamePreview(inputs, [...knownUsernames]);
      setRows(next.map((row, key) => ({ ...row, key, status: 'draft' })));
      setError(''); setAttempted(false); setExported(false);
    } catch (err) { setError(messageOf(err)); }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error('名單檔案太大，請用 UTF-8 CSV，每次最多 50 位同學。');
      const content = await file.text();
      if (content.includes('\uFFFD')) throw new Error('檔案編碼無法讀取，請在 Excel 另存為「CSV UTF-8」，或直接貼上姓名。');
      parseNameInput(content);
      setSource(content); setFileName(file.name); setError('');
    } catch (err) { setError(messageOf(err)); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }

  async function create() {
    if (busyRef.current || !ready.length || unavailable) return;
    busyRef.current = true; setBusy(true); setError(''); setAttempted(true);
    const submitted = ready.map(({ name, username }) => ({ name, username }));
    try {
      const results = await service.createAccounts(submitted);
      if (results.some(result => result.status === 'created')) setExported(false);
      const resultMap = new Map(results.map(result => [result.username, result]));
      const submittedNames = new Set(submitted.map(row => row.username));
      setRows(current => current.map(row => {
        if (!submittedNames.has(row.username) || row.status === 'created') return row;
        const result = resultMap.get(row.username);
        return result ? { ...row, status: result.status, message: result.message } : { ...row, status: 'error', message: '未收到這個帳戶的結果；重新整理後可重試，系統會略過已存在的帳戶。' };
      }));
    } catch (err) {
      const message = messageOf(err);
      const submittedNames = new Set(submitted.map(row => row.username));
      setRows(current => current.map(row => submittedNames.has(row.username) && row.status !== 'created' ? { ...row, status: 'error', message } : row));
      setError('未能確認全部建立結果。可重試未完成項目；系統會略過已存在的帳戶。');
    } finally {
      try { await onCreated(); } catch { setError(current => current || '帳戶清單暫未能重新整理，請稍後按「重新整理」。'); }
      busyRef.current = false; setBusy(false);
    }
  }

  function download() {
    const portalUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;
    const content = credentialsCsv(created, portalUrl);
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url; link.download = `粵語課堂_本批學生帳戶_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(true);
  }

  function reset() {
    setRows([]); setSource(''); setFileName(''); setError(''); setAttempted(false); setExported(false);
  }

  return <section className="batch-accounts" aria-labelledby="batch-accounts-title">
    <div className="batch-accounts-heading"><div><h3 id="batch-accounts-title">批量建立學生帳戶</h3><p>貼上中文姓名，核對拼音，再一次建立。每批最多 {MAX_ACCOUNT_BATCH} 位。</p></div><UserPlus size={26} aria-hidden="true"/></div>
    {!rows.length ? <div className="batch-accounts-input">
      <Field label="同學名單" hint="每行一位，例如：陳小明。亦可貼上含「姓名」及選填「帳戶名稱」欄位的 CSV。">
        <Textarea value={source} resize="vertical" rows={5} placeholder={'陳小明\n呂美玲\n單宇'} onChange={(_, data) => { setSource(data.value); setFileName(''); }} disabled={busy}/>
      </Field>
      <div className="batch-accounts-actions"><input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden aria-label="匯入同學名單" onChange={event => void importFile(event.currentTarget.files?.[0])}/><Button icon={<FileArrowUp size={18}/>} disabled={busy} onClick={() => fileInput.current?.click()}>匯入 CSV</Button><Button appearance="primary" disabled={busy || unavailable || !source.trim()} onClick={preview}>產生帳戶預覽</Button>{fileName && <span className="form-helper">已讀取：{fileName}</span>}</div>
    </div> : <>
      <Notice>帳戶名稱採姓名的普通話全拼音大寫，ü 寫成 V。姓名讀音可能因人而異，請核對每一行並直接修改；同批重名會加 02、03。初始密碼與帳戶名稱相同，學生首次登入必須改密碼，之後才可閱讀材料。</Notice>
      <div className="batch-accounts-summary" role="status"><strong>{rows.length} 位同學</strong><span>{created.length ? `已建立 ${created.length} 個` : `可建立 ${ready.length} 個`}</span>{rows.some(row => problemFor(row)) && <span>有項目待修改或略過</span>}</div>
      <div className="batch-accounts-preview" tabIndex={0} role="region" aria-label="學生帳戶預覽，可上下捲動" aria-busy={busy}><ol className="batch-accounts-rows">{rows.map((row, index) => {
        const problem = problemFor(row);
        const errorMessage = problem || (row.status === 'error' ? row.message : '');
        const existing = row.status !== 'created' && (row.status === 'existing' || knownUsernames.has(row.username));
        return <li key={row.key} className="batch-accounts-row">
          <div className="batch-accounts-name"><span className="batch-accounts-number">{String(index + 1).padStart(2, '0')}</span><strong>{row.name}</strong>{row.suffixed && <small>同批重名，已加序號</small>}</div>
          <Field label="帳戶名稱" validationState={errorMessage ? 'error' : 'none'} validationMessage={errorMessage}><Input aria-label={`${index + 1}. ${row.name} 的帳戶名稱`} value={row.username} disabled={busy || row.status === 'created'} spellCheck={false} autoCapitalize="characters" onChange={(_, data) => setRows(current => current.map(item => item.key === row.key ? { ...item, username: normalizeUsername(data.value), status: 'draft', message: undefined } : item))}/></Field>
          <div className="batch-accounts-password"><span>初始密碼</span><code>{existing ? '不更改' : row.username || '待填寫'}</code><small>{row.status === 'created' ? '已建立 · 首次登入需改密碼' : existing ? '略過現有帳戶' : row.status === 'error' ? '尚未完成' : '建立後立即啟用'}</small></div>
          {row.status !== 'created' ? <Button appearance="subtle" icon={<Trash size={18}/>} disabled={busy} aria-label={`移除第 ${index + 1} 行 ${row.name}`} onClick={() => setRows(current => current.filter(item => item.key !== row.key))}/> : <span className="batch-accounts-created">已建立</span>}
        </li>;
      })}</ol></div>
      {busy && <div className="batch-accounts-progress" role="status"><p>正在建立帳戶，完成後會逐項顯示結果…</p><ProgressBar aria-label="正在建立學生帳戶"/></div>}
      {!busy && created.length > 0 && <div className="batch-accounts-export"><Notice kind="success">已建立 {created.length} 個學生帳戶。請下載本批帳戶表，按同學逐一派發；CSV 只包含這次確認建立成功的帳戶。離開此頁後，本批結果便會清除。</Notice><Button icon={<DownloadSimple size={18}/>} onClick={download}>下載本批 {created.length} 個帳戶（CSV）</Button>{exported && <span className="form-helper" role="status">已準備下載，請確認檔案已儲存。</span>}</div>}
      <div className="batch-accounts-actions"><Button disabled={busy || (created.length > 0 && !exported)} onClick={reset}>{created.length ? '開始新一批' : '重新貼上名單'}</Button>{ready.length > 0 && <Button appearance="primary" icon={attempted ? <ArrowClockwise size={18}/> : <UserPlus size={18}/>} disabled={busy || unavailable} onClick={() => void create()}>{busy ? '正在建立…' : attempted ? `重試 ${ready.length} 個未完成帳戶` : `建立 ${ready.length} 個學生帳戶`}</Button>}{!busy && remaining.length > 0 && ready.length === 0 && <span className="form-helper">請修改有問題的帳戶名稱，或移除已存在的項目。</span>}</div>
    </>}
    {error && <Notice kind="error">{error}</Notice>}
  </section>;
}
