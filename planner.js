const DAYS = ['월', '화', '수', '목', '금', '토'];
const DAY_START = 9 * 60;     // 09:00
const DAY_END = 23 * 60;      // 야간 마지막 칸(14M)까지
const SLOT = 15;              // 시간표 한 칸 = 15분
// 과목 색: 채도 있는 배경 + 같은 계열 진한 테두리 + 진한 글자 (서로 잘 구분되도록 색상을 섞음)
// bd 는 블록 테두리와 과목 표의 색 표시에 씀
const PALETTE = [
  { bg: '#b6d1fc', bd: '#2f6fd6', tx: '#0f2c66' },
  { bg: '#afe5dc', bd: '#16958a', tx: '#08433d' },
  { bg: '#fcd89d', bd: '#cf8614', tx: '#573503' },
  { bg: '#d4c3f2', bd: '#7a55c4', tx: '#341d60' },
  { bg: '#afdefa', bd: '#1b93d6', tx: '#093f5f' },
  { bg: '#bfe7c3', bd: '#3a9a55', tx: '#164321' },
  { bg: '#f9c3d3', bd: '#c94a76', tx: '#5a1534' },
  { bg: '#d0d7e2', bd: '#5d6b84', tx: '#212b40' },
];
const colorOf = (i) => PALETTE[i % PALETTE.length];
const AREAS = ['인문학적 상상력', '사회과학적 상상력', '과학기술 상상력', '예술과 스포츠 상상력', '융합적 상상력'];

let meta = null;          // data/departments.json (학과 구성·교양필수 배정·주야교차)
let courses = [];         // 학교 공개 시간표 API에서 불러온 강의
let allMajorsLoaded = false;
let dept = null;          // 선택한 학부·학과
let jy = '주간';          // 주간 / 야간
let picks = [];           // [{ code, key }]  key = 분반 id
let category = '선택필수교양';
let filter = 'all';
let keyword = '';
let openCode = null;      // 분반을 펼친 과목
let step = 0;             // 교양필수 고르기 단계
let levelOf = {};         // 영어처럼 레벨이 나뉜 과목: 묶음 이름 → 보고 있는 과목 코드

// 브라우저에 아무것도 저장하지 않는다: 들어올 때마다 처음부터 시작
// (예전 버전이 남긴 저장값도 지움)
try { localStorage.clear(); } catch {}

// ===== 유틸 =====
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const secKey = (s) => s.id;
const findCourse = (code) => courses.find((c) => c.code === code);
const findSection = (code, key) => findCourse(code)?.sections.find((s) => secKey(s) === key);
const pickOf = (code) => picks.find((p) => p.code === code);
const slotOf = (code) => dept.required.find((s) => s.codes.includes(code));
const hasOwnMajor = () => courses.some((c) => c.cat === '전공' && (c.depts || []).includes(dept.id));
// 요일별로 한 줄씩
const timeLines = (s) => s.times.length
  ? s.times.map((t) => `<span class="opt__time"><b>${DAYS[t.day]}</b> ${hhmm(t.start)}~${hhmm(t.end)}</span>`).join('')
  : '<span class="opt__time">시간 미지정</span>';
const totalCredits = () => picks.reduce((sum, p) => sum + (findCourse(p.code)?.credits || 0), 0);

// 주야교차: 합반·내 주야 분반은 그대로, 반대쪽 분반은 책자에 '교차 가능'으로 적힌 것만
const crossOk = (s) => !s.jy || s.jy === '합반' || s.jy === jy || meta.cross[s.id] === true;

// 수업 시간대로 본 주야 (10교시 = 18:00부터 야간)
const timeBand = (s) => (!s.times.length ? null : s.times.every((t) => t.start >= 18 * 60) ? '야간' : '주간');

// 교양필수·전공은 교차 없이 내 주야 분반만 (합반은 수업 시간대가 내 주야인 것만)
// 전공: 학업이수가이드 '주간학생은 주간에 설치된 트랙만, 야간학생은 야간 트랙만' → 내 주야 분반이 있으면 그것만.
//   예외(반대쪽에만 개설된 트랙, 예: 야간 게임그래픽디자인·주간 한국어교육)는 내 주야 분반이 없을 때만 책자의 교차 표시대로
const sameJyOk = (s) => (s.jy === '합반' || !s.jy ? (timeBand(s) || jy) === jy : s.jy === jy);

// 책자에 적힌 분반별 제한: 미래플러스·글로벌인재 전용, 수강 학년, 단과대학별 분반
function allowedForMe(s) {
  const r = meta.restrict[s.id];
  if (!r) return true;
  if (r.only) return false;
  if (r.grades) return r.grades.includes(1);
  if (r.college === '인문사회기타') return !['IT공과대학', '디자인대학'].includes(dept.college);
  if (r.college) return r.college === dept.college;
  return true;
}

