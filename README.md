# Chemical Demand Dashboard 2026

매주 업데이트되는 "Chemical Demand Plan 2026.xlsx"를 업로드하면 화학물질별 주간 Demand를 표와 추이 차트로 보여주는 정적 웹앱입니다.

## 지금 상태 (1단계: 웹앱 완성)

- `index.html` / `style.css` / `app.js` — 대시보드 본체. 브라우저에서 SheetJS로 엑셀을 직접 파싱합니다.
- `data/demo-data.json` — 업로드 전 기본으로 보여주는 샘플 데이터 (현재 업로드하신 엑셀에서 추출).
- `firebase-config.js` / `firebase.js` — Firebase 연동 스위치. 아직 비활성 상태(`FIREBASE_ENABLED = false`)라 지금은 브라우저 안에서만 동작하고, 새로고침하면 데모 데이터로 돌아갑니다.

### 로컬에서 확인하는 법

```bash
cd chemical-demand-webapp
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

우측 상단 "엑셀 업로드" 버튼으로 매주 받는 xlsx 파일을 올리면 표와 차트가 즉시 갱신됩니다.

## 다음 단계 (2단계: Firebase)

1. https://console.firebase.google.com 에서 새 프로젝트 생성
2. Firestore Database 생성 (테스트 모드로 시작 후 나중에 보안 규칙 조정)
3. 프로젝트 설정 > 일반 > "웹 앱 추가"로 나온 설정 값을 `firebase-config.js`에 붙여넣고 `FIREBASE_ENABLED = true`로 변경
4. 이후부터는 엑셀을 업로드할 때마다 Firestore의 `demandData/latest` 문서에 자동 저장되고, 페이지를 열 때마다 그 데이터를 불러옵니다.

## 다음 단계 (3단계: GitHub)

1. GitHub에 새 저장소 생성 (예: `chemical-demand-dashboard`)
2. 이 폴더 전체를 저장소에 push
3. 저장소 Settings > Pages 에서 배포 브랜치를 `main`, 폴더를 `/ (root)`로 지정하면 `https://<계정명>.github.io/<저장소명>/`으로 팀원 누구나 접속 가능

## 데이터 구조 메모

원본 엑셀의 각 월별 시트는 두 부분으로 구성됩니다.
1. 요일별 배송 캘린더 (이번 버전에서는 파싱하지 않음 — 필요하면 추가 가능)
2. `Week` 행부터 시작하는 주간 Demand 표: 화학물질(HNO3, HF, HCl, KOH, H2O2)별로 주차 컬럼 + `Projected`/`Ordered`/`Received` 컬럼

`Projected`/`Ordered`/`Received`는 현재 전부 비어 있으며, 앞으로 매주 실제 발주/입고 데이터가 채워지면 대시보드에 자동으로 반영됩니다.
