# VIBE CODING WORKSPACE

바이브코딩 교육에 사용하는 7개 웹 도구를 한 브라우저 창에서 전환하는 Chrome·Edge 확장 프로그램입니다. 사이드 패널의 메뉴는 계속 두고 현재 작업 탭 하나의 서비스 화면을 바꿉니다. 서비스마다 새 탭을 만들지 않으며, 로그인 정보나 쿠키를 읽거나 저장하지 않습니다. 웹 대시보드는 설치 안내를 담당합니다.

## 구성

- `apps/web`: Vercel에 배포할 반응형 안내 대시보드
- `apps/extension`: Chrome 및 Edge용 Manifest V3 확장 프로그램
- `shared/tools.json`: 기본 7개 서비스의 공통 설정
- `docs`: 설치 및 사용 설명서
- `scripts`: 웹 배포 파일과 확장 프로그램 ZIP 생성

## 빠른 시작

1. `apps/extension` 폴더를 Chrome 또는 Edge에서 압축 해제된 확장 프로그램으로 불러옵니다.
2. 브라우저 도구 모음의 확장 프로그램 아이콘을 눌러 사이드 패널을 엽니다.
3. 도구 메뉴에서 ChatGPT 또는 원하는 서비스를 선택합니다. 현재 탭 하나에서 해당 사이트가 열립니다.
4. 서비스가 처음 열리면 해당 사이트에서 직접 로그인합니다.
5. ChatGPT 바로 아래 Codex를 포함해 메뉴를 눌러 서비스를 전환합니다. 이전에 방문한 서비스는 마지막 경로로 돌아갑니다.

웹 대시보드 빌드: `npm run build:web`

확장 프로그램 ZIP 생성: `npm run package:extension`

PowerShell 환경에 npm이 설치되어 있지 않으면 저장소 루트에서 `node scripts/build-web.mjs` 또는 `node scripts/package-extension.mjs`를 직접 실행해도 됩니다.

## 보안과 동작 범위

- 요청 권한은 `sidePanel`, `tabs`, `storage`와 기본 7개 사이트의 URL 확인 권한입니다.
- 추가 서비스의 도메인 권한은 사용자가 서비스를 저장할 때 해당 도메인에 대해서만 요청합니다.
- 암호, 쿠키, 로그인 상태를 저장하거나 외부 서버로 보내지 않습니다.
- 외부 서비스 페이지를 iframe으로 표시하지 않습니다.
- 서비스별 마지막 URL 경로를 로컬에 기록하며, 검색어와 `#` 뒤 값은 저장하지 않습니다. 로그인 여부는 사이트별로 확인할 수 없으므로 직접 확인해야 합니다.
- 한 서비스에서 다른 서비스로 이동하면 현재 탭 페이지가 바뀝니다. 사이트가 저장하지 않은 임시 입력은 사라질 수 있으므로 먼저 저장해야 합니다.

설치와 수업 전 점검은 [docs/INSTALL.md](docs/INSTALL.md), 사용 방법은 [docs/USER_GUIDE.md](docs/USER_GUIDE.md), 수동 확인 절차는 [docs/TESTING.md](docs/TESTING.md)를 참고하세요.

## 배포

기준 저장소는 [lovvv98-ui/vibe-coding-workspace](https://github.com/lovvv98-ui/vibe-coding-workspace)이며 기본 브랜치는 `main`입니다. Vercel 프로젝트의 루트 디렉터리를 저장소 루트로 두면 `vercel.json`이 대시보드를 `apps/web/dist`에 빌드합니다. 빌드 과정에서 확장 프로그램 ZIP도 대시보드의 다운로드 경로에 포함합니다. Vercel 배포만으로 확장 프로그램이 자동 설치되지는 않습니다.

웹 대시보드의 실제 Vercel 배포와 확장 프로그램 스토어 등록은 별도의 단계입니다.