// 신청할 수 있는 분반만
function sectionsFor(course) {
  if (!course) return [];
  let list = course.sections.filter(allowedForMe);
  if (course.cat === '교양필수') {
    // 내 단과대학에 배정된 분반 + 내 주야 분반만
    const who = slotOf(course.code)?.for || dept.for;
    const assigned = meta.gyopilFor[course.code] || {};
    return list.filter((s) => (assigned[s.sec] || []).some((w) => who.includes(w)) && sameJyOk(s));
  }
  if (course.cat === '전공') {
    const mine = list.filter(sameJyOk);
    return mine.length ? mine : list.filter(crossOk);
  }
  return list.filter(crossOk);
}

// ===== 강의 불러오기 (학교 공개 시간표 API) =====
function merge(list, deptId) {
  for (const c of list) {
    const have = findCourse(c.code);
    if (!have) {
      courses.push({ ...c, depts: deptId ? [deptId] : [], sections: [...c.sections] });
      continue;
    }
    for (const s of c.sections) if (!have.sections.some((x) => x.id === s.id)) have.sections.push(s);
    if (deptId && !have.depts.includes(deptId)) have.depts.push(deptId);
  }
}

// 우리 학과 1학년에게 필요한 것: 교양 3종 + 우리 학과 트랙의 1학년 전공
async function loadForDept(d) {
  const [필수, 선필, 일교, ...majors] = await Promise.all([
    api.getCourses(meta.term, GYOYANG.교양필수),
    api.getCourses(meta.term, GYOYANG.선택필수교양),
    api.getCourses(meta.term, GYOYANG.일반교양),
    ...d.majors.map((m) => api.getCourses(meta.term, m)),
  ]);
  const requiredCodes = d.required.flatMap((s) => s.codes);
  courses = [];
  allMajorsLoaded = false;
  merge(필수.filter((c) => requiredCodes.includes(c.code)));
  merge(선필.filter((c) => c.area));                 // 영역 없는 과목군(한국어 집중 등)은 제외
  merge(일교);
  majors.forEach((list) => merge(list.filter((c) => c.grade === '1'), d.id));
}

// '전체 학부'를 고르면 다른 학과 트랙의 1학년 전공도 불러옴
async function loadAllMajors() {
  if (allMajorsLoaded) return;
  for (const d of meta.departments) {
    const lists = await Promise.all(d.majors.map((m) => api.getCourses(meta.term, m)));
    lists.forEach((list) => merge(list.filter((c) => c.grade === '1'), d.id));
  }
  allMajorsLoaded = true;
}

function overlaps(a, b) {
  return a.times.some((x) => b.times.some((y) => x.day === y.day && x.start < y.end && y.start < x.end));
}

