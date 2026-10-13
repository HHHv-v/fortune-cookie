# 우연놀이-포춘쿠키

인터랙티브 미디어 창작 · 우연놀이(알레아) 참여 작품.
관객이 다음 사람에게 건넬 한 줄을 넣고, 다른 사람이 넣은 한 줄을 포춘쿠키로 무작위로 꺼냅니다.

## 구조
- `index.html` — 화면 (넣기 → 깨기)
- `api/cookies.js` — Vercel 서버리스 함수. 쿠키 저장·개수·무작위 뽑기
- 저장소: Upstash Redis (Vercel Marketplace, 무료 플랜)

## 내 문장이 나에게 돌아오지 않는 방법
로그인 없이, 처음 접속할 때 브라우저마다 무작위 방문자 ID를 만들어 저장합니다.
쿠키에 그 ID를 함께 기록하고, 뽑을 때 같은 ID로 넣은 쿠키는 모두 제외합니다.
- 한 기기를 여러 사람이 돌려 쓸 때는 주소 끝에 `#shared`를 붙이세요. 방금 넣은 한 줄만 제외됩니다.

## 배포
1. 이 폴더를 GitHub 레포(`fortune-cookie`)로 올립니다.
2. Vercel → Add New → Project → 레포 선택 → Deploy (설정 변경 없음).
3. Vercel 프로젝트 → Storage → Upstash(Redis) → Create → 프로젝트에 Connect.
4. Deployments → 최신 배포 → Redeploy (환경변수 반영).

## 항아리 비우기
Upstash 콘솔의 Data Browser에서 `fortune:cookies` 키를 삭제하면 됩니다.
