# Contextual Indexing 실험

- 문서 단위 batch contextual indexing은 page의 chunk들을 같이 보고 embedding하는 방식이다.
- 짧은 bullet이 heading에 의존하는 경우에 특히 효과를 기대할 수 있다.
- 관련 문서: [[모델 평가 로그]], [[한국어 처리 메모]], [[Command Palette 설계]].

## 왜 실험하려는가

- outliner note는 block가 짧다
- block 하나만 떼면 의미가 약하다
- 같은 page의 다른 chunk를 함께 보면 의미가 보강될 수 있다

## 비용

- 인덱싱이 무거워진다
- page 일부 수정도 전체 page 재임베딩이 필요할 수 있다
