# 시니컬경마 복기자료실

분석 HTML은 Cloudflare R2에 보관하고, 경주 목록과 결과 연결 정보는 D1에 저장합니다. 기존 시니컬.kr(Railway)과 분리된 사이트입니다.

## 자료가 들어오는 흐름

1. 분석 HTML을 시니컬.kr에 공개 업로드합니다.
2. Worker가 10분마다 시니컬.kr의 공개 경주 목록을 확인해 최신 분석 HTML을 복기 사이트로 복사합니다. 비공개이거나 공개 API 목록에 나오지 않는 자료는 가져오지 않습니다.
3. 같은 Worker가 마사회 공식 경주기록 API를 확인해 날짜·경마장·경주번호가 같은 결과를 붙입니다.
4. 이용자는 목록에서 **복기 + 결과 보기**를 눌러 결과표와 분석 HTML을 같은 화면에서 봅니다.

예전에 받은 HTML이나 공개 목록에 없는 파일은 복기 사이트의 `/admin-upload.html`에서 한 번 올릴 수 있습니다. 파일명은 `시니컬AI_부경_20260911_7경주_V233.html`처럼 경주장·날짜·경주번호를 포함해야 합니다. 공개 API가 잠금 안내만 돌려주는 자료는 자동으로 가져오지 않습니다.

## Cloudflare 준비

1. Cloudflare Pages에서 GitHub 저장소 `ij262005-dev/cynical-racing-recap`을 연결합니다. 프레임워크는 `None`, 빌드 명령은 비움, 출력 폴더는 `public`로 설정합니다.
2. D1 데이터베이스를 만들고 `migrations/0001_initial.sql`을 실행합니다.
3. R2 버킷을 만들고 이름을 `cynical-recap-html`로 지정합니다.
4. Pages의 Bindings에서 D1을 `DB`, R2를 `RACE_HTML`로 연결한 뒤 재배포합니다.
5. Pages의 Secret에 `SYNC_TOKEN`을 설정합니다. 본인이 새로 정한 긴 전송용 문자열을 사용하고, 시니컬.kr 로그인 비밀번호는 사용하지 않습니다.
6. Worker를 저장소에 연결합니다. Root directory는 `sync-worker`, 배포 명령은 `npx wrangler deploy`입니다. `wrangler.toml`의 10분 Cron이 자동 실행을 예약합니다.
7. Worker의 Secrets/Variables에 다음 값을 넣습니다.
   - `RECAP_SITE_BASE_URL`: Cloudflare Pages 주소
   - `SYNC_TOKEN`: Pages와 같은 전송용 문자열
   - `KRA_SERVICE_KEY`: 공공데이터포털에서 신청한 한국마사회 경주기록 API 인증키
   - `CYNICAL_SOURCE_BASE_URL`: `https://시니컬.kr` — 공개 분석 HTML을 10분마다 자동 확인할 때 필요합니다.
8. (선택) Railway에서 업로드 직후 복기 사이트로 보내려면 시니컬.kr의 Railway Variables에 다음 값을 넣고, `RECAP_MIRROR_SETUP.md` 변경 사항도 Railway에 배포합니다.
   - `RECAP_SITE_BASE_URL`: Cloudflare Pages 주소
   - `RECAP_SYNC_TOKEN`: Pages/Worker의 `SYNC_TOKEN`과 같은 문자열

`SYNC_TOKEN`, `RECAP_SYNC_TOKEN`, `KRA_SERVICE_KEY`는 HTML이나 GitHub 코드에 넣지 않습니다. 본인이 새로 정한 긴 전송용 문자열을 사용하고, 시니컬.kr 로그인 비밀번호는 사용하지 않습니다. 한국마사회 인증키는 활용신청 후 해당 서비스의 Secrets 화면에 직접 입력하세요.

## 마사회 결과 API

한국마사회 경주기록 정보 API는 서울·부산경남·제주·영천의 경주 결과를 제공합니다. 날짜와 시행 경마장 코드를 기준으로 조회하며, 부산경남은 `meet=3`, 영천은 `meet=4`로 구분합니다. 공공데이터포털에서 키를 발급받아 `KRA_SERVICE_KEY` Secret으로 설정해야 자동 결과 연결이 시작됩니다.

공식 안내: <https://www.data.go.kr/data/15058305/openapi.do>

## 관리자 파일 올리기

배포 후 `/admin-upload.html`을 열고 파일을 고른 다음 Cloudflare `SYNC_TOKEN`을 입력합니다. 업로드 화면은 파일명에서 경주 정보만 읽고 전송 키를 저장하지 않습니다. `부경` 파일은 `부산경남`으로 맞춰 저장합니다. `부산경남 · 영천`처럼 경주 장소가 불분명한 이름은 자동으로 추측하지 않습니다.

## 개발 확인

```sh
cd sync-worker
npm test
```

현재 코드에는 Google Drive·Notion 저장 기능이 포함되어 있지 않습니다. Cloudflare 배포와 API 키 설정도 완료 상태가 아닙니다.
