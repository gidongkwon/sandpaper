# Incident: Rebuild Stall

- 적은 문서 수인데도 rebuild가 오래 멈춘 것처럼 보였던 사건.
- 결국 chunk 수보다 embedding 자체가 병목인 것으로 해석되었다.
- 관련 문서: [[모델 평가 로그]], [[ONNX Runtime 메모]], [[주간 sync 2026-02-15]].

## 증상

- UI가 오랫동안 응답 없음처럼 보임
- embedding 시간이 전체 rebuild 시간을 거의 다 먹음
- first batch warm-up도 무시 못할 비용이었음

## 검색으로 잡혀야 할 표현

- rebuild stalled
- embedding warm-up
- 문서 9개인데 너무 오래 걸린다