function clashWith(section, ignoreCodes = []) {
  for (const p of picks) {
    if (ignoreCodes.includes(p.code)) continue;
    const s = findSection(p.code, p.key);
    if (s && overlaps(s, section)) return findCourse(p.code);
  }
  return null;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('is-show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('is-show'), 1800);
}

// ===== 2. 교양필수 고르기 =====
function renderSetup() {
  if (step >= dept.required.length) return closeSetup();
  const slot = dept.required[step];
  const pick = picks.find((p) => slot.codes.includes(p.code));
  const code = levelOf[slot.name] || pick?.code || slot.codes[0];
  const course = findCourse(code);

  document.getElementById('setup-dots').innerHTML = dept.required.map((s, i) =>
    `<span class="${i === step ? 'is-now' : ''} ${picks.some((p) => s.codes.includes(p.code)) ? 'is-done' : ''}"></span>`).join('');
  document.getElementById('setup-step').textContent = `교양필수 ${step + 1} / ${dept.required.length}`;
  document.getElementById('setup-title').textContent = slot.name;

  document.getElementById('setup-levels').innerHTML = slot.codes.length > 1
    ? slot.codes.filter(findCourse).map((c) => {
        const label = findCourse(c).name.replace(slot.name, '').trim();
        return `<button class="level ${c === code ? 'is-on' : ''}" data-code="${c}">레벨 ${esc(label)}</button>`;
      }).join('')
    : '';

  const secs = sectionsFor(course);
  document.getElementById('setup-opts').innerHTML = secs.length ? secs.map((s) => {
    const on = pick && pick.code === code && pick.key === secKey(s);
    const clash = !on && clashWith(s, slot.codes);
    return `
      <button class="opt ${on ? 'is-on' : ''}" ${clash ? 'disabled' : ''} data-key="${esc(secKey(s))}" data-code="${code}">
        ${timeLines(s)}
        <span class="opt__prof">${clash ? '시간 겹침' : esc(s.prof)}</span>
      </button>`;
  }).join('') : `
    <div class="setup__empty">
      <p>${jy} 학생이 신청할 수 있는 분반이 없어요</p>
      <button class="btn btn--outline" data-skip>건너뛰기</button>
    </div>`;

  document.getElementById('setup-prev').style.visibility = step === 0 || single ? 'hidden' : 'visible';
}

let single = false;  // 시간표에서 한 과목만 바꾸러 들어온 경우

function openSetup(at = 0, onlyOne = false) {
  step = at;
  single = onlyOne;
  levelOf = {};
  renderSetup();
  document.getElementById('setup').classList.remove('is-hidden');
}

// ===== 3. 시간표: 담기 / 빼기 =====
function add(code, key) {
  const course = findCourse(code);
  const section = findSection(code, key);
  if (!sectionsFor(course).includes(section)) return toast('주야 교차 수강이 안 되는 분반이에요');
  const clash = clashWith(section, [code]);
  if (clash) return toast(`'${clash.name}'과(와) 시간이 겹쳐요`);
  const before = pickOf(code) ? course.credits : 0;
  if (totalCredits() - before + course.credits > meta.maxCredits) {
    return toast(`최대 ${meta.maxCredits}학점까지 담을 수 있어요`);
  }
  picks = picks.filter((p) => p.code !== code);
  picks.push({ code, key });
  openCode = null;
  render();
  // 선택필수교양은 5개 영역 중 4개 영역을 들어야 하므로 같은 영역을 또 담으면 알려 줌
  const sameArea = course.cat === '선택필수교양' && course.area &&
    picks.some((p) => p.code !== code && findCourse(p.code)?.cat === '선택필수교양' && findCourse(p.code).area === course.area);
  if (sameArea) toast(`'${course.area}' 영역은 이미 담았어요 · 영역이 겹치지 않게 고르는 걸 추천해요`);
  else if (window.matchMedia('(max-width: 800px)').matches) toast(`'${course.name}' 담았어요 · 시간표 탭에서 확인`);
  maybeOneTip();   // 17학점이 되면 1학점 과목 안내
}

function remove(code) {
  picks = picks.filter((p) => p.code !== code);
  render();
}

// ===== 3. 시간표: 목록 =====
function renderFilter() {
  const el = document.getElementById('filter');
  let opts = [];
  if (category === '선택필수교양') opts = [['all', '전체 영역'], ...AREAS.map((a) => [a, a])];
  // 전공은 내 학부(트랙) 1학년 과목만. 소속 트랙이 없는 상상력인재학부만 전체 학부에서 고른다
  if (category === '전공') opts = hasOwnMajor() ? [] : [['all', '전체 학부']];
  el.innerHTML = opts.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  el.value = filter;
  el.hidden = !opts.length;
  document.getElementById('sel-tip').hidden = category !== '선택필수교양';
}

function renderList() {
  const list = document.getElementById('course-list');
  const items = courses.filter((c) => {
    if (c.cat !== category) return false;
    if (c.cat === '선택필수교양' && filter !== 'all' && c.area !== filter) return false;
    if (c.cat === '전공' && filter === 'mine' && !(c.depts || []).includes(dept.id)) return false;
    if (!sectionsFor(c).length) return false;   // 주야교차로 신청 가능한 분반이 없는 과목
    return !keyword || c.name.includes(keyword);
  });

  list.innerHTML = items.map((c) => {
    const pick = pickOf(c.code);
    const open = openCode === c.code;
    return `
      <li class="course ${pick ? 'is-on' : ''}">
        <div class="course__row" data-open="${c.code}">
          <div class="course__info">
            <strong>${esc(c.name)}</strong>
            <span>${c.credits}학점${pick ? ' · 담음' : ''}</span>
          </div>
          ${pick
            ? `<button class="course__btn course__btn--off" data-remove="${c.code}">빼기</button>`
            : `<span class="course__arrow">${open ? '−' : '+'}</span>`}
        </div>
        ${open ? `<div class="course__secs">${sectionsFor(c).map((s) => `
          <button class="sec" data-add="${c.code}" data-key="${esc(secKey(s))}">
            ${timeLines(s)}<small>${esc(s.prof)}</small>
          </button>`).join('')}</div>` : ''}
      </li>`;
  }).join('') || '<li class="empty">검색 결과가 없어요</li>';
}

// ===== 3. 시간표: 표 =====
function renderTimetable() {
  const tt = document.getElementById('timetable');
  const chosen = picks.map((p, i) => ({ c: findCourse(p.code), s: findSection(p.code, p.key), i }))
    .filter((x) => x.c && x.s);
  const days = chosen.some((x) => x.s.times.some((t) => t.day === 5)) ? 6 : 5;
  // 담은 수업이 있는 시간대만 그림 (첫 수업 시작 ~ 마지막 수업 끝, 정시 단위)
  // 아무것도 안 담았으면 9~18시, 너무 짧으면 최소 4시간
  const all = chosen.flatMap((x) => x.s.times);
  let dayStart = all.length ? Math.floor(Math.min(...all.map((t) => t.start)) / 60) * 60 : DAY_START;
  let dayEnd = all.length ? Math.ceil(Math.max(...all.map((t) => t.end)) / 60) * 60 : 18 * 60;
  if (dayEnd - dayStart < 4 * 60) dayEnd = Math.min(DAY_END, dayStart + 4 * 60);
  if (dayEnd - dayStart < 4 * 60) dayStart = dayEnd - 4 * 60;
  const rows = (dayEnd - dayStart) / SLOT;

  // 시간 칸·요일 칸 최소 폭은 CSS 변수로 (휴대폰에서는 좁게 바뀜)
  tt.style.gridTemplateColumns = `var(--hour-w) repeat(${days}, minmax(var(--day-min), 1fr))`;
  // 높이는 CSS의 16:9 비율로 정해지고, 15분 칸들이 그 높이를 나눠 가진다
  tt.style.gridTemplateRows = `36px repeat(${rows}, minmax(0, 1fr))`;

  let html = '<div class="tt-corner"></div>';
  for (let d = 0; d < days; d++) html += `<div class="tt-day" style="grid-column:${d + 2}">${DAYS[d]}</div>`;
  for (let m = dayStart, r = 2; m < dayEnd; m += 60, r += 4) {
    html += `<div class="tt-hour${m === dayStart ? ' is-first' : ''}" style="grid-row:${r} / span 4">${m / 60}:00</div>`;
    for (let d = 0; d < days; d++) html += `<div class="tt-cell" style="grid-column:${d + 2}; grid-row:${r} / span 4"></div>`;
  }
  chosen.forEach(({ c, s, i }) => {
    const col = colorOf(i);
    s.times.forEach((t) => {
      const r = (t.start - dayStart) / SLOT + 2;
      const span = Math.max(2, Math.round((t.end - t.start) / SLOT));
      html += `<button class="tt-block" data-code="${c.code}" title="${esc(c.name)}"
        style="grid-column:${t.day + 2}; grid-row:${r} / span ${span}; --bg:${col.bg}; --bd:${col.bd}; --tx:${col.tx}">${esc(c.name)}</button>`;
    });
  });
  tt.innerHTML = html;
  fitBlocks(tt);
}

// 블록 안에 과목명이 다 들어가도록 글자 크기를 줄여 맞춤 (PC 13→10px, 휴대폰 12→8.5px)
function fitBlocks(root) {
  const phone = window.matchMedia('(max-width: 800px)').matches;
  const max = phone ? 12 : 13;
  const min = phone ? 8.5 : 10;
  root.querySelectorAll('.tt-block').forEach((b) => {
    let size = max;
    b.style.fontSize = `${size}px`;
    while (size > min && (b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1)) {
      size -= 0.5;
      b.style.fontSize = `${size}px`;
    }
  });
}

// ===== 3. 시간표: 담은 과목 표 (과목코드·시간·장소) =====
function renderSummary() {
  const rows = picks.map((p, i) => ({ c: findCourse(p.code), s: findSection(p.code, p.key), i }))
    .filter((x) => x.c && x.s);
  document.getElementById('summary').innerHTML = rows.length
    ? rows.map(({ c, s, i }) => {
        const col = colorOf(i);
        // 시간과 장소를 수업마다 같은 줄에 맞춰 보여줌
        const times = s.times.length
          ? s.times.map((t) => `<div><b>${DAYS[t.day]}</b> ${hhmm(t.start)}~${hhmm(t.end)}</div>`).join('')
          : '<div>온라인</div>';
        const rooms = s.times.length
          ? s.times.map((t) => `<div>${esc(t.room || '-')}</div>`).join('')
          : '<div>-</div>';
        return `
        <tr data-code="${c.code}">
          <td class="summary__name"><i class="summary__dot" style="background:${col.bd}"></i>${esc(c.name)}</td>
          <td class="summary__code">${esc(c.code)}</td>
          <td class="summary__sec">${esc(s.sec)}</td>
          <td class="summary__lines">${times}</td>
          <td class="summary__lines">${rooms}</td>
          <td>${esc(s.prof).replace(/,/g, ', ')}</td>
          <td class="summary__num">${c.credits}</td>
        </tr>`;
      }).join('') +
      `<tr class="summary__total"><td colspan="6">합계</td><td class="summary__num">${totalCredits()}학점</td></tr>`
    : '<tr><td colspan="7" class="empty">담은 과목이 없어요</td></tr>';
}

// ===== 이수 기준 (출처: 2026-1 수강신청 안내 및 학업이수가이드) =====
function renderGuide() {
  const body = document.getElementById('sheet-body');
  const picked = picks.map((p) => findCourse(p.code)).filter(Boolean);

  // 선택필수교양: 이번 학기에 담은 과목이 채우는 영역
  const areaRows = AREAS.map((a) => {
    const got = picked.filter((c) => c.cat === '선택필수교양' && c.area === a);
    return `<li class="${got.length ? 'is-done' : ''}"><b>${a}</b><span>${got.length ? got.map((c) => esc(c.name)).join(', ') : '-'}</span></li>`;
  }).join('');
  const areaCount = AREAS.filter((a) => picked.some((c) => c.cat === '선택필수교양' && c.area === a)).length;
  const selCredits = picked.filter((c) => c.cat === '선택필수교양').reduce((s, c) => s + c.credits, 0);

  // 튜토리얼에서 고른 구성 대비 지금 담은 과목 수 (1학점 과목은 세지 않음)
  let goalHtml = '';
  if (goal) {
    const count = (cat) => picked.filter((c) => c.cat === cat && !ONE_CREDIT.includes(c.code)).length;
    const rows = [['전공', count('전공'), goal.major], ['선택 필수 교양', count('선택필수교양'), goal.sel]]
      .filter(([, , need]) => need > 0);
    const left = rows.filter(([, have, need]) => have < need).map(([label, have, need]) => `${label} ${need - have}과목`);
    goalHtml = `
      <h3>내가 고른 구성 · 전공 ${goal.major} + 선택 필수 교양 ${goal.sel}</h3>
      <ul class="areas">${rows.map(([label, have, need]) => `
        <li class="${have >= need ? 'is-done' : ''}"><b>${label}</b><span>${have} / ${need}과목</span>
          <em>${have >= need ? '다 담았어요' : `${need - have}과목 더 담기`}</em></li>`).join('')}
      </ul>
      <p class="sheet__now">${left.length ? `더 담아야 할 것: ${left.join(', ')}` : '고른 구성을 다 채웠어요'}</p>`;
  }

  body.innerHTML = `
    <h2>이수 기준</h2>
    <p class="sheet__src">2026학년도 1학기 수강신청 안내 및 학업이수가이드 기준 (24학번 이후)</p>
    ${goalHtml}

    <h3>선택필수교양</h3>
    <p class="sheet__rule"><b>졸업할 때까지 총</b> <b>5개 영역 중 4개 영역 이상</b>에서 영역마다 1과목 이상, <b>합계 15학점 이상</b><br>
      <small>한 학기에 다 채우는 게 아니라, 재학 기간 전체에 걸쳐 채우면 돼요.</small></p>
    <ul class="areas">${areaRows}</ul>
    <p class="sheet__now">이번 학기: ${areaCount}개 영역 · ${selCredits}학점 담음</p>
  `;
}

function render() {
  renderFilter();
  renderList();
  renderTimetable();
  renderSummary();
  document.getElementById('total-credits').textContent = totalCredits();
}

// ===== 1. 시작 =====
async function startWithDept(deptId, shift) {
  const startBtn = document.getElementById('start-btn');
  const d = meta.departments.find((x) => x.id === deptId);
  startBtn.disabled = true;
  startBtn.textContent = '강의 불러오는 중…';
  try {
    await loadForDept(d);
  } catch (err) {
    console.error(err);
    toast(err.message || '강의 정보를 불러오지 못했어요');
    return;
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = '시작하기!';
  }
  dept = d;
  jy = dept.dayOnly ? '주간' : shift;
  picks = [];
  oneTipShown = false;
  goal = null;
  category = '선택필수교양';
  filter = 'all';
  openCode = null;
  document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('is-on', t.dataset.cat === category));
  document.getElementById('dept-btn').textContent = `${dept.name} · ${jy} ▾`;
  setView('courses');
  openSetup(0);
  document.getElementById('start').classList.add('is-hidden');
}

