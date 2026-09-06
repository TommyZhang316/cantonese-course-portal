import { addTraditionalDict, pinyin } from 'pinyin-pro';
import TraditionalDict from '@pinyin-pro/data/traditional';

// Official dictionary keeps traditional surnames aligned with surname:'head'.
addTraditionalDict(TraditionalDict);

export const MAX_ACCOUNT_BATCH = 50;
export interface NameInput { name: string; username?: string }
export interface UsernamePreview { name: string; username: string; suffixed: boolean }

export function normalizeUsername(value: string): string {
  return value.trim().toUpperCase();
}

export function usernameFromName(name: string): string {
  return pinyin(name.trim(), { toneType: 'none', type: 'array', surname: 'head', v: true, traditional: true })
    .join('').replace(/[\s·・]/gu, '').toUpperCase();
}

export function usernameError(value: string): string {
  return /^[A-Z][A-Z0-9]{1,59}$/.test(value) ? '' : '請用 2–60 個大寫英文字母或數字，並以字母開頭。';
}

export function nameError(value: string): string {
  return value.trim().length >= 1 && value.trim().length <= 80 && !/[\r\n\u0000-\u001f]/u.test(value)
    ? '' : '請填寫 1–80 字的姓名，不可含換行或控制字元。';
}

/** Parse quoted CSV/TSV, including escaped quotes and CRLF, without evaluating cells. */
function parseDelimited(source: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else cell += character;
      continue;
    }
    if (character === '"') {
      if (cell.trim() || closedQuote) throw new Error('CSV 引號格式不正確，請把含引號的欄位用雙引號包住。');
      cell = ''; quoted = true;
    } else if (character === delimiter) {
      row.push(cell.trim()); cell = ''; closedQuote = false;
    } else if (character === '\n' || character === '\r') {
      row.push(cell.trim()); rows.push(row); row = []; cell = ''; closedQuote = false;
      if (character === '\r' && source[index + 1] === '\n') index++;
    } else if (closedQuote && character.trim()) {
      throw new Error('CSV 引號後只可接分隔符號或換行。');
    } else cell += character;
  }
  if (quoted) throw new Error('CSV 有未結束的引號，請檢查檔案。');
  row.push(cell.trim()); rows.push(row);
  return rows.filter(cells => cells.some(value => value !== ''));
}

const nameHeaders = new Set(['姓名', '中文姓名', '學生姓名', '学生姓名', 'name', 'display_name']);
const usernameHeaders = new Set(['帳戶名稱', '账户名称', '帳戶名字', '賬戶名字', '帳號', '账号', 'username']);

export function parseNameInput(value: string): NameInput[] {
  const source = value.replace(/^\uFEFF/u, '').trim();
  if (!source) throw new Error('請先貼上姓名，或匯入 CSV 名單。');
  if (source.length > 100_000) throw new Error('名單太長，請每次匯入最多 50 位同學。');
  let delimiter = ',';
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '"') {
      if (quoted && source[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && source[index] === '\t') { delimiter = '\t'; break; }
    else if (!quoted && /[\r\n]/u.test(source[index])) break;
  }
  const rows = parseDelimited(source, delimiter);
  const firstRow = rows[0].map(header => header.toLowerCase());
  const namedColumn = firstRow.findIndex(header => nameHeaders.has(header));
  const hasHeaders = namedColumn >= 0;
  const nameColumn = hasHeaders ? namedColumn : 0;
  const usernameColumn = hasHeaders ? firstRow.findIndex(header => usernameHeaders.has(header)) : 1;
  const data = hasHeaders ? rows.slice(1) : rows;
  if (!data.length) throw new Error('名單只有欄位名稱，請加入同學姓名。');
  if (data.length > MAX_ACCOUNT_BATCH) throw new Error(`一次最多建立 ${MAX_ACCOUNT_BATCH} 個帳戶；這份名單有 ${data.length} 行，請分批匯入。`);
  return data.map((cells, index) => {
    if (!hasHeaders && cells.length > 2) throw new Error(`第 ${index + 1} 行有多個欄位；CSV 請提供「姓名」及選填的「帳戶名稱」欄位標題。`);
    const name = cells[nameColumn]?.trim() ?? '';
    const problem = nameError(name);
    if (problem) throw new Error(`第 ${index + (hasHeaders ? 2 : 1)} 行：${problem}`);
    const username = usernameColumn >= 0 ? cells[usernameColumn]?.trim() : '';
    return { name, ...(username ? { username: normalizeUsername(username) } : {}) };
  });
}

/** Keep every source row. Only generated collisions within this batch get suffixes. */
export function buildUsernamePreview(inputs: NameInput[], existingUsernames: string[] = []): UsernamePreview[] {
  const occupied = new Set(existingUsernames.map(normalizeUsername));
  const generated = new Set<string>();
  // Reserve explicitly supplied usernames before assigning generated suffixes.
  const reserved = new Set(inputs.flatMap(row => row.username ? [normalizeUsername(row.username)] : []));
  return inputs.map(input => {
    const base = input.username ? normalizeUsername(input.username) : usernameFromName(input.name);
    let username = base;
    if (!input.username && (generated.has(base) || reserved.has(base))) {
      let suffix = 2;
      do { username = `${base}${String(suffix++).padStart(2, '0')}`; }
      while (occupied.has(username) || generated.has(username) || reserved.has(username));
    }
    generated.add(username);
    return { name: input.name, username, suffixed: username !== base };
  });
}

export function csvCell(value: string): string {
  // Quoting alone does not stop spreadsheet formula execution.
  const safe = /^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function credentialsCsv(rows: { name: string; username: string }[], portalUrl: string): string {
  return '\uFEFF' + [
    ['中文姓名', '帳戶名稱', '初始密碼', '入口網址'],
    ...rows.map(row => [row.name, row.username, row.username, portalUrl]),
  ].map(row => row.map(csvCell).join(',')).join('\r\n');
}
