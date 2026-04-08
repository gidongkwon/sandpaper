# Sandpaper RAG Evaluation Vault

이 디렉터리는 Sandpaper 검색/RAG 평가용 standalone corpus입니다.

- 앱 소스코드를 수정하지 않습니다.
- `sandpaper.db`를 포함한 앱 전용 vault snapshot은 아닙니다.
- Markdown 문서 묶음으로 제공되며, 테스트용 vault에 가져와서 색인 품질을 비교하는 용도입니다.

## 구성

- `pages/`: 24개 문서
- `evaluation-queries.md`: 추천 검색 질의 세트
- `sources.md`: Wikipedia 기반 source map과 attribution 메모

## 설계 의도

- 한국어 비중이 높고, 영어 technical term이 자연스럽게 섞인 corpus
- heading 아래 짧은 bullet이 많은 outliner 스타일 문서
- exact match, paraphrase, bilingual retrieval, citation landing을 모두 테스트 가능
- Wikipedia 기반 study note + 실제 팀 문서처럼 보이는 회의록/incident/support note를 함께 포함

## 추천 사용법

1. 새 테스트용 vault를 만듭니다.
2. `pages/` 아래 문서들을 vault에 가져옵니다.
3. 색인을 다시 만듭니다.
4. [`evaluation-queries.md`](/A:/dev/sandpaper/docs/rag-eval-vault/evaluation-queries.md)의 질의를 순서대로 테스트합니다.
5. 모델을 바꾸더라도 같은 query set으로만 비교합니다.

## 이 corpus가 특히 잘 드러내는 것

- `재색인`, `인덱스를 다시 만든다`, `색인을 새로 생성한다` 같은 한국어 동의 표현
- `active provider`, `provider mismatch`, `command palette`, `global launcher` 같은 영문 technical noun
- title hit와 snippet hit가 충돌할 때의 랭킹 품질
- context-heavy short bullet retrieval

## 라이선스 메모

앞부분의 study note는 한국어/영어 Wikipedia 문서를 참고해 재구성한 요약 메모입니다. 원문을 그대로 복제한 데이터셋이 아니라, 평가 목적에 맞게 paraphrase한 corpus입니다. source 목록과 링크는 [`sources.md`](/A:/dev/sandpaper/docs/rag-eval-vault/sources.md)에 정리했습니다.
