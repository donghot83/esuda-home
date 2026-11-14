# assets/apply-rules.js → server/apps-script/Rules.gs 복사 (규칙을 한 곳에서만 고치기 위해)
# 사용: python tools/sync_rules.py
import os
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(R, 'assets', 'apply-rules.js')
dst = os.path.join(R, 'server', 'apps-script', 'Rules.gs')
body = open(src, encoding='utf-8').read()
head = '// 자동 생성 파일: assets/apply-rules.js 를 고친 뒤 tools/sync_rules.py 로 다시 만든다. 직접 고치지 말 것.\n'
open(dst, 'w', encoding='utf-8', newline='\n').write(head + body)
print('synced', dst)
