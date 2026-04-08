# Project Beta 인수인계 메모

- Beta에서는 provider 상태, rebuild 흐름, settings wording이 주요 이슈였다.
- retrieval quality 문제와 runtime readiness 문제를 분리해서 봐야 한다는 교훈이 있었다.
- 관련 문서: [[Incident: Provider Mismatch]], [[Incident: Rebuild Stall]], [[모델 평가 로그]].

## 교훈

- 품질 문제인지 설정 문제인지 먼저 나눈다
- corpus가 작아도 model choice가 느리면 UX는 무너진다
- evaluation vault 없이는 모델 교체 논의를 반복하게 된다
