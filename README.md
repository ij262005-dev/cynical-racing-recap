# 시니컬경마 복기자료실: Cloudflare 연결 안내

이 저장소는 화면 소스를 GitHub에 보관하고, 실제 사이트와 API는 Cloudflare Pages에서 운영합니다. 기존 시니컬.kr 서버와는 별도 서비스입니다.

## 현재 준비된 기능

- Pages 사이트 화면과 API (`public/`, `functions/`)
- D1에 경주 목록과 수집 상태 저장
- R2에 원본 HTML 파일 저장
- 별도 Worker가 10분마다 시니컬.kr의 공개 경주 목록과 HTML을 확인
- 기존 파일 내용이 바뀌면 HTML도 갱신
- Cloudflare 무료 Worker 요청 한도 안에 머물도록 최신 10건과 과거 자료 10건씩 순환 확인
- 목요일부터 월요일까지 요일 필터
- 공식 경주 결과는 아직 연결 전이므로 “경주 결과 대기”로 표시
- Google Drive와 Notion 전송은 인증 연결 후 활성화

## Cloudflare에 연결할 때 필요한 값

1. Cloudflare Pages의 Git 저장소로 `ij262005-dev/cynical-racing-recap`을 선택합니다.
2. Pages 설정은 프레임워크 `None`, 빌드 명령은 비움, 빌드 출력 폴더는 `public`로 지정합니다.
3. Cloudflare에서 D1 데이터베이스를 만들고 `migrations/0001_initial.sql`을 한 번 실행합니다.
4. Cloudflare에서 R2 버킷 `cynical-recap-html`을 만듭니다.
5. Pages 프로젝트의 Settings → Bindings에 D1을 `DB`, R2를 `RACE_HTML` 이름으로 연결한 뒤 재배포합니다.
6. Pages 프로젝트의 환경 변수/Secret에 `SYNC_TOKEN`을 추가합니다. 긴 임의 값을 만들고 Worker에도 같은 Secret을 설정합니다.
7. Cloudflare Workers에서 이 저장소로 Worker를 연결합니다. Worker의 Root directory는 `sync-worker`, 배포 명령은 `npx wrangler deploy`입니다. `sync-worker/wrangler.toml`에 10분 Cron 설정이 있습니다.
8. Worker의 Variables and Secrets에 다음 값을 추가합니다.
   - `CYNICAL_SOURCE_BASE_URL`: 실제 시니컬.kr 사이트의 기본 주소 (예: `https://실제-도메인`)
   - `RECAP_SITE_BASE_URL`: 새 Cloudflare Pages 주소
   - `SYNC_TOKEN`: Pages와 같은 Secret 값
9. Worker의 `/run`을 인증해 한 번 시험하거나 10분 예약 실행을 기다립니다. `/health`는 연결 상태 확인용입니다.

## 보안 및 자료 범위

- API 암호와 원본 사이트 주소는 HTML 파일이나 GitHub에 쓰지 않습니다. Cloudflare의 Variables and Secrets에만 넣습니다.
- 현재 원본 코드의 공개 `race.list`와 `race.get`만 사용합니다. 비공개 자료는 가져오지 않습니다.
- 원본 자료가 10건보다 많으면 최신 10건은 매 실행 때 확인하고, 나머지는 10건씩 순환 확인합니다. 과거 자료가 아주 많을 때 첫 전체 복사는 여러 번의 10분 주기를 거칩니다.
- 공개 목록과 HTML을 읽을 권한이 원본 사이트에서 거부되면 별도의 읽기 전용 연동 방식을 먼저 만들어야 합니다. 기존 운영 서버 설정을 이 프로젝트가 변경하지는 않습니다.
- 원본 자료는 예상/분석 HTML입니다. 공식 경주 결과를 가져와 복기 HTML을 합성하는 단계와 Google Drive·Notion OAuth 연결은 별도 후속 작업입니다.

## 로컬 확인

```sh
cd sync-worker
npm test
```

Cloudflare Cron Trigger는 UTC 기준으로 동작하고, 예약된 시각과 실행 시각 사이에 약간의 지연이 생길 수 있습니다. 매 10분 실행은 `*/10 * * * *` 설정으로 요청합니다.