async function init() {
  const collegeSelect = document.getElementById('college-select');
  const select = document.getElementById('dept-select');
  const startBtn = document.getElementById('start-btn');
  try {
    meta = await api.getMeta();
  } catch (err) {
    toast('학과 정보를 불러오지 못했어요');
    console.error(err);
    return;
  }
  document.getElementById('max-credits').textContent = meta.maxCredits;

  // 단과대학 → 학부·학과
  const colleges = [...new Set(meta.departments.map((d) => d.college))];
  collegeSelect.innerHTML += colleges.map((col) => `<option value="${esc(col)}">${esc(col)}</option>`).join('');

  // 주간 / 야간 (주간에만 개설된 학과는 야간 선택 불가)
  const jyButtons = [...document.querySelectorAll('#jy .jy')];
  let shift = '주간';
  function setShift(v) {
    shift = v;
    jyButtons.forEach((b) => b.classList.toggle('is-on', b.dataset.jy === v));
  }
  function syncShift() {
    const d = meta.departments.find((x) => x.id === select.value);
    const night = jyButtons.find((b) => b.dataset.jy === '야간');
    night.disabled = !!d?.dayOnly;
    if (d?.dayOnly) setShift('주간');
  }
  document.getElementById('jy').addEventListener('click', (e) => {
    const b = e.target.closest('.jy');
    if (b && !b.disabled) setShift(b.dataset.jy);
  });

  function fillDepts(college) {
    const list = meta.departments.filter((d) => d.college === college);
    select.innerHTML = '<option value="">학부·학과</option>' +
      list.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    select.disabled = !college;
    if (list.length === 1) select.value = list[0].id;
    startBtn.disabled = !select.value;
    syncShift();
  }

  syncShift();

  collegeSelect.addEventListener('change', () => fillDepts(collegeSelect.value));
  select.addEventListener('change', () => { startBtn.disabled = !select.value; syncShift(); });
  startBtn.addEventListener('click', () => startWithDept(select.value, shift));
}

