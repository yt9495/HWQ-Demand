/* Firebase 연동 (Firestore) — firebase-config.js에서 FIREBASE_ENABLED = true 로 설정하면 활성화됩니다.
   컬렉션 구조: demandData/{docId: "latest"} 문서 하나에 전체 대시보드 JSON을 저장하는 단순한 구조입니다.
   나중에 이력을 남기고 싶으면 uploadedAt을 문서 ID로 하는 컬렉션으로 바꾸면 됩니다. */

let firebaseApp = null;
let firestoreDb = null;

async function ensureFirebase() {
  if (!window.FIREBASE_ENABLED) return null;
  if (firestoreDb) return firestoreDb;

  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const { getFirestore, doc, setDoc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  firebaseApp = initializeApp(window.FIREBASE_CONFIG);
  firestoreDb = getFirestore(firebaseApp);
  window.__firestoreHelpers = { doc, setDoc, getDoc };
  return firestoreDb;
}

window.saveDemandDataToFirebase = async function (data) {
  const db = await ensureFirebase();
  if (!db) return;
  const { doc, setDoc } = window.__firestoreHelpers;
  await setDoc(doc(db, "demandData", "latest"), {
    ...data,
    updatedAt: new Date().toISOString()
  });
};

window.loadDemandDataFromFirebase = async function () {
  const db = await ensureFirebase();
  if (!db) return null;
  const { doc, getDoc } = window.__firestoreHelpers;
  const snap = await getDoc(doc(db, "demandData", "latest"));
  return snap.exists() ? snap.data() : null;
};
