# Incident: Provider Mismatch

- selected embedding model과 active provider가 어긋나 보였던 사건.
- settings를 다시 열면 Repair가 떠서 사용자가 실제 상태를 이해하기 어려웠다.
- 관련 문서: [[검색 품질 회고]], [[ONNX Runtime 메모]], [[한영 검색 용어집]].

## 증상

- Repair가 다시 나타남
- active provider와 selected model이 불일치해 보임
- 품질 이슈가 설정 이슈인지 retrieval 이슈인지 헷갈림

## 검색 표현

- active provider
- provider mismatch
- 설정 다시 열면 Repair 뜬다
