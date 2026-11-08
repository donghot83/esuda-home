# 서울 구별 검색용 페이지 생성: python3 tools/make_gu_pages.py
import os,json,re
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE='https://esuda.kr/'
K='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.7c-.1.3.3.6.6.4l4.4-2.9c.4 0 .9.1 1.3.1 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>'
L='https://pf.kakao.com/_DxoHVG/chat'
def btn(pos,text,cls=''):
    return f'<a class="btn-kakao {cls}" href="{L}" target="_blank" rel="noopener" data-pos="{pos}">{K}<span>{text}</span></a>'
GU=[
('gangnam','강남구',['역삼동','삼성동','대치동','청담동','논현동','압구정동','신사동','도곡동','개포동','일원동','수서동','세곡동'],['seocho','songpa','seongdong']),
('gangdong','강동구',['천호동','성내동','길동','둔촌동','암사동','명일동','고덕동','상일동','강일동'],['songpa','gwangjin']),
('gangbuk','강북구',['미아동','번동','수유동','우이동','삼양동','송중동','인수동'],['dobong','nowon','seongbuk']),
('gangseo','강서구',['화곡동','등촌동','염창동','가양동','발산동','우장산동','방화동','공항동','마곡동'],['yangcheon','yeongdeungpo']),
('gwanak','관악구',['봉천동','신림동','남현동','서원동','낙성대동','청룡동','은천동','성현동'],['dongjak','geumcheon','seocho']),
('gwangjin','광진구',['구의동','자양동','화양동','군자동','중곡동','능동','광장동'],['seongdong','gangdong','jungnang']),
('guro','구로구',['구로동','신도림동','개봉동','고척동','오류동','가리봉동','항동','천왕동'],['geumcheon','yangcheon','yeongdeungpo']),
('geumcheon','금천구',['가산동','독산동','시흥동'],['guro','gwanak']),
('nowon','노원구',['상계동','중계동','하계동','공릉동','월계동'],['dobong','jungnang','gangbuk']),
('dobong','도봉구',['쌍문동','방학동','창동','도봉동'],['nowon','gangbuk']),
('dongdaemun','동대문구',['전농동','답십리동','장안동','청량리동','회기동','휘경동','이문동','용두동','제기동'],['jungnang','seongbuk','seongdong']),
('dongjak','동작구',['노량진동','상도동','흑석동','사당동','대방동','신대방동'],['gwanak','seocho','yeongdeungpo']),
('mapo','마포구',['공덕동','아현동','도화동','용강동','대흥동','염리동','신수동','서교동','합정동','망원동','연남동','성산동','상암동'],['seodaemun','yongsan','eunpyeong']),
('seodaemun','서대문구',['충현동','천연동','북아현동','신촌동','연희동','홍제동','홍은동','남가좌동','북가좌동'],['mapo','eunpyeong','jongno']),
('seocho','서초구',['서초동','잠원동','반포동','방배동','양재동','내곡동'],['gangnam','dongjak','gwanak']),
('seongdong','성동구',['왕십리동','행당동','응봉동','금호동','옥수동','성수동','사근동','마장동','송정동','용답동'],['gwangjin','dongdaemun','jung']),
('seongbuk','성북구',['성북동','삼선동','동선동','돈암동','안암동','보문동','정릉동','길음동','종암동','월곡동','장위동','석관동'],['gangbuk','dongdaemun','jongno']),
('songpa','송파구',['잠실동','신천동','풍납동','송파동','석촌동','삼전동','가락동','문정동','장지동','방이동','오금동','거여동','마천동'],['gangnam','gangdong']),
('yangcheon','양천구',['목동','신월동','신정동'],['gangseo','guro','yeongdeungpo']),
('yeongdeungpo','영등포구',['영등포동','여의도동','당산동','도림동','문래동','양평동','신길동','대림동'],['yangcheon','guro','dongjak','mapo']),
('yongsan','용산구',['후암동','용산동','남영동','청파동','원효로동','효창동','용문동','한강로동','이촌동','이태원동','한남동','서빙고동','보광동'],['jung','mapo','seongdong']),
('eunpyeong','은평구',['녹번동','불광동','갈현동','구산동','대조동','응암동','역촌동','신사동','증산동','수색동','진관동'],['seodaemun','mapo']),
('jongno','종로구',['청운효자동','사직동','삼청동','부암동','평창동','무악동','교남동','가회동','종로1·2·3·4가동','이화동','혜화동','창신동','숭인동'],['jung','seongbuk','seodaemun']),
('jung','중구',['소공동','회현동','명동','필동','장충동','광희동','을지로동','신당동','다산동','약수동','청구동','중림동','황학동'],['jongno','yongsan','seongdong']),
('jungnang','중랑구',['면목동','상봉동','중화동','묵동','망우동','신내동'],['dongdaemun','nowon','gwangjin']),
]
NAME={g[0]:g[1] for g in GU}
for slug,ko,dongs,near in GU:
    url=f'{BASE}seoul/{slug}/'
    short=ko[:-1] if len(ko)>2 else ko
    title=f'{ko} 헌옷수거 · {ko} 헌옷 방문수거 | 이수다'
    desc=f'서울 {ko} 헌옷수거는 이수다. {", ".join(dongs[:4])} 등 {ko} 전 지역 집 앞 방문수거. 15kg 이상 매입, 15kg 미만 무료 수거. 카톡으로 간편 신청.'
    kw=', '.join([f'{ko} 헌옷수거',f'{ko} 헌옷방문수거',f'{ko} 헌옷매입',f'{short} 헌옷수거']+[f'{d} 헌옷수거' for d in dongs[:8]])
    ld={"@context":"https://schema.org","@type":"LocalBusiness","name":"이수다","description":desc,"url":url,"image":BASE+"assets/og.png","areaServed":f"서울특별시 {ko}","sameAs":["https://pf.kakao.com/_DxoHVG"]}
    faqs=[(f'{ko} 어느 동네까지 오시나요?',f'{ko} 전 지역 방문합니다. 카톡으로 주소만 남겨주시면 일정 맞춰 찾아가요.'),('양이 적어도 와주시나요?','네. 15kg 미만도 무료로 수거합니다. 카톡으로 대략적인 양을 알려주세요.'),('얼마나 쳐주나요?','매입 단가는 시기마다 달라서 카톡으로 문의해 주시면 바로 안내해 드립니다.')]
    faqld={"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}} for q,a in faqs]}
    faqh=''.join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q,a in faqs)
    chips=''.join(f'<li>{d}</li>' for d in dongs)
    nearh=''.join(f'<a href="../{n}/">{NAME[n]} 헌옷수거</a>' for n in near)
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
<link rel="icon" href="../../assets/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="../../assets/apple-touch-icon.png">
<meta name="theme-color" content="#ffffff">
<script type="application/ld+json">{json.dumps(ld,ensure_ascii=False)}</script>
<script type="application/ld+json">{json.dumps(faqld,ensure_ascii=False)}</script>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="../../assets/style.css?v=8">
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
  {btn("gu-"+slug+"-header","카톡 간편 신청","btn-sm")}
 </div>
