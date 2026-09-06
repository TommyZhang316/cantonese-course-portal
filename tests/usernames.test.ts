import { describe, expect, it } from 'vitest';
import { buildUsernamePreview, credentialsCsv, csvCell, nameError, normalizeUsername, parseNameInput, usernameError, usernameFromName } from '../src/lib/usernames';

describe('student username generation from Mandarin names', () => {
  it('uses complete uppercase syllables for traditional and simplified Chinese', () => {
    expect(usernameFromName('陳小明')).toBe('CHENXIAOMING');
    expect(usernameFromName('陈小明')).toBe('CHENXIAOMING');
    expect(usernameFromName('  歐陽娜娜  ')).toBe('OUYANGNANA');
  });
  it('recognises surnames without treating given-name characters as surnames', () => {
    expect(usernameFromName('單宇')).toBe('SHANYU');
    expect(usernameFromName('单宇')).toBe('SHANYU');
    expect(usernameFromName('曾樂樂')).toBe('ZENGLELE');
    expect(usernameFromName('區志強')).toBe('OUZHIQIANG');
    expect(usernameFromName('萬俟明')).toBe('MOQIMING');
  });
  it('represents ü as V and ignores spacing between name characters', () => {
    expect(usernameFromName('呂美玲')).toBe('LVMEILING');
    expect(usernameFromName('陳 小明')).toBe('CHENXIAOMING');
  });
  it('retains every same-name student and adds deterministic suffixes', () => {
    expect(buildUsernamePreview([{ name: '陳小明' }, { name: '陳小明' }, { name: '陈小明' }]).map(row => row.username))
      .toEqual(['CHENXIAOMING', 'CHENXIAOMING02', 'CHENXIAOMING03']);
  });
  it('leaves an existing base visible for skipping but avoids it when selecting a suffix', () => {
    const preview = buildUsernamePreview([{ name: '陳小明' }, { name: '陳小明' }], ['CHENXIAOMING', 'CHENXIAOMING02']);
    expect(preview.map(row => row.username)).toEqual(['CHENXIAOMING', 'CHENXIAOMING03']);
  });
  it('reserves explicit usernames and leaves explicit duplicates for administrator review', () => {
    const preview = buildUsernamePreview([{ name: '陳小明' }, { name: '小明', username: 'chenxiaoming' }, { name: '小明二', username: 'CHENXIAOMING02' }]);
    expect(preview.map(row => row.username)).toEqual(['CHENXIAOMING03', 'CHENXIAOMING', 'CHENXIAOMING02']);
    expect(buildUsernamePreview([{ name: '甲', username: 'SAME' }, { name: '乙', username: 'SAME' }]).map(row => row.username)).toEqual(['SAME', 'SAME']);
  });
  it('validates the server username boundary without silently deleting invalid characters', () => {
    expect(normalizeUsername('  shan yu  ')).toBe('SHAN YU');
    expect(usernameError('SHAN YU')).not.toBe('');
    expect(usernameError('陳小明')).not.toBe('');
    expect(usernameError('A')).not.toBe('');
    expect(usernameError('1STUDENT')).not.toBe('');
    expect(usernameError('A'.repeat(60))).toBe('');
    expect(usernameError('A'.repeat(61))).not.toBe('');
    expect(usernameError('LVMEILING02')).toBe('');
    expect(nameError('甲'.repeat(81))).not.toBe('');
  });
});

describe('roster imports and credential handouts', () => {
  it('preserves duplicate plain-name lines and removes blank surrounding lines', () => {
    expect(parseNameInput('\uFEFF\r\n陳小明\r\n\r\n陳小明\n')).toEqual([{ name: '陳小明' }, { name: '陳小明' }]);
  });
  it('accepts BOM CSV with reordered named columns and quoted commas/escaped quotes in unused columns', () => {
    const csv = '\uFEFF備註,帳戶名稱,姓名\r\n"同學, \"\"甲\"\"",shanyu,單宇\r\n"第二\t組\n需要協助",,呂美玲';
    expect(parseNameInput(csv)).toEqual([{ name: '單宇', username: 'SHANYU' }, { name: '呂美玲' }]);
  });
  it('accepts TSV copied directly from a spreadsheet and optional supplied usernames', () => {
    expect(parseNameInput('姓名\t帳戶名稱\r\n陳小明\tCHENXIAOMING02\r\n單宇\t')).toEqual([{ name: '陳小明', username: 'CHENXIAOMING02' }, { name: '單宇' }]);
    expect(parseNameInput('陳小明,CHENXIAOMING04')).toEqual([{ name: '陳小明', username: 'CHENXIAOMING04' }]);
  });
  it('rejects malformed quotes, missing names and line breaks inside names', () => {
    expect(() => parseNameInput('姓名,帳戶名稱\n"陳小明,CHENXIAOMING')).toThrow('引號');
    expect(() => parseNameInput('姓名,帳戶名稱\n,CHENXIAOMING')).toThrow('姓名');
    expect(() => parseNameInput('姓名\n"陳\n小明"')).toThrow('換行');
    expect(() => parseNameInput('姓名')).toThrow('只有欄位');
  });
  it('rejects a 51-row batch instead of silently dropping students', () => {
    expect(parseNameInput(Array(50).fill('陳小明').join('\n'))).toHaveLength(50);
    expect(() => parseNameInput(Array(51).fill('陳小明').join('\n'))).toThrow('51 行');
  });
  it('quotes formulas safely even when preceded by whitespace and doubles embedded quotes', () => {
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(csvCell('  +CMD')).toBe('"\'  +CMD"');
    expect(csvCell('@NAME')).toBe('"\'@NAME"');
    expect(csvCell('正常姓名')).toBe('"正常姓名"');
  });
  it('exports UTF-8 BOM handouts with matching initial passwords and no extra account fields', () => {
    const url = 'https://example.test/course/';
    const csv = credentialsCsv([{ name: '陳小明', username: 'CHENXIAOMING02' }], url);
    expect(csv).toBe('\uFEFF"中文姓名","帳戶名稱","初始密碼","入口網址"\r\n"陳小明","CHENXIAOMING02","CHENXIAOMING02","https://example.test/course/"');
    expect(parseNameInput(csv)).toEqual([{ name: '陳小明', username: 'CHENXIAOMING02' }]);
  });
});
