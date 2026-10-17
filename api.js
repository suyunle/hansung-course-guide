// 강의 데이터 API
// - 강의 목록: /api/courses 가 한성대 공개 강의시간표(시간표 및 수업계획서조회)를 실시간으로 조회해 준다.
//   (로컬: server.js / 배포: Vercel 함수 api/courses.js — 둘 다 lib/school.js 사용)
// - 학과 구성·교양필수 분반 배정·주야교차: 수강신청 안내/책자에서 뽑은 data/departments.json
const api = {
  // 학과 목록, 학과별 교양필수, 교양필수 분반 배정, 주야교차 여부
  async getMeta() {
    const res = await fetch('data/departments.json');
    if (!res.ok) throw new Error(`학과 정보를 불러오지 못했어요 (${res.status})`);
    return res.json();
  },

  // 한 학기·한 전공(또는 교양 분류)의 강의. 같은 요청은 한 번만 보낸다.
  _cache: new Map(),
  getCourses(term, major) {
    const key = `${term}|${major}`;
    if (!this._cache.has(key)) {
      const req = fetch(`/api/courses?term=${term}&major=${major}`)
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || `강의를 불러오지 못했어요 (${res.status})`);
          return body.courses;
        })
        .catch((err) => { this._cache.delete(key); throw err; });
      this._cache.set(key, req);
    }
    return this._cache.get(key);
  },
};

// 교양 분류 코드 (학교 시간표 조회의 '교양' 선택지)
const GYOYANG = { 교양필수: 'L11E', 선택필수교양: 'L11F', 일반교양: 'L11G' };
