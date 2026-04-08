# 벡터 공간 모형 노트

- vector space model은 문서와 query를 벡터로 보고 유사도를 계산하는 고전적 관점이다.
- 정확한 의미 이해까지는 못 가더라도 ranking과 partial overlap 설명에 유용하다.
- 관련 문서: [[정보 검색 메모]], [[한영 검색 용어집]], [[모델 평가 로그]].

## 떠올릴 점

- exact match가 아니어도 관련 문서를 찾을 수 있다
- term weighting이 중요하다
- semantic retrieval의 전 단계로 이해해도 좋다

## 실무 메모

- `vector`라는 단어를 UI에 드러내는 것은 별로 중요하지 않다
- 하지만 내부적으로는 retrieval intuition을 잡는 데 도움이 된다