// ===== 이벤트: 교양필수 고르기 =====
document.getElementById('setup-levels').addEventListener('click', (e) => {
  const b = e.target.closest('[data-code]');
  if (!b) return;
  levelOf[dept.required[step].name] = b.dataset.code;
  renderSetup();
});

// 다음 과목으로 (마지막이면 시간표로)
function advance(delay) {
  clearTimeout(renderSetup.timer);
  renderSetup.timer = setTimeout(() => {
    if (!single && step < dept.required.length - 1) {
      step++;
      renderSetup();
    } else {
      closeSetup();
    }
  }, delay);
}

function closeSetup() {
  document.getElementById('setup').classList.add('is-hidden');
  render();
  if (!single) openTour();   // 처음 교양필수를 다 고른 뒤에만 튜토리얼
}

// ===== 2-1. 튜토리얼: 18학점 채우기 =====
// 1) 교양필수를 고른 뒤: 전공 N과목 + 선택필수교양 N과목 (N = 0~2, 과목당 3학점). 18학점은 넘지 않게
//    추천: 전공 2 + 선필교 2, 교양필수가 3과목이면 전공 2 + 선필교 1
// 2) 시간표가 처음 17학점이 되면: 1학점 과목(대학생활 길라잡이·사회봉사)으로 18학점 채우기 안내
const ONE_CREDIT = ['GEN0789', 'GEN0923'];   // 대학생활 길라잡이, 사회봉사 Ⅰ
let tour = null;            // { kind: 'plan', base, rec: { major, sel }, major, sel } | { kind: 'one', ones: [{ course, section }] }
let oneTipShown = false;    // 1학점 안내는 학과마다 한 번만
let goal = null;            // 튜토리얼에서 고른 구성 { major, sel } (건너뛰면 null)

