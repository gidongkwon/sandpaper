# 정보 검색 메모

- 정보 검색은 저장된 정보 집합에서 사용자의 질의와 관련 있는 항목을 찾는 문제다.
- 실무에서는 단순 저장보다 retrieval quality와 ranking이 중요하다.
- 관련 문서: [[검색 엔진 메모]], [[자연어 처리 메모]], [[벡터 공간 모형 노트]].

## 이 corpus에서 중요한 이유

- 우리는 note title만 찾는 게 아니라 block context도 찾고 싶다.
- query와 document 사이의 관련성은 exact term overlap만으로 설명되지 않는다.
- 하지만 semantic retrieval만으로는 title exact hit를 이기면 안 된다.

## 테스트 포인트

- relevance ordering
- partial term overlap
- query reformulation