</header>
<main>
 <section class="rhero">
  <div class="wrap inner">
   <div>
    <div class="crumb"><a href="../../">이수다</a> › <a href="../">서울</a> › {ko}</div>
    <h1>{ko} 헌옷수거,<br><span class="mk">무겁게 들고</span> <span class="bd">나가지 마세요.</span></h1>
    <p>{ko} 어디든 집 앞으로 찾아가 무게 재고 가져갑니다.<br>15kg 이상은 매입, 15kg 미만도 무료 수거.</p>
    {btn("gu-"+slug+"-hero","카톡 간편 신청하기","btn-lg")}
   </div>
   <img class="map" src="../../assets/img/area-seoul.webp" alt="서울 {ko} 헌옷수거" width="360" height="360">
  </div>
 </section>
 <section>
  <div class="wrap">
   <span class="label">AREA</span>
   <h2><span class="lt">{ko} 전 지역,</span><br><span class="mk">집 앞까지</span> <span class="bd">찾아가요</span></h2>
   <p class="lead">아래 동네 외에도 {ko} 어디든 카톡으로 주소만 남겨주세요.</p>
   <ul class="dong">{chips}</ul>
  </div>
 </section>
 <section style="background:var(--bg)">
  <div class="wrap">
   <span class="label">HOW TO</span>
   <h2><span class="lt">{ko} 헌옷수거,</span><br><span class="bd">이렇게 진행돼요</span></h2>
   <p class="lead">카톡으로 신청하고, 집 앞에서 편하게.</p>
   <div class="steps">
    <div class="step"><span class="n">STEP 1</span><img src="../../assets/img/step-apply.webp" alt="" width="400" height="400"><h3>카톡 신청</h3><p>주소와 대략적인 양을 남겨주세요.</p></div>
    <div class="step"><span class="n">STEP 2</span><img src="../../assets/img/step-schedule.webp" alt="" width="400" height="400"><h3>날짜 약속</h3><p>편하신 날에 맞춰 일정을 잡아요.</p></div>
    <div class="step"><span class="n">STEP 3</span><img src="../../assets/img/step-pickup.webp" alt="" width="400" height="400"><h3>방문 수거</h3><p>{ko} 집 앞으로 직접 찾아가요.</p></div>
    <div class="step"><span class="n">STEP 4</span><img src="../../assets/img/step-weigh.webp" alt="" width="400" height="400"><h3>계량 · 정산</h3><p>15kg 이상이면 매입 금액을 정산해요.</p></div>
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
     <p>주소와 대략적인 양만 보내주시면 됩니다.</p>
     {btn("gu-"+slug+"-band","카톡 간편 신청하기","btn-lg")}
     <div class="more">{nearh}<a href="../">서울 전체</a></div>
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
   <div class="fnav"><a href="../../gimpo/">김포 헌옷수거</a><a href="../../ilsan/">일산 헌옷수거</a><a href="../">서울 헌옷수거</a></div>
   <div class="ext"><a href="https://pf.kakao.com/_DxoHVG" target="_blank" rel="noopener">카카오채널 이수다</a></div>
  </div>
  <div class="copy"><b>이수다무역</b>서울 · 일산 · 김포 헌옷 방문수거 · 헌옷 매입</div>
 </div>
</footer>
<div class="fixed">{btn("gu-"+slug+"-fixed","카톡 간편 신청하기")}</div>
</body>
</html>
'''
    os.makedirs(f'{R}/seoul/{slug}',exist_ok=True)
    open(f'{R}/seoul/{slug}/index.html','w',encoding='utf-8').write(html)
# 서울 페이지의 구 목록을 구 페이지 링크로
sp=f'{R}/seoul/index.html'; s=open(sp,encoding='utf-8').read()
for slug,ko,_,_ in GU:
    s=s.replace(f'<li>{ko}</li>',f'<li><a href="{slug}/">{ko}</a></li>')
if '.dong li a' not in s:
    s=s.replace('</style>','.dong li a{display:block}\n.dong li:has(a):hover{border-color:var(--green);color:var(--green)}\n</style>',1)
open(sp,'w',encoding='utf-8').write(s)
# sitemap
urls=['','gimpo/','ilsan/','seoul/']+[f'seoul/{g[0]}/' for g in GU]
sm='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+''.join(f'  <url><loc>{BASE}{u}</loc><lastmod>2026-11-07</lastmod></url>\n' for u in urls)+'</urlset>\n'
open(f'{R}/sitemap.xml','w').write(sm)
print(len(GU),'pages')