const shortName = (c) => c.name.replace(/\s+/g, ' ').trim();
const planTotal = (t, major = t.major, sel = t.sel) => t.base + 3 * (major + sel);

function showTour() {
  document.getElementById('tour').classList.remove('is-hidden');
  document.getElementById('tour-card').querySelector('.btn--primary, [data-one-add]:not(:disabled), .btn')?.focus();
}

function closeTour() {
  document.getElementById('tour').classList.add('is-hidden');
  tour = null;
}

function openTour() {
  const base = totalCredits();
  const max = meta.maxCredits;
  let major = 2;
  let sel = dept.required.length >= 3 ? 1 : 2;   // 교양필수가 3과목이면 선필교 1
  while (base + 3 * (major + sel) > max && sel > 0) sel--;
  while (base + 3 * (major + sel) > max && major > 0) major--;
  tour = { kind: 'plan', base, rec: { major, sel }, major, sel };
  renderTour();
  showTour();
}

function renderTour() {
  const t = tour;
  const max = meta.maxCredits;
  const total = planTotal(t);
  const counter = (key, label) => `
    <div class="tour__row">
      <span class="tour__label">${label}</span>
      <div class="tour__seg" role="group" aria-label="${label} 과목 수">
        ${[0, 1, 2].map((n) => {
          const over = planTotal(t, key === 'major' ? n : t.major, key === 'sel' ? n : t.sel) > max;
          return `<button class="${t[key] === n ? 'is-on' : ''} ${t.rec[key] === n ? 'is-rec' : ''}"
            data-n="${key}" data-v="${n}" ${over ? 'disabled' : ''} aria-pressed="${t[key] === n}">${n}</button>`;
        }).join('')}
        <span class="tour__unit">개</span>
      </div>
    </div>`;
  const status = total === max ? '딱 맞아요' : `${max - total}학점 남아요`;

  document.getElementById('tour-card').innerHTML = `
    <h2 class="tour__title" id="tour-title">${max}학점을 어떻게 채울까요?</h2>
    ${counter('major', '전공')}
    ${counter('sel', '선택 필수 교양')}
    <div class="tour__sum">
      <p class="tour__formula">전공 ${t.major}개 + 선택 필수 교양 ${t.sel}개</p>
      <p>교양필수 ${t.base} + 전공 ${t.major * 3} + 선필교 ${t.sel * 3}
        = <strong>${total}</strong> / ${max}학점
        <span class="${total === max ? 'is-ok' : ''}">${status}</span></p>
      ${max - total === 1 ? '<p class="tour__hint">보통 1학점은 대학생활 길라잡이, 사회봉사로 채워요!</p>' : ''}
    </div>
    <div class="tour__nav">
      <button class="btn btn--outline" data-tour-skip>건너뛰기</button>
      <button class="btn btn--primary" data-tour-go>이대로 시작하기</button>
    </div>`;
}

