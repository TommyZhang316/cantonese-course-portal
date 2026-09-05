import { useState, type FormEvent } from 'react';
import { Button, Field, Input } from '@fluentui/react-components';
import { ArrowRight, ArrowLeft, EnvelopeSimple, LockKey, CheckCircle } from '@phosphor-icons/react';
import { service } from '../lib/service';
import { Notice, messageOf } from './shared';

export function AuthView({ onComplete, recovery = false }: { onComplete: () => void; recovery?: boolean }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset' | 'recovery'>(recovery ? 'recovery' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const title = { login: '歡迎返嚟', signup: '一齊開始學粵語', reset: '找回登入密碼', recovery: '設定新密碼' }[mode];
  function changeMode(next: typeof mode) { setMode(next); setError(''); setSuccess(''); setPassword(''); setConfirmation(''); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess('');
    if ((mode === 'signup' || mode === 'recovery') && password !== confirmation) { setError('兩次輸入的密碼不同，請再核對。'); return; }
    setBusy(true);
    try {
      if (mode === 'login') { await service.signIn(email.trim(), password); onComplete(); }
      if (mode === 'signup') { await service.signUp(name.trim(), email.trim(), password); setSuccess('申請已提交。如收到驗證電郵，請先完成驗證；管理員批准後即可使用課程材料。'); setPassword(''); setConfirmation(''); }
      if (mode === 'reset') { await service.requestPasswordReset(email.trim()); setSuccess('如果此電郵已登記，我們會發送重設密碼連結。請同時檢查垃圾郵件。'); }
      if (mode === 'recovery') { await service.updatePassword(password); const url = new URL(window.location.href); url.searchParams.delete('recovery'); url.hash = ''; window.history.replaceState({}, '', url); onComplete(); }
    } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  }
  return <main id="main-content" className="auth-layout" tabIndex={-1}>
    <section className="auth-story" aria-labelledby="course-welcome"><div className="eyebrow">公益粵語課堂 · 學習門戶</div><h1 id="course-welcome">由一句「你好」，<br/>開始講粵語。</h1><p className="auth-description">為普通話母語初學者準備。課堂筆記、演示文檔與練習，在這裏接上每一課。</p><div className="classroom-art"><img src={`${import.meta.env.BASE_URL}portal-classroom.webp`} srcSet={`${import.meta.env.BASE_URL}portal-classroom-small.webp 640w, ${import.meta.env.BASE_URL}portal-classroom-medium.webp 960w, ${import.meta.env.BASE_URL}portal-classroom.webp 1536w`} sizes="(max-width: 760px) 100vw, 50vw" width="1200" height="800" alt="" fetchPriority="high"/></div><div className="course-facts"><span>8 課學習旅程</span><span>零基礎也能開始</span><span>繁體中文 · 粵拼輔助</span></div></section>
    <section className="auth-panel" aria-labelledby="auth-title"><div className="auth-form-inner"><div className="auth-kicker">{mode === 'login' ? '你好 nei5 hou2' : '公益粵語課堂'}</div><h2 id="auth-title">{title}</h2><p className="muted">{mode === 'login' ? '登入你的帳戶，繼續今天的學習。' : mode === 'signup' ? '登記後由課程管理員批准啟用。' : mode === 'reset' ? '輸入登記電郵，收取重設連結。' : '請選擇至少 12 個字元的新密碼。'}</p>
      {!service.configured && !service.demo ? <div className="setup-state"><Notice title="網站正在準備中">請聯絡課程管理員，完成設定後便可登入。</Notice><a href={`${import.meta.env.BASE_URL}setup.html`}>管理員設定指南 <ArrowRight size={16} aria-hidden="true"/></a></div> : <>
      <form onSubmit={submit} className="stack-form">
        {mode === 'signup' && <Field label="你的姓名" required><Input autoComplete="name" value={name} maxLength={80} onChange={(_, data) => setName(data.value)} required disabled={busy}/></Field>}
        {mode !== 'recovery' && <Field label="電郵地址" required><Input type="email" autoComplete="email" contentBefore={<EnvelopeSimple size={19} aria-hidden="true"/>} value={email} onChange={(_, data) => setEmail(data.value)} required disabled={busy}/></Field>}
        {mode !== 'reset' && <Field label={mode === 'recovery' ? '新密碼' : '密碼'} required hint={mode === 'signup' || mode === 'recovery' ? '至少 12 個字元，建議使用一段容易記住的長句。' : undefined}><Input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} contentBefore={<LockKey size={19} aria-hidden="true"/>} value={password} onChange={(_, data) => setPassword(data.value)} minLength={mode === 'login' ? undefined : 12} maxLength={256} required disabled={busy}/></Field>}
        {(mode === 'signup' || mode === 'recovery') && <Field label="再次輸入密碼" required><Input type="password" autoComplete="new-password" value={confirmation} onChange={(_, data) => setConfirmation(data.value)} minLength={12} maxLength={256} required disabled={busy}/></Field>}
        {mode === 'login' && <div className="align-end"><Button appearance="transparent" onClick={() => changeMode('reset')} disabled={busy}>忘記密碼？</Button></div>}
        {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
        <Button type="submit" appearance="primary" size="large" icon={success ? <CheckCircle size={20}/> : <ArrowRight size={20}/>} iconPosition="after" disabled={busy}>{busy ? '請稍候…' : { login: '登入課堂', signup: '申請帳戶', reset: '發送重設連結', recovery: '儲存新密碼' }[mode]}</Button>
      </form>
      <div className="auth-switch">{mode === 'login' ? <><span>首次參加課堂？</span><Button appearance="transparent" onClick={() => changeMode('signup')} disabled={busy}>申請帳戶</Button></> : mode !== 'recovery' ? <Button appearance="transparent" icon={<ArrowLeft size={17}/>} onClick={() => changeMode('login')} disabled={busy}>返回登入</Button> : null}</div>
      </>}
      <p className="privacy-copy">帳戶僅供本課程使用。學生材料按課程安排開放，請用自己的帳戶登入。</p>
    </div></section>
  </main>;
}
