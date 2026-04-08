# 데이터베이스 메모

- 데이터베이스는 구조화된 정보를 저장하고 조회하는 체계다.
- 검색 시스템에서도 source DB와 search index DB를 분리하는 설계가 자주 나온다.
- 관련 문서: [[SQLite 학습 노트]], [[Incident: Rebuild Stall]], [[Provider Mismatch 메모]].

## Sandpaper 쪽 해석

- main DB는 source of truth
- search 전용 sidecar index는 별도 관리 가능
- rebuild와 incremental update 전략이 중요하다
