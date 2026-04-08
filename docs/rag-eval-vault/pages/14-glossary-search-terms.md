# SQLite 학습 노트

- SQLite는 embedded database로 자주 쓰인다.
- 별도 서버 프로세스 없이 앱 내부에서 쓰기 좋다는 점이 중요하다.
- 관련 문서: [[데이터베이스 메모]], [[ONNX Runtime 메모]], [[사이드카 인덱스 설계 메모]].

## 제품 관점 해석

- note app local DB로 적합하다
- sidecar search index를 두기 쉬운 구조다
- 작은 tooling과 함께 배포하기 편하다

## 검색 관련 키워드

- sidecar index
- embedded database
- local-first
