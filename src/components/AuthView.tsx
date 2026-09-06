import { useState, type FormEvent } from 'react';
import { Button, Field, Input } from '@fluentui/react-components';
import { ArrowRight, ArrowLeft, EnvelopeSimple, LockKey, CheckCircle, UserCircle } from '@phosphor-icons/react';
import { service } from '../lib/service';
import { Notice, messageOf } from './shared';
import type { Account } from '../types';

export function AuthView({ onComplete, recovery = false, requiredPasswordChange }: { onComplete: () => void; recovery?: boolean; requiredPasswordChange?: Account }) {
  const [mode, setMode] = useState<'login' | 'reset' | 'recovery'>(recovery || requiredPasswordChange ? 'recovery' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const title = requiredPasswordChange ? '先設定你的專用密碼' : { login: '歡迎返嚟', reset: '找回登入密碼', recovery: '設定新密碼' }[mode];
  function changeMode(next: typeof mode) { setMode(next); setError(''); setSuccess(''); setPassword(''); setConfirmation(''); if (next === 'reset' && !email.includes('@')) setEmail(''); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess('');
    if (busy) return;
    if (mode === 'recovery' && password.length < 12) { setError('請使用至少 12 個字元的新密碼。'); return; }
    if (mode === 'recovery' && password !== confirmation) { setError('兩次輸入的密碼不同，請再核對。'); return; }
    if (mode === 'recovery' && requiredPasswordChange?.username && password.trim().toUpperCase() === requiredPasswordChange.username) { setError('請選擇自己的新密碼，不可與帳戶名稱或初始密碼相同。'); return; }
    if (mode === 'reset' && (!email.includes('@') || email.trim().toLowerCase().endsWith('@accounts.cantonese.invalid'))) { setError('拼音學生帳戶請聯絡課程管理員重設初始密碼。'); return; }
    setBusy(true);
    try {
      if (mode === 'login') { await service.signIn(email.trim(), password); onComplete(); }
      if (mode === 'reset') { await service.requestPasswordReset(email.trim()); setSuccess('如果此電郵已登記，我們會發送重設密碼連結。請同時檢查垃圾郵件。'); }
      if (mode === 'recovery') { await service.updatePassword(password); const url = new URL(window.location.href); url.searchParams.delete('recovery'); url.hash = ''; window.history.replaceState({}, '', url); onComplete(); }
    } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  }
  return <main id="main-content" className="auth-layout" tabIndex={-1}>
    <section className="auth-story" aria-labelledby="course-welcome"><div className="eyebrow">公益粵語課堂 · 學習門戶</div><h1 id="course-welcome">由一句「你好」，<br/>開始講粵語。</h1><p className="auth-description">為普通話母語初學者準備。課堂筆記、演示文檔與練習，在這裏接上每一課。</p><div className="classroom-art"><img src={`${import.meta.env.BASE_URL}portal-classroom.webp`} srcSet={`${import.meta.env.BASE_URL}portal-classroom-small.webp 640w, ${import.meta.env.BASE_URL}portal-classroom-medium.webp 960w, ${import.meta.env.BASE_URL}portal-classroom.webp 1536w`} sizes="(max-width: 760px) 100vw, 50vw" width="1200" height="800" alt="" fetchPriority="high"/></div><div className="course-facts"><span>8 課學習旅程</span><span>零基礎也能開始</span><span>繁體中文 · 粵拼輔助</span></div></section>
    <section className="auth-panel" aria-labelledby="auth-title"><div className="auth-form-inner"><div className="auth-kicker">{mode === 'login' ? '你好 nei5 hou2' : '公益粵語課堂'}</div><h2 id="auth-title">{title}</h2><p className="muted">{mode === 'login' ? '使用管理員提供的帳戶，繼續今天的學習。' : mode === 'reset' ? '教職員可用登記電郵收取重設連結。' : requiredPasswordChange ? '設定後便可進入課堂，閱讀已發布材料。' : '請選擇至少 12 個字元的新密碼。'}</p>
      {!service.configured && !service.demo ? <div className="setup-state"><Notice title="網站正在準備中">請聯絡課程管理員，完成設定後便可登入。</Notice><a href={`${import.meta.env.BASE_URL}setup.html`}>管理員設定指南 <ArrowRight size={16} aria-hidden="true"/></a></div> : <>
      <form onSubmit={submit} className="stack-form">
        {requiredPasswordChange && <Notice title={requiredPasswordChange.display_name || '你的學生帳戶'}>帳戶名稱：{requiredPasswordChange.username || requiredPasswordChange.email}<p>初始密碼只供首次登入。請設定只有你知道的新密碼。</p></Notice>}
        {mode === 'reset' && <Notice>使用拼音帳戶名稱的同學，請聯絡管理員重設初始密碼。以下電郵重設功能適用於以電郵登入的帳戶。</Notice>}
        {mode !== 'recovery' && <Field label={mode === 'login' ? '帳戶名稱或電郵' : '電郵地址'} required hint={mode === 'login' ? '學生帳戶採普通話全拼音大寫，例如 CHENXIAOMING。' : undefined}><Input type={mode === 'login' ? 'text' : 'email'} autoComplete={mode === 'login' ? 'username' : 'email'} autoCapitalize="none" spellCheck={false} contentBefore={mode === 'login' ? <UserCircle size={19} aria-hidden="true"/> : <EnvelopeSimple size={19} aria-hidden="true"/>} value={email} onChange={(_, data) => setEmail(data.value)} required disabled={busy}/></Field>}
        {mode !== 'reset' && <Field label={mode === 'recovery' ? '新密碼' : '密碼'} required hint={mode === 'recovery' ? '至少 12 個字元，建議使用一段容易記住的長句。' : '首次登入請使用管理員提供的初始密碼，與帳戶名稱相同。'}><Input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} contentBefore={<LockKey size={19} aria-hidden="true"/>} value={password} onChange={(_, data) => setPassword(data.value)} minLength={mode === 'login' ? undefined : 12} maxLength={256} required disabled={busy}/></Field>}
        {mode === 'recovery' && <Field label="再次輸入密碼" required><Input type="password" autoComplete="new-password" value={confirmation} onChange={(_, data) => setConfirmation(data.value)} minLength={12} maxLength={256} required disabled={busy}/></Field>}
        {mode === 'login' && <div className="align-end"><Button appearance="transparent" onClick={() => changeMode('reset')} disabled={busy}>忘記密碼？</Button></div>}
        {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
        <Button type="submit" appearance="primary" size="large" icon={success ? <CheckCircle size={20}/> : <ArrowRight size={20}/>} iconPosition="after" disabled={busy}>{busy ? '請稍候…' : { login: '登入課堂', reset: '發送重設連結', recovery: requiredPasswordChange ? '儲存密碼並進入課堂' : '儲存新密碼' }[mode]}</Button>
      </form>
      <div className="auth-switch">{mode === 'login' ? <span>尚未有帳戶？請向課程管理員領取。</span> : mode !== 'recovery' ? <Button appearance="transparent" icon={<ArrowLeft size={17}/>} onClick={() => changeMode('login')} disabled={busy}>返回登入</Button> : null}</div>
      </>}
      <p className="privacy-copy">帳戶僅供本課程使用。學生材料按課程安排開放，請用自己的帳戶登入。</p>
    </div></section>
  </main>;
}
