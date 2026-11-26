# 일산·김포 동별(아파트 단지 위주) 검색용 페이지 생성
# 순서: make_region_pages.py → make_gu_pages.py → make_dong_pages.py
import os,json,re
D=os.path.dirname(os.path.abspath(__file__))
PH=json.load(open(os.path.join(D,'real_photos.json'),encoding='utf-8'))
R=os.path.dirname(D)
BASE='https://esuda.kr/'
K='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.7c-.1.3.3.6.6.4l4.4-2.9c.4 0 .9.1 1.3.1 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>'
L='https://pf.kakao.com/_DxoHVG/chat'
def btn(pos,text,cls=''):
    return f'<a class="btn-kakao {cls}" href="{L}" target="_blank" rel="noopener" data-pos="{pos}">{K}<span>{text}</span></a>'
# (부모, 부모이름, 시, 구, 동 slug, 동 이름, 주변 표지, 이웃 동 slug)
P={'ilsan':('일산','고양시'),'gimpo':('김포','김포시')}
DONG=[
('ilsan','일산서구','juyeop','주엽동',['주엽역','일산 호수공원','강선마을·문촌마을 단지'],['daehwa','madu','tanhyeon']),
('ilsan','일산서구','daehwa','대화동',['대화역','킨텍스','성저마을·장성마을 단지'],['juyeop','janghang']),
('ilsan','일산서구','tanhyeon','탄현동',['탄현역','탄현마을 단지'],['juyeop','daehwa']),
('ilsan','일산동구','madu','마두동',['마두역','강촌마을·백마마을 단지'],['baekseok','janghang','juyeop']),
('ilsan','일산동구','baekseok','백석동',['백석역','흰돌마을·백송마을 단지'],['madu','siksa']),
('ilsan','일산동구','janghang','장항동',['정발산역','라페스타·웨스턴돔','일산 호수공원'],['madu','daehwa','baekseok']),
('ilsan','일산동구','siksa','식사동',['위시티 단지'],['baekseok','madu']),
('gimpo','김포시','pungmu','풍무동',['풍무역','풍무동 아파트 단지'],['sau','geolpo']),
('gimpo','김포시','sau','사우동',['사우역','김포시청 주변 단지'],['pungmu','geolpo']),
('gimpo','김포시','geolpo','걸포동',['걸포북변역','걸포동 아파트 단지'],['sau','unyang']),
('gimpo','김포시','unyang','운양동',['운양역','한강신도시 운양 단지'],['janggi','geolpo']),
('gimpo','김포시','janggi','장기동',['장기역','한강신도시 중심 상가','라베니체'],['unyang','gurae']),
('gimpo','김포시','gurae','구래동',['구래역','한강신도시 구래 단지'],['janggi','masan']),
('gimpo','김포시','masan','마산동',['마산역','한강신도시 마산 단지'],['gurae','janggi']),
]
NAME={d[2]:d[3] for d in DONG}
HOUR='저녁 7시~새벽 4시'
for par,gu,slug,ko,marks,near in DONG:
    pko,city=P[par]
    url=f'{BASE}{par}/{slug}/'
    short=ko[:-1]
    title=f'{pko} {ko} 헌옷수거 · {ko} 헌옷 방문수거 | 이수다'
    desc=f'{city} {gu} {ko} 헌옷수거는 이수다. {", ".join(marks)} 주변 아파트 문 앞 비대면 방문수거. 15kg 이상 매입, 15kg 미만 무료 수거. 카톡으로 간편 신청.'
    kw=', '.join([f'{ko} 헌옷수거',f'{pko} {ko} 헌옷수거',f'{short} 헌옷수거',f'{ko} 헌옷방문수거',f'{ko} 헌옷매입',f'{pko} 헌옷수거'])
    ld={"@context":"https://schema.org","@type":"LocalBusiness","name":"이수다","description":desc,"url":url,"image":BASE+"assets/og.png","areaServed":f"{city} {gu} {ko}","sameAs":["https://pf.kakao.com/_DxoHVG","https://blog.naver.com/esudakorea01"]}
    nearko='·'.join(NAME[n] for n in near)
    intro=f'{ko} {"·".join(marks)} 주변 아파트 단지, 수거일에 현관문 앞에 봉투만 두시면 됩니다. 이웃한 {nearko}도 같은 방식으로 수거합니다.'
    faqs=[(f'{ko} 아파트도 문 앞에서 가져가나요?',f'네. {", ".join(marks)} 주변 {ko} 아파트는 현관문 앞에 두시면 비대면으로 가져가요. 공동현관 출입 방법만 카톡으로 알려 주세요.'),
          (f'{ko} 수거일은 언제인가요?',f'{pko} 지역 수거일 {HOUR} 사이에 비대면으로 가져가요. 희망 날짜를 알려 주시면 가까운 수거일로 잡아 드려요.'),
          ('15kg이 안 되어도 수거하나요?','네. 15kg 미만도 무료로 수거해요. 양이 적어도 편하게 신청하세요.'),
          ('헌옷 매입 가격은 얼마인가요?','매입 가격은 수출 시세에 따라 달라져요. 카카오채널로 문의하시면 현재 기준을 바로 안내해 드려요.'),
          ('입금은 언제 되나요?','센터에서 고객별로 따로 계량하고, 약 3일 안에 계량 사진과 함께 계좌로 입금해 드려요.')]
    faqld={"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}} for q,a in faqs]}
    caps=PH.get(par)
    photoh=('' if not caps else f'''
 <section class="realsec">
  <div class="wrap">
   <span class="label">REAL</span>
   <h2><span class="lt">{pko}에서</span> <span class="bd">실제로 수거한 모습</span></h2>
   <p class="lead">문 앞에서 가져와 센터에서 따로 계량합니다.</p>
   <div class="real">'''+''.join(f'<figure><img src="../../assets/img/real/{par}-{i+1}.webp" alt="{pko} 헌옷수거 실제 사진 - {c}" loading="lazy"><figcaption>{c}</figcaption></figure>' for i,c in enumerate(caps))+'''</div>
  </div>
 </section>''')
    faqh=''.join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q,a in faqs)
    chips=''.join(f'<li>{m}</li>' for m in marks)
    nearh=''.join(f'<a href="../{n}/">{NAME[n]} 헌옷수거</a>' for n in near)
    pos=f'dong-{slug}'
    html=f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="keywords" content="{kw}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:title" content="{pko} {ko} 헌옷수거 | 이수다">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{BASE}assets/og.png">
