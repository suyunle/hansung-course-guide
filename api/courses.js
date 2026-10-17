// Vercel 서버리스 함수: GET /api/courses?term=20261&major=V021
const { getCourses, validParams } = require('../lib/school');

module.exports = async (req, res) => {
  const { term, major } = req.query;
  if (!validParams(term, major)) {
    return res.status(400).json({ error: '학기(term)와 전공(major) 코드가 필요해요.' });
  }
  try {
    const courses = await getCourses(term, major);
    // CDN에 6시간 캐시 → 학교 서버로 가는 요청을 줄인다
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ courses });
  } catch (err) {
    console.error('[courses]', err.message);
    return res.status(503).json({ error: '학교 강의시간표를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
};
