"""지역 페이지 '실제로 받은 질문' 카드 생성: python3 tools/cases/render.py
cases.json의 각 지역(최신 3건)을 해당 index.html의 REAL 섹션 아래에 넣거나 교체한다."""
import json, re, html, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
data = json.load(open(os.path.join(ROOT, "tools/cases/cases.json"), encoding="utf-8"))
START, END = "<!-- cases:start -->", "<!-- cases:end -->"
for path, v in data.items():
    p = os.path.join(ROOT, path, "index.html"); s = open(p, encoding="utf-8").read()
    cs = sorted(v["cases"], key=lambda c: c["date"], reverse=True)[:3]
    e = html.escape
    cards = "".join(f'<div class="case"><h3>“{e(c["q"])}”</h3><p>{e(c["a"])}</p><span class="meta">{e(c["meta"])}</span></div>' for c in cs)
    months = sorted({c["date"] for c in cs})
    span = " · ".join(f'{y}년 ' + "·".join(f'{int(m[5:])}월' for m in months if m[:4] == y) for y in sorted({m[:4] for m in months}))
    block = (f'{START}\n   <h3 style="margin-top:44px;font-size:22px">{e(v["name"])}에서 실제로 받은 질문</h3>\n'
             f'   <div class="cases">{cards}</div>\n'
             f'   <p class="cases-note">{span} 실제 수거 기록에서 옮겼어요. 무게는 센터 계량 기준입니다.</p>\n   {END}\n')
    if START in s:
        s = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"\n", block, s, flags=re.S)
    else:
        s = re.sub(r'\n   <h3 style="margin-top:44px;font-size:22px">.*?<p class="cases-note">.*?</p>\n', "\n", s, flags=re.S)
        i = s.index('<section class="realsec">'); j = s.index('  </div>\n </section>', i)
        s = s[:j] + "   " + block + s[j:]
    s = re.sub(r'assets/style\.css\?v=\d+', 'assets/style.css?v=12', s)
    open(p, "w", encoding="utf-8").write(s)
    print("ok", path, len(cs))
