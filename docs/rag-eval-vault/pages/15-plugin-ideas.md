# ONNX Runtime 메모

- ONNX는 모델 표현의 상호 운용성에 초점을 둔다.
- 실제 앱에서는 모델 변환보다 runtime 호환성과 배포 안정성이 더 큰 문제일 수 있다.
- 관련 문서: [[기계 학습 메모]], [[모델 평가 로그]], [[Incident: Provider Mismatch]].

## 기억할 점

- framework interoperability
- shared optimization
- runtime packaging risk

## 제품 관점

- 모델 파일만 맞는다고 끝이 아니다
- runtime binary, provider, platform packaging이 같이 맞아야 한다
