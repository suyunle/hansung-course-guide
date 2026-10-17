/**
 * 한성대 공개 강의시간표(시간표 및 수업계획서조회) 조회.
 *
 * 로그인이 필요 없는 공개 조회 페이지가 내부에서 쓰는 데이터 요청을 그대로 보내고,
 * EUC-KR XML 응답을 화면에서 쓰기 좋은 JSON으로 바꾼다. 학생 계정 정보는 다루지 않는다.
 * (로컬 server.js 와 Vercel 함수 api/courses.js 가 함께 쓴다)
 */
const SCHOOL = 'https://info.hansung.ac.kr/jsp/haksa';
const PAGE = `${SCHOOL}/siganpyo_aui.jsp`;
const DATA = `${SCHOOL}/siganpyo_aui_data.jsp`;
const USER_AGENT = 'Mozilla/5.0 (compatible; HansungCourseGuide/1.0; student portfolio)';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 강의시간표는 자주 바뀌지 않는다

async function postForm(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Referer: PAGE,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`학교 시간표 조회 실패: HTTP ${res.status}`);
  return new TextDecoder('euc-kr').decode(await res.arrayBuffer()); // 학교 시스템은 EUC-KR
}

function cdata(row, tag) {
  const m = row.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  return m ? m[1].trim() : '';
}

const decodeEntities = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// ===== 시간 단위 → 시각 =====
// 학업이수가이드 '5. 강의시간 안내' 표의 '시간 단위'는 30분짜리 칸이다.
//   N  = (N+8):00 ~ (N+8):30      예) 2  = 10:00~10:30
//   NM = (N+8):30 ~ (N+9):00      예) 2M = 10:30~11:00
//   'A~B' = A 칸 시작부터 B 칸 끝까지   예) 3M~5M = 11:30~14:00, 8~9M = 16:00~18:00
// 수업은 이 칸 안에서 진행되고 끝의 쉬는 시간(주간 15·10분, 야간 10·5분)이 칸에 포함된다.
//   (월 1~2 = 09:00~10:30 칸 → 실제 수업 09:00~10:15)
const DAY_CHARS = '월화수목금토일';
const unitStart = (n, m) => (8 + n) * 60 + (m ? 30 : 0);
const unitEnd = (n, m) => unitStart(n, m) + 30;

/**
 * '온라인강좌 1.5시간 / 공학관406  목11M~12M'
 * '탐구관501  월8M~9M / 상상관501 수2M~3M'
 * '탐구관303  월7~8,수8M~9M'
 * → { times: [{day,start,end,room}], online: '1.5시간' }
 */
function parseClassroom(raw) {
  const times = [];
  let online = '';
  for (const part of raw.split('/').map((p) => p.trim()).filter(Boolean)) {
    const on = part.match(/^온라인강좌\s*(.*)$/);
    if (on) { online = on[1].trim() || '온라인'; continue; }
    const at = part.search(new RegExp(`[${DAY_CHARS}]\\s*\\d`));
    if (at < 0) continue;
    const room = part.slice(0, at).trim();
    let lastDay = 0;
    for (const token of part.slice(at).replace(/\s+/g, '').split(',')) {
      const m = token.match(/^([월화수목금토일])?(\d+)(M?)~(\d+)(M?)$/);
      if (!m) continue;
      const day = m[1] ? DAY_CHARS.indexOf(m[1]) : lastDay;
      lastDay = day;
      const start = unitStart(Number(m[2]), m[3]);
      const end = unitEnd(Number(m[4]), m[5]);
      if (end > start) times.push({ day, start, end, room });
    }
  }
  return { times, online };
}

// 학교 API 이수구분·과목군 → 화면 분류
const CAT = { 교필: '교양필수', 선필교: '선택필수교양', 일교: '일반교양', 전기: '전공', 전필: '전공', 전선: '전공' };
const MAJOR_KIND = { 전기: '전공기초', 전필: '전공필수', 전선: '전공선택' };
const AREA = {
  인문학: '인문학적 상상력', 사회과학: '사회과학적 상상력', '자연과학 및 정보기술': '과학기술 상상력',
  '예술과 체육': '예술과 스포츠 상상력', 융합교양: '융합적 상상력',
};
const JUYA = { 주: '주간', 야: '야간', 합: '합반' };

/** 한 학기·한 전공(또는 교양 분류)의 강의를 과목 단위로 묶어 돌려준다. */
const cache = new Map();
async function getCourses(term, major) {
  const key = `${term}|${major}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const xml = await postForm(DATA, { gubun: 'history', syearhakgi: term, sjungong: major });
  const byCode = new Map();
  for (const [, row] of xml.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
    const code = cdata(row, 'kwamokcode');
    const isu = cdata(row, 'isugubun');
    if (!code || !CAT[isu]) continue;
    let course = byCode.get(code);
    if (!course) {
      course = {
        code,
        name: cdata(row, 'kwamokname').replace(/＋/g, '+'),
        cat: CAT[isu],
        credits: Number(cdata(row, 'hakjum')) || 0,
        grade: cdata(row, 'haknean'),
        ...(MAJOR_KIND[isu] && { majorKind: MAJOR_KIND[isu], track: major }),
        ...(AREA[cdata(row, 'gwamokgun')] && { area: AREA[cdata(row, 'gwamokgun')] }),
        desc: decodeEntities(cdata(row, 'kcomment')),
        sections: [],
      };
      byCode.set(code, course);
    }
    const sec = cdata(row, 'bunban');
    const { times, online } = parseClassroom(cdata(row, 'classroom'));
    course.sections.push({
      id: `${code}|${sec}`,
      sec,
      jy: JUYA[cdata(row, 'juya')] || null,
      prof: cdata(row, 'prof') || '미정',
      times,
      room: [...new Set(times.map((t) => t.room).filter(Boolean))].join(', '),
      online,
      note: cdata(row, 'bigo'),
    });
  }
  const value = [...byCode.values()];
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** 쿼리 검사 후 강의 목록. 잘못된 값이면 null */
function validParams(term, major) {
  return /^\d{5}$/.test(term || '') && /^[A-Z0-9]{3,6}$/.test(major || '');
}

module.exports = { getCourses, validParams, parseClassroom };