<meta property="og:url" content="{url}">
<link rel="icon" href="../../assets/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="../../assets/apple-touch-icon.png">
<meta name="theme-color" content="#ffffff">
<script type="application/ld+json">{json.dumps(ld,ensure_ascii=False)}</script>
<script type="application/ld+json">{json.dumps(faqld,ensure_ascii=False)}</script>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="../../assets/style.css?v=11">
<style>
.rhero{{padding:150px 0 90px;background:linear-gradient(180deg,#fff 0%,var(--bg) 100%)}}
.rhero .inner{{display:grid;grid-template-columns:1.2fr .8fr;gap:32px;align-items:center}}
.rhero h1{{font-size:clamp(38px,5.4vw,68px);line-height:1.2;letter-spacing:-.055em;font-weight:300}}
.rhero p{{margin:20px 0 34px;color:var(--sub);font-size:clamp(16px,1.9vw,19px)}}
.rhero .map{{width:100%;max-width:340px;justify-self:center;mix-blend-mode:multiply}}
.crumb{{font-size:14px;color:var(--sub);margin-bottom:18px}}
.crumb a{{text-decoration:underline}}
.dong{{list-style:none;display:flex;flex-wrap:wrap;gap:10px}}
.dong li{{background:#fff;border:1px solid var(--line);border-radius:999px;padding:10px 18px;font-size:16px;font-weight:600}}
.more{{display:flex;gap:10px;flex-wrap:wrap;margin-top:28px}}
.more a{{border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;border-radius:999px;padding:9px 16px;font-weight:600;font-size:14px}}
section[style] .step{{background:#fff}}
@media(max-width:860px){{.rhero{{padding:104px 0 64px}}.rhero .inner{{grid-template-columns:1fr}}.rhero .map{{order:-1;max-width:180px}}}}
</style>
</head>
<body>
<header id="hd" class="solid">
 <div class="wrap">
  <a class="logo" href="../../" aria-label="이수다 홈"><img class="dk" src="../../assets/logo.png" alt="이수다" width="600" height="211"></a>
  <nav><a href="../../#how">이용 방법</a><a href="../../#price">매입 기준</a><a href="../../#items">수거 품목</a><a href="../../#faq">자주 묻는 질문</a></nav>
  {btn(pos+"-header","카톡 간편 신청","btn-sm")}
 </div>
</header>
<main>
 <section class="rhero">
  <div class="wrap inner">
   <div>
    <div class="crumb"><a href="../../">이수다</a> › <a href="../">{pko}</a> › {ko}</div>
    <h1>{ko} 헌옷수거,<br><span class="mk">무겁게 들고</span><br><span class="bd">나가지 마세요.</span></h1>
    <p>{pko} {ko} 아파트, 카톡으로 신청하면 문 앞에서 비대면으로 수거합니다.<br>15kg 이상 매입 · 15kg 미만 무료 수거</p>
    {btn(pos+"-hero","카톡 간편 신청하기","btn-lg")}
   </div>
   <img class="map" src="../../assets/img/area-{par}.webp" alt="{pko} {ko} 헌옷수거" width="360" height="360">
  </div>
 </section>
 <section>
  <div class="wrap">
   <span class="label">AREA</span>
   <h2><span class="lt">{ko} 아파트,</span><br><span class="mk">문 앞까지</span> <span class="bd">찾아가요</span></h2>
   <p class="lead">{intro}</p>
   <ul class="dong">{chips}</ul>
  </div>
 </section>{photoh}
 <section style="background:var(--bg)">
  <div class="wrap">
   <span class="label">HOW TO</span>
   <h2><span class="lt">{ko} 헌옷수거,</span><br><span class="bd">이렇게 진행돼요</span></h2>
   <p class="lead">카톡으로 신청하고, 집 앞에서 편하게.</p>
   <div class="steps">
    <div class="step"><span class="n">STEP 1</span><img src="../../assets/img/step-apply.webp" alt="" width="400" height="400"><h3>카톡 신청</h3><p>주소와 대략적인 양을 남겨주세요.</p></div>
    <div class="step"><span class="n">STEP 2</span><img src="../../assets/img/step-schedule.webp" alt="" width="400" height="400"><h3>일정 조율</h3><p>가까운 {pko} 수거일로 잡아 드려요.</p></div>
    <div class="step"><span class="n">STEP 3</span><img src="../../assets/img/step-pickup.webp" alt="" width="400" height="400"><h3>비대면 수거</h3><p>문 앞에 두시면 저녁~새벽 사이 가져가요.</p></div>
    <div class="step"><span class="n">STEP 4</span><img src="../../assets/img/step-weigh.webp" alt="" width="400" height="400"><h3>계량 · 입금</h3><p>센터에서 계량 후 약 3일 안에 입금해요.</p></div>
   </div>
  </div>
 </section>
 <section>
  <div class="wrap">
   <div class="center"><span class="label">FAQ</span><h2><span class="lt">{ko} 헌옷수거,</span> <span class="bd">자주 묻는 질문</span></h2><p class="lead">더 궁금한 건 카톡으로 편하게 물어보세요.</p></div>
   <div class="faq">{faqh}</div>
  </div>
 </section>
 <section class="band">
  <div class="wrap">
   <div class="card">
    <div>
     <h2><span class="lt">{ko} 옷장 정리,</span><br><span class="bd">오늘 카톡 한 번으로</span></h2>
     <p>주소와 대략적인 수거량만 보내주시면 됩니다.</p>
     {btn(pos+"-band","카톡 간편 신청하기","btn-lg")}
     <div class="more">{nearh}<a href="../">{pko} 전체</a></div>
    </div>
    <div class="tile"><img src="../../assets/icon.png" alt="" width="512" height="581"></div>
   </div>
  </div>
 </section>
</main>
<footer>
 <div class="wrap">
  <div class="top">
   <a class="logo" href="../../"><img src="../../assets/logo-white.png" alt="이수다" width="600" height="211"></a>
   <div class="fnav"><a href="../../gimpo/">김포 헌옷수거</a><a href="../../ilsan/">일산 헌옷수거</a><a href="../../seoul/">서울 헌옷수거</a></div>
   <div class="ext"><a href="https://pf.kakao.com/_DxoHVG" target="_blank" rel="noopener">카카오채널 이수다</a></div>
  </div>
  <div class="copy"><b>이수다무역 | ESUDA TRADE</b>다시 입을 수 있는 옷, 다음 쓰임으로 연결합니다.</div>
 </div>
</footer>
<div class="fixed">{btn(pos+"-fixed","카톡 간편 신청하기")}</div>
</body>
</html>
'''
    os.makedirs(f'{R}/{par}/{slug}',exist_ok=True)
    open(f'{R}/{par}/{slug}/index.html','w',encoding='utf-8').write(html)
# 일산·김포 페이지의 동 목록을 동 페이지 링크로
for par in P:
    sp=f'{R}/{par}/index.html'; s=open(sp,encoding='utf-8').read()
    for p2,_,slug,ko,_,_ in DONG:
        if p2==par: s=s.replace(f'<li>{ko}</li>',f'<li><a href="{slug}/">{ko}</a></li>')
    if '.dong li a' not in s:
        s=s.replace('</style>','.dong li a{display:block}\n.dong li:has(a):hover{border-color:var(--green);color:var(--green)}\n</style>',1)
    open(sp,'w',encoding='utf-8').write(s)
# sitemap에 추가
smp=f'{R}/sitemap.xml'; sm=open(smp).read()
add=''.join(f'  <url><loc>{BASE}{d[0]}/{d[2]}/</loc><lastmod>2026-11-26</lastmod></url>\n' for d in DONG if f'{BASE}{d[0]}/{d[2]}/' not in sm)
open(smp,'w').write(sm.replace('</urlset>',add+'</urlset>'))
print(len(DONG),'dong pages')