function applyTour() {
  const { major, sel } = tour;
  goal = { major, sel };
  closeTour();
  render();
  const todo = [sel && `선택 필수 교양 ${sel}과목`, major && `전공 ${major}과목`].filter(Boolean).join(', ');
  toast(todo ? `이제 ${todo}을 담아 보세요` : '시간표가 준비됐어요');
}

// 17학점이 되면 1학점 과목 안내 (겹치지 않는 분반이 있는 것만)
function maybeOneTip() {
  if (oneTipShown || tour || totalCredits() !== meta.maxCredits - 1) return;
  const ones = ONE_CREDIT.map(findCourse)
    .filter((c) => c && !pickOf(c.code) && sectionsFor(c).length)
    .map((course) => ({ course, section: sectionsFor(course).find((s) => !clashWith(s)) }));
  if (!ones.some((o) => o.section)) return;
  oneTipShown = true;
  tour = { kind: 'one', ones };
  const max = meta.maxCredits;
  document.getElementById('tour-card').innerHTML = `
    <h2 class="tour__title" id="tour-title">1학점만 더 담으면 ${max}학점이에요</h2>
    <p class="tour__desc">${max - 1}학점을 채웠어요. 1학점 과목을 하나 담아서 ${max}학점을 꽉 채워 보세요.</p>
    <div class="tour__picks">
      ${ones.map(({ course, section }) => `
        <button class="tour__pick" data-one-add="${course.code}" ${section ? '' : 'disabled'}>
          <span><b>${esc(shortName(course))}</b><small>1학점</small></span>
          <span class="tour__when">${section
            ? (section.times.length ? section.times.map((x) => `${DAYS[x.day]} ${hhmm(x.start)}~${hhmm(x.end)}`).join(', ') : section.online ? `온라인 ${esc(section.online)}` : '시간 미지정')
            : '시간이 겹쳐요'}</span>
        </button>`).join('')}
    </div>
    <div class="tour__nav">
      <button class="btn btn--outline" data-tour-skip>괜찮아요</button>
    </div>`;
  showTour();
}

document.getElementById('tour').addEventListener('click', (e) => {
  if (!tour) return;
  if (e.target.closest('[data-tour-skip]')) return closeTour();
  if (tour.kind === 'one') {
    const b = e.target.closest('[data-one-add]');
    if (!b || b.disabled) return;
    const o = tour.ones.find((x) => x.course.code === b.dataset.oneAdd);
    closeTour();
    add(o.course.code, secKey(o.section));
    if (pickOf(o.course.code)) toast(`'${shortName(o.course)}' 담았어요 · ${totalCredits()}학점 완성!`);
    return;
  }
  const n = e.target.closest('[data-n]');
  if (n && !n.disabled) {
    tour[n.dataset.n] = Number(n.dataset.v);
    return renderTour();
  }
  if (e.target.closest('[data-tour-go]')) return applyTour();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tour) closeTour();
});

document.getElementById('setup-opts').addEventListener('click', (e) => {
  if (e.target.closest('[data-skip]')) return advance(0);
  const opt = e.target.closest('.opt');
  if (!opt || opt.disabled) return;
  const slot = dept.required[step];
  picks = picks.filter((p) => !slot.codes.includes(p.code));
  picks.push({ code: opt.dataset.code, key: opt.dataset.key });
  renderSetup();
  advance(250);
});

document.getElementById('setup-prev').addEventListener('click', () => {
  clearTimeout(renderSetup.timer);
  if (step > 0) { step--; renderSetup(); }
});

// ===== 이벤트: 시간표 =====
document.getElementById('dept-btn').addEventListener('click', () => {
  document.getElementById('start').classList.remove('is-hidden');
});

