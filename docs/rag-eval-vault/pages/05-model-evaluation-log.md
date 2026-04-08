# 모델 평가 로그

- local hashed fallback은 빠르지만 semantic recall이 약하다.
- local Qwen3 CPU는 품질 가능성은 보였지만 rebuild time이 너무 길었다.
- `pplx-embed-v1`는 independent chunk 파이프라인에 맞고, `pplx-embed-context-v1`는 heading-heavy note에 더 흥미롭다.
- 관련 문서: [[Contextual Indexing 실험]], [[Incident: Rebuild Stall]], [[주간 sync 2026-02-15]].

## 가설

- 짧은 bullet이 많은 outliner에서는 contextual indexing이 더 나을 수 있다.
- bilingual retrieval quality가 benchmark 수치보다 더 중요하다.

## 운영 메모

- embedding model을 바꾸면 rebuild가 필요하다.
- 그렇지 않으면 vector가 stale 상태가 된다.
