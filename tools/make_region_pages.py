import os,json
PH=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'real_photos.json'),encoding='utf-8'))
R='/home/user/esuda-home'
BASE='https://esuda.kr/'
K='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.7c-.1.3.3.6.6.4l4.4-2.9c.4 0 .9.1 1.3.1 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>'
L='https://bit.ly/4zygKTw'
def btn(pos,text,cls=''):
    return f'<a class="btn-kakao {cls}" href="{L}" target="_blank" rel="noopener" data-pos="{pos}">{K}<span>{text}</span></a>'
regions=[
 dict(slug='gimpo',ko='김포',map='area-gimpo',full='김포시',
  sub='김포시 전 지역 헌옷 방문수거',
  areas=['고촌읍','풍무동','사우동','북변동','걸포동','감정동','장기동','운양동','구래동','마산동','양촌읍','통진읍','대곶면','월곶면','하성면'],
  lead='한강신도시부터 고촌·풍무, 통진·양촌까지 김포 어디든 수거일에 문 앞에 두시면 됩니다.',
  faq=[('김포 어느 동네까지 오시나요?','김포시 전 지역 방문합니다. 카톡으로 주소만 남겨주시면 수거일에 맞춰 문 앞에서 가져가요.')]),
 dict(slug='ilsan',ko='일산',map='area-ilsan',full='고양시 일산',
  sub='일산동구 · 일산서구 헌옷 방문수거',
  areas=['식사동','중산동','정발산동','풍산동','백석동','마두동','장항동','고봉동','일산동','탄현동','주엽동','대화동','송포동','송산동'],
  lead='일산동구와 일산서구, 아파트 단지부터 주택가까지 수거일에 문 앞에 두시면 됩니다.',
  faq=[('일산 어느 동네까지 오시나요?','일산동구·일산서구 전 지역 방문합니다. 카톡으로 주소만 남겨주시면 수거일에 맞춰 문 앞에서 가져가요.')]),
 dict(slug='seoul',ko='서울',map='area-seoul',full='서울',
  sub='서울 25개 구 헌옷 방문수거',
  areas=['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구'],
  lead='강남·송파부터 마포·은평, 노원·도봉까지 서울 전 지역 수거일에 문 앞에 두시면 됩니다.',
  faq=[('서울 어느 구까지 오시나요?','서울 25개 구 모두 방문합니다. 카톡으로 주소만 남겨주시면 수거일에 맞춰 문 앞에서 가져가요.')]),
]
for r in regions:
    s=r['slug'];ko=r['ko']
    _k=s
    url=BASE+s+'/'
    title=f'{ko} 헌옷수거 · 헌옷 방문수거 · 헌옷 매입 | 이수다'
    desc=f"{r['full']} 헌옷수거는 이수다. {ko} 전 지역 문 앞 비대면 방문수거, 15kg 이상 매입·15kg 미만 무료 수거. 카톡으로 간편 신청하세요."
    kw=', '.join([f'{ko} 헌옷수거',f'{ko} 헌옷방문수거',f'{ko} 헌옷매입',f'{ko} 옷 수거']+[f'{a} 헌옷수거' for a in r['areas'][:10]])
    ld={"@context":"https://schema.org","@type":"LocalBusiness","name":"이수다","description":desc,"url":url,"image":BASE+"assets/og.png","areaServed":r['full'],"sameAs":["https://pf.kakao.com/_DxoHVG"]}
    others=' '.join(f'<a href="../{o["slug"]}/">{o["ko"]} 헌옷수거</a>' for o in regions if o['slug']!=s)
    chips=''.join(f'<li>{a}</li>' for a in r['areas'])
    faqs=r['faq']+[(f'{ko} 수거일은 언제인가요?',f'{ko}는 지역별 수거일 저녁 7시~새벽 6시 사이에 비대면으로 가져가요. 희망 날짜를 알려 주시면 가까운 수거일로 잡아 드려요.'),('15kg이 안 되어도 수거하나요?','네. 15kg 미만도 무료로 수거해요. 양이 적어도 편하게 신청하세요.'),('헌옷 매입 가격은 얼마인가요?','매입 가격은 수출 시세에 따라 달라져요. 카카오채널로 문의하시면 현재 기준을 바로 안내해 드려요.'),('어떻게 담아서 내놓으면 되나요?','집에 있는 비닐, 박스, 쇼핑백 어디에 담아도 괜찮아요. 젖거나 심하게 오염된 옷은 수거가 어려워요.'),('입금은 언제 되나요?','센터에서 고객별로 따로 계량하고, 약 3일 안에 계량 사진과 함께 계좌로 입금해 드려요.')]
    caps=PH.get(_k)
    photoh=('' if not caps else f'''
 <section class="realsec">
  <div class="wrap">
   <span class="label">REAL</span>
   <h2><span class="lt">{ko}에서</span> <span class="bd">실제로 수거한 모습</span></h2>
   <p class="lead">문 앞에서 가져와 센터에서 따로 계량합니다.</p>
   <div class="real">'''+''.join(f'<figure><img src="../assets/img/real/{_k}-{i+1}.webp" alt="{ko} 헌옷수거 실제 사진 - {c}" loading="lazy"><figcaption>{c}</figcaption></figure>' for i,c in enumerate(caps))+'''</div>
  </div>
 </section>''')
    faqh=''.join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q,a in faqs)
    faqld={"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}} for q,a in faqs]}
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
<meta property="og:title" content="{ko} 헌옷수거 | 이수다">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{BASE}assets/og.png">
<meta property="og:url" content="{url}">
<link rel="icon" href="../assets/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">
<meta name="theme-color" content="#ffffff">
<script type="application/ld+json">{json.dumps(ld,ensure_ascii=False)}</script>
<script type="application/ld+json">{json.dumps(faqld,ensure_ascii=False)}</script>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="../assets/style.css?v=11">
<style>
.rhero{{padding:150px 0 90px;background:linear-gradient(180deg,#fff 0%,var(--bg) 100%)}}
.rhero .inner{{display:grid;grid-template-columns:1.2fr .8fr;gap:32px;align-items:center}}
.rhero h1{{font-size:clamp(38px,5.4vw,68px);line-height:1.2;letter-spacing:-.055em;font-weight:300}}
.rhero p{{margin:20px 0 34px;color:var(--sub);font-size:clamp(16px,1.9vw,19px)}}
.rhero .map{{width:100%;max-width:380px;justify-self:center;mix-blend-mode:multiply}}
.crumb{{font-size:14px;color:var(--sub);margin-bottom:18px}}
.crumb a{{text-decoration:underline}}
.dong{{list-style:none;display:flex;flex-wrap:wrap;gap:10px}}
.dong li{{background:#fff;border:1px solid var(--line);border-radius:999px;padding:10px 18px;font-size:16px;font-weight:600}}
.more{{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}}
.more a{{border:1px solid var(--line);border-radius:999px;padding:10px 18px;font-weight:600;font-size:15px;background:#fff}}
.more a:hover{{border-color:var(--green);color:var(--green)}}
section[style] .step{{background:#fff}}
@media(max-width:860px){{.rhero{{padding:104px 0 64px}}.rhero .inner{{grid-template-columns:1fr}}.rhero .map{{order:-1;max-width:200px}}}}
</style>
</head>
<body>
<header id="hd" class="solid">
 <div class="wrap">
  <a class="logo" href="../" aria-label="이수다 홈"><img class="dk" src="../assets/logo.png" alt="이수다" width="600" height="211"></a>
  <nav><a href="../#how">이용 방법</a><a href="../#price">매입 기준</a><a href="../#area">수거 지역</a><a href="../#items">수거 품목</a><a href="../#faq">자주 묻는 질문</a></nav>
  {btn(s+"-header","카톡 간편 신청","btn-sm")}
 </div>
</header>
<main>
 <section class="rhero">
  <div class="wrap inner">
   <div>
    <div class="crumb"><a href="../">이수다</a> › 수거 지역 › {ko}</div>
    <h1>{ko} 헌옷수거,<br><span class="mk">무겁게 들고</span><br><span class="bd">나가지 마세요.</span></h1>
    <p>{r['lead']}<br>15kg 이상 매입 · 15kg 미만 무료 수거</p>
    {btn(s+"-hero","카톡 간편 신청하기","btn-lg")}
   </div>
   <img class="map" src="../assets/img/{r['map']}.webp" alt="{ko} 헌옷수거 지역" width="360" height="360">
  </div>
 </section>

 <section>
  <div class="wrap">
   <span class="label">AREA</span>
   <h2><span class="lt">{r['sub']},</span><br><span class="mk">집 앞까지</span> <span class="bd">찾아가요</span></h2>
   <p class="lead">{'·'.join(r['areas'][:3])}부터 {r['areas'][-1]}까지, 아파트·빌라·주택 어디든 카톡으로 주소만 남겨주세요.</p>
   <ul class="dong">{chips}</ul>
  </div>
 </section>{photoh}

 <section style="background:var(--bg)">
  <div class="wrap">
   <span class="label">HOW TO</span>
   <h2><span class="lt">{ko} 헌옷수거,</span><br><span class="bd">이렇게 진행돼요</span></h2>
   <p class="lead">카톡으로 신청하고, 집 앞에서 편하게.</p>
   <div class="steps">
    <div class="step"><span class="n">STEP 1</span><img src="../assets/img/step-apply.webp" alt="" width="400" height="400"><h3>카톡 신청</h3><p>주소와 대략적인 양을 남겨주세요.</p></div>
    <div class="step"><span class="n">STEP 2</span><img src="../assets/img/step-schedule.webp" alt="" width="400" height="400"><h3>일정 조율</h3><p>가까운 {ko} 수거일로 잡아 드려요.</p></div>
    <div class="step"><span class="n">STEP 3</span><img src="../assets/img/step-pickup.webp" alt="" width="400" height="400"><h3>비대면 수거</h3><p>문 앞에 두시면 저녁~새벽 사이 가져가요.</p></div>
    <div class="step"><span class="n">STEP 4</span><img src="../assets/img/step-weigh.webp" alt="" width="400" height="400"><h3>계량 · 입금</h3><p>센터에서 계량 후 약 3일 안에 입금해요.</p></div>
   </div>
  </div>
 </section>

 <section>
  <div class="wrap">
   <div class="center">
    <span class="label">FAQ</span>
    <h2><span class="lt">{ko} 헌옷수거,</span> <span class="bd">자주 묻는 질문</span></h2>
    <p class="lead">더 궁금한 건 카톡으로 편하게 물어보세요.</p>
   </div>
   <div class="faq">{faqh}</div>
  </div>
 </section>

 <section class="band">
  <div class="wrap">
   <div class="card">
    <div>
     <h2><span class="lt">{ko} 옷장 정리,</span><br><span class="bd">오늘 카톡 한 번으로</span></h2>
     <p>주소와 대략적인 수거량만 보내주시면 됩니다.</p>
     {btn(s+"-band","카톡 간편 신청하기","btn-lg")}
     <div class="more" style="margin-top:28px">{others.replace('<a ','<a style="background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.3);color:#fff" ')}</div>
    </div>
    <div class="tile"><img src="../assets/icon.png" alt="" width="512" height="581"></div>
   </div>
  </div>
 </section>
</main>
<footer>
 <div class="wrap">
  <div class="top">
   <a class="logo" href="../"><img src="../assets/logo-white.png" alt="이수다" width="600" height="211"></a>
   <div class="fnav"><a href="../gimpo/">김포 헌옷수거</a><a href="../ilsan/">일산 헌옷수거</a><a href="../seoul/">서울 헌옷수거</a></div>
   <div class="ext"><a href="https://pf.kakao.com/_DxoHVG" target="_blank" rel="noopener">카카오채널 이수다</a></div>
  </div>
  <div class="copy"><b>이수다무역 | ESUDA TRADE</b>다시 입을 수 있는 옷, 다음 쓰임으로 연결합니다.</div>
 </div>
</footer>
<div class="fixed">{btn(s+"-fixed","카톡 간편 신청하기")}</div>
</body>
</html>
'''
    os.makedirs(f'{R}/{s}',exist_ok=True)
    open(f'{R}/{s}/index.html','w',encoding='utf-8').write(html)
# sitemap
urls=['']+[r['slug']+'/' for r in regions]
sm='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+''.join(f'  <url><loc>{BASE}{u}</loc><lastmod>2026-11-12</lastmod></url>\n' for u in urls)+'</urlset>\n'
open(f'{R}/sitemap.xml','w').write(sm)
print('ok')