// 시간표 + 과목 표를 한 장의 이미지로 저장
async function saveImage() {
  if (!picks.length) return toast('담은 과목이 없어요');
  if (!window.html2canvas) return toast('이미지 저장 기능을 불러오지 못했어요');
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = '저장 중…';

  // 화면 스크롤·접힘과 상관없이 전체를 그리도록 따로 만든 판에 복사해서 찍는다
  const board = document.createElement('div');
  board.className = 'export';
  board.innerHTML = `
    <div class="export__head">
      <strong>${esc(dept.name)} · ${esc(jy)}</strong>
      <span>2026학년도 1학기 · ${totalCredits()}학점</span>
    </div>
    <div class="export__body">
      <div class="export__tt"></div>
      <div class="export__table"></div>
    </div>`;
  board.querySelector('.export__tt').appendChild(document.getElementById('timetable').cloneNode(true));
  board.querySelector('.export__table').appendChild(document.querySelector('.summary__table').cloneNode(true));
  document.body.appendChild(board);
  fitBlocks(board);   // 이미지용 시간표는 더 크므로 글자 크기를 다시 맞춤
  try {
    const canvas = await html2canvas(board, { scale: 2, backgroundColor: '#ffffff' });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `시간표_${dept.name}_${jy}.png`;
    a.click();
  } catch (err) {
    console.error(err);
    toast('이미지를 만들지 못했어요');
  } finally {
    board.remove();
    btn.disabled = false;
    btn.textContent = '이미지 저장';
  }
}
document.getElementById('save-btn').addEventListener('click', saveImage);


// 휴대폰: 강의 / 시간표 화면 전환
function setView(view) {
  document.getElementById('planner').dataset.view = view;
  document.querySelectorAll('#mobile-tabs button').forEach((b) => b.classList.toggle('is-on', b.dataset.view === view));
  if (view === 'timetable') fitBlocks(document.getElementById('timetable'));  // 숨겨져 있던 동안엔 크기를 못 쟀으므로
  window.scrollTo(0, 0);
}
document.getElementById('mobile-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) setView(b.dataset.view);
});

// 창 크기가 바뀌면 블록 글자 크기를 다시 맞춤
let fitTimer;
window.addEventListener('resize', () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => fitBlocks(document.getElementById('timetable')), 150);
});

// 담은 과목 표: 오른쪽에서 밀려 나오는 패널
function setSummary(open) {
  document.querySelector('.summary').classList.toggle('is-open', open);
  const btn = document.getElementById('summary-btn');
  btn.classList.toggle('is-on', open);
  btn.setAttribute('aria-expanded', open);
  btn.textContent = open ? '과목 표 접기' : '과목 표 펼치기';
}
document.getElementById('summary-btn').addEventListener('click', () => {
  setSummary(!document.querySelector('.summary').classList.contains('is-open'));
});
setSummary(false);

document.getElementById('guide-btn').addEventListener('click', () => {
  renderGuide();
  document.getElementById('sheet').classList.remove('is-hidden');
});
document.getElementById('sheet').addEventListener('click', (e) => {
  if (e.target.id === 'sheet' || e.target.closest('#sheet-close')) {
    document.getElementById('sheet').classList.add('is-hidden');
  }
});

document.getElementById('tabs').addEventListener('click', async (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.remove('is-on'));
  tab.classList.add('is-on');
  category = tab.dataset.cat;
  filter = category === '전공' && hasOwnMajor() ? 'mine' : 'all';
  openCode = null;
  render();
  // 소속 트랙이 없는 학부(상상력인재학부)는 전체 학부의 1학년 전공을 불러옴
  if (category === '전공' && filter === 'all' && !allMajorsLoaded) {
    document.getElementById('course-list').innerHTML = '<li class="empty">전체 학부 강의를 불러오는 중…</li>';
    try { await loadAllMajors(); } catch (err) { toast(err.message); }
    renderList();
  }
});

document.getElementById('filter').addEventListener('change', (e) => {
  filter = e.target.value;
  openCode = null;
  renderList();
});

document.getElementById('search').addEventListener('input', (e) => {
  keyword = e.target.value.trim();
  renderList();
});

document.getElementById('course-list').addEventListener('click', (e) => {
  const addBtn = e.target.closest('[data-add]');
  if (addBtn) return add(addBtn.dataset.add, addBtn.dataset.key);
  const rm = e.target.closest('[data-remove]');
  if (rm) return remove(rm.dataset.remove);
  const row = e.target.closest('[data-open]');
  if (row) {
    openCode = openCode === row.dataset.open ? null : row.dataset.open;
    renderList();
  }
});

// 시간표 블록·표의 줄: 교양필수는 분반 다시 고르기, 나머지는 빼기
function onPickedClick(e) {
  const block = e.target.closest('[data-code]');
  if (!block) return;
  const code = block.dataset.code;
  const slot = slotOf(code);
  if (slot) return openSetup(dept.required.indexOf(slot), true);
  const name = findCourse(code).name;
  if (confirm(`'${name}'을(를) 시간표에서 뺄까요?`)) remove(code);
}
document.getElementById('timetable').addEventListener('click', onPickedClick);
document.getElementById('summary').addEventListener('click', onPickedClick);

init();
