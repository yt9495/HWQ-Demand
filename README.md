# Chemical Demand Dashboard 2026

매주 업데이트되는 "Chemical Demand Plan 2026.xlsx"를 업로드하면 화학물질별 주간 Demand를 표와 추이 차트로 보여주는 정적 웹앱입니다.

**배포 주소**: https://yt9495.github.io/HWQ-Demand/
**Firebase 프로젝트**: hwq-demand (Firestore, asia-northeast3/Seoul)

## 지금 상태 (완료: 웹앱 + Firebase + GitHub Pages 배포 + Google Sheets 동기화 + 필터/합계/변경사항)

엑셀 업로드(또는 구글시트 동기화) → 브라우저에서 파싱 → Firestore(`demandData/latest`)에 저장 → 페이지를 열 때마다 최신 데이터를 불러오는 흐름이 실제로 동작 중입니다. 모두 라이브에서 직접 확인 완료.

- `index.html` / `style.css` / `app.js` — 대시보드 본체. 브라우저에서 SheetJS로 엑셀을 직접 파싱하거나, Google Sheets API로 구글시트를 직접 불러옵니다.
- `demo-data.json` — Firestore에 아직 데이터가 없을 때 보여주는 기본 샘플 데이터.
- `firebase-config.js` / `firebase.js` — Firebase 연동 (`FIREBASE_ENABLED = true`, 프로젝트: hwq-demand). 업데이트할 때마다 Firestore `demandData/latest` 문서에 자동 저장되고, 이후 누구든 페이지를 열면 그 데이터를 불러옵니다.
- `google-sheets-config.js` — Google Sheets 연동 설정 (API 키는 Sheets API + `yt9495.github.io` 도메인으로 제한됨).

### 추가된 기능

- **화학물질 선택 (Chemical Filter)**: 체크박스로 원하는 물질만 골라서 KPI/표/차트/누적 합계를 필터링.
- **물질별 누적 합계 (Cumulative Total by Chemical)**: 필터에 걸린 물질 기준으로 전체 기간 누적 합계를 카드로 표시.
- **직전 업데이트 대비 변경사항 (Change vs Previous Update)**: 업데이트할 때마다 바로 이전 스냅샷과 비교해서 물질별 증감(L)과 변경/신규 셀 수를 표시. 변경이 없으면 "변경사항이 없습니다"로 표시.
- **구글시트에서 불러오기 (Sync)**: 엑셀 업로드 없이 버튼 한 번으로 [Chemical Demand Plan 2026 구글시트](https://docs.google.com/spreadsheets/d/1Au4eV7xJSdX-cUzBICQknWFc0rEuht1ZazMrh8P2zcY/edit)에서 바로 최신 데이터를 가져옴 (엑셀 업로드 기능은 그대로 유지).

### 매주 업데이트하는 법

1. https://yt9495.github.io/HWQ-Demand/ 접속
2. 우측 상단에서 "구글시트에서 불러오기" (구글시트가 최신이면 이 버튼 한 번으로 끝) 또는 "엑셀 업로드"로 그 주의 xlsx 파일 선택
3. 표/차트/누적 합계가 즉시 갱신되고, "직전 업데이트 대비 변경사항"에 이번 주 변동이 표시되며, 동시에 Firestore에 저장되어 팀원 전체에게 반영됨

### 로컬에서 수정 후 확인하는 법

```bash
cd chemical-demand-webapp
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

### Firestore 보안 규칙

로그인 없이 누구나 업로드할 수 있도록 `demandData` 컬렉션만 열어뒀습니다 (`firestore.rules`는 콘솔에서 직접 설정, 저장소에는 미포함). 나중에 특정 사용자만 쓰기 가능하도록 제한하고 싶으면 Firebase Authentication을 추가하고 규칙에서 `request.auth != null` 조건을 걸면 됩니다.

### 파일이 바뀌면 GitHub에도 반영하기

1. 이 폴더의 파일을 수정
2. https://github.com/yt9495/HWQ-Demand 저장소에 "Add file → Upload files"로 바뀐 파일을 다시 올리고 커밋
3. GitHub Pages가 자동으로 재배포 (약 1분 소요)

## 데이터 구조 메모

원본 엑셀의 각 월별 시트는 두 부분으로 구성됩니다.
1. 요일별 배송 캘린더 (이번 버전에서는 파싱하지 않음 — 필요하면 추가 가능)
2. `Week` 행부터 시작하는 주간 Demand 표: 화학물질(HNO3, HF, HCl, KOH, H2O2)별로 주차 컬럼 + `Projected`/`Ordered`/`Received` 컬럼

`Projected`/`Ordered`/`Received`는 현재 전부 비어 있으며, 앞으로 매주 실제 발주/입고 데이터가 채워지면 대시보드에 자동으로 반영됩니다.
